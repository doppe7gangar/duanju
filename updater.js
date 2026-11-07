'use strict';
// In-app updates for the portable build, published as GitHub or Gitee releases
// (package.json → updater.provider: "github" | "gitee").
//
// Flow: check the latest release → download its .exe next to the running one (progress reported to
// the page) → verify it → on "重启并更新" quit, let a small PowerShell helper swap the file in place
// (same name, so shortcuts keep working) and start the new version.
//
// Release format: tag "v1.2.3" (or "1.2.3"), one attached asset ending in "-win-x64.exe".
// Optionally a line "SHA256: <64 hex>" in the release notes (GitHub also publishes an asset digest);
// when a checksum is known the download must match it.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const axios = require('axios');

const pkg = require('./package.json');
const config = pkg.updater || {};
const MIN_SIZE = 20 * 1024 * 1024;   // a real build is ~110 MB; anything tiny is an error page
const MAX_SIZE = 600 * 1024 * 1024;

const PROVIDERS = {
  github: {
    name: 'GitHub',
    latest: () => `https://api.github.com/repos/${config.owner}/${config.repo}/releases/latest`,
    headers: { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
    hosts: ['github.com', '.githubusercontent.com']
  },
  gitee: {
    name: 'Gitee',
    latest: () => `https://gitee.com/api/v5/repos/${config.owner}/${config.repo}/releases/latest`,
    headers: { Accept: 'application/json' },
    hosts: ['gitee.com', '.gitee.com', '.giteeusercontent.com']
  }
};
const provider = PROVIDERS[config.provider];
function configured() {
  return !!provider && /^[\w.-]+$/.test(config.owner || '') && /^[\w.-]+$/.test(config.repo || '');
}
function parseVersion(value) {
  const match = String(value || '').trim().match(/^v?(\d+)\.(\d+)\.(\d+)/);
  return match ? match.slice(1).map(Number) : null;
}
function newer(a, b) {
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return false;
}
function allowedHost(url) {
  try {
    const { protocol, hostname } = new URL(url);
    return protocol === 'https:' && !!provider && provider.hosts.some(host => (host.startsWith('.') ? hostname.endsWith(host) : hostname === host));
  } catch (_) { return false; }
}
// The running portable .exe (electron-builder sets this); absent when running from source.
function installedExe() {
  const file = process.env.PORTABLE_EXECUTABLE_FILE;
  return file && fs.existsSync(file) ? file : null;
}

let latest = null;      // { version, notes, url, name, sha256 }
let downloaded = null;  // path of the verified new exe
let downloading = null; // in-flight promise

async function check(currentVersion) {
  if (!configured()) return { configured: false, current: currentVersion };
  let data;
  // One retry for network hiccups (e.g. while a video is buffering at startup).
  for (let attempt = 1; ; attempt++) {
    try {
      ({ data } = await axios.get(provider.latest(), { timeout: 20000, headers: { ...provider.headers, 'User-Agent': 'GuojuDesktop-Updater' } }));
      break;
    } catch (error) {
      // 404 means the repository has no release yet; that is "up to date", not a failure.
      if (error?.response?.status === 404) return { configured: true, current: currentVersion, available: false, reason: '更新仓库里还没有发布任何版本' };
      if (!error?.response && attempt < 2) { await new Promise(resolve => setTimeout(resolve, 3000)); continue; }
      throw new Error(error?.response ? `更新服务器返回 ${error.response.status}` : `无法连接到 ${provider.name}，请检查网络（${error?.code || '超时'}）`);
    }
  }
  const version = parseVersion(data?.tag_name);
  if (!version) throw new Error('最新发行版没有有效的版本号');
  const asset = (Array.isArray(data.assets) ? data.assets : []).find(item => /-win-x64\.exe$/i.test(item?.name || '') && allowedHost(item?.browser_download_url));
  const notes = String(data.body || '').slice(0, 4000);
  const sha = notes.match(/sha-?256\s*[:：]\s*([a-f0-9]{64})/i);
  // GitHub publishes each asset's digest ("sha256:<hex>"); prefer it over the notes.
  const digest = String(asset?.digest || '').match(/^sha256:([a-f0-9]{64})$/i);
  latest = asset ? { version: version.join('.'), notes, url: asset.browser_download_url, name: asset.name, sha256: (digest?.[1] || sha?.[1] || '').toLowerCase() } : null;
  const current = parseVersion(currentVersion) || [0, 0, 0];
  return {
    configured: true, current: currentVersion, latest: version.join('.'),
    available: !!latest && newer(version, current), notes, canInstall: !!installedExe(),
    reason: !latest ? '最新发行版里没有找到 Windows 安装包（文件名需以 -win-x64.exe 结尾）' : ''
  };
}

// GitHub serves release files from release-assets.githubusercontent.com, which many networks in
// mainland China cut off mid-download (read ECONNRESET). These public GitHub download proxies are
// tried after the direct link. They are only used when the SHA256 is known from the GitHub API, so a
// proxy cannot hand over a different file: anything that does not match is thrown away.
const MIRRORS = ['https://ghfast.top/', 'https://gh-proxy.com/'];
const MIRROR_HOSTS = MIRRORS.map(prefix => new URL(prefix).hostname);
const MAX_ATTEMPTS = 300;
const STALL_MS = 25000;

function downloadSources() {
  const list = [latest.url];
  if (config.provider === 'github' && latest.sha256) list.push(...MIRRORS.map(prefix => prefix + latest.url));
  return list;
}
function allowedDownload(url) {
  if (allowedHost(url)) return true;
  try { return !!latest?.sha256 && MIRROR_HOSTS.includes(new URL(url).hostname); } catch (_) { return false; }
}
function fileSha256(file) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    fs.createReadStream(file).on('data', chunk => hash.update(chunk)).on('error', reject).on('end', () => resolve(hash.digest('hex')));
  });
}

// Fetch from `start` to the end of the file into `target` (appending when the server honours Range).
// Resolves with the new byte count and total size; a stalled or broken connection rejects.
async function fetchPart(url, target, start, report) {
  const response = await axios.get(url, {
    responseType: 'stream', timeout: 30000, maxRedirects: 5, maxContentLength: MAX_SIZE,
    headers: { 'User-Agent': 'GuojuDesktop-Updater', ...(start ? { Range: `bytes=${start}-` } : {}) },
    validateStatus: status => status === 200 || status === 206
  });
  const finalUrl = response.request?.res?.responseUrl || url;
  if (!allowedDownload(finalUrl)) {
    response.data.destroy();
    throw new Error('下载被重定向到了未知地址，已停止');
  }
  const resumed = start > 0 && response.status === 206;
  let received = resumed ? start : 0;
  const range = String(response.headers['content-range'] || '').match(/\/(\d+)$/);
  const total = Number(range?.[1]) || (Number(response.headers['content-length']) || 0) + received;
  if (total && (total < MIN_SIZE || total > MAX_SIZE)) {
    response.data.destroy();
    throw new Error('安装包大小异常，已停止下载');
  }
  await new Promise((resolve, reject) => {
    const out = fs.createWriteStream(target, { flags: resumed ? 'a' : 'w' });
    let stall = null;
    const fail = error => { clearTimeout(stall); response.data.destroy(); out.destroy(); reject(error); };
    const watch = () => { clearTimeout(stall); stall = setTimeout(() => fail(Object.assign(new Error('下载停滞'), { code: 'ESTALLED' })), STALL_MS); };
    watch();
    response.data.on('data', chunk => {
      received += chunk.length;
      watch();
      if (received > MAX_SIZE) fail(new Error('安装包过大'));
      report(received, total);
    });
    response.data.on('error', fail);
    response.data.on('end', () => clearTimeout(stall));
    out.on('error', fail);
    out.on('finish', resolve);
    response.data.pipe(out);
  });
  return { received, total };
}

function download(onProgress) {
  if (downloading) return downloading;
  if (!latest) return Promise.reject(new Error('请先检查更新'));
  const exe = installedExe();
  if (!exe) return Promise.reject(new Error('开发模式下无法自动更新，请使用打包后的程序'));
  const target = path.join(path.dirname(exe), `${latest.name}.download`);
  downloading = (async () => {
    fs.rmSync(target, { force: true });
    const sources = downloadSources();
    let source = 0;
    let received = 0;
    let total = 0;
    let lastReport = 0;
    let lastError = null;
    const report = (bytes, size) => {
      if (Date.now() - lastReport > 200) { lastReport = Date.now(); onProgress?.({ received: bytes, total: size }); }
    };
    // Broken connections resume where they stopped. A source that made no progress is swapped
    // for the next one (direct link → mirrors → back to direct).
    // Give up only after every source has failed twice in a row without moving forward.
    let stuck = 0;
    for (let attempt = 0; attempt < MAX_ATTEMPTS && stuck < sources.length * 2; attempt++) {
      const before = received;
      try {
        ({ received, total } = await fetchPart(sources[source], target, received, report));
        if (!total || received >= total) break;
        lastError = new Error('连接提前结束');
      } catch (error) {
        lastError = error;
        try { received = fs.statSync(target).size; } catch (_) { received = 0; }
        if (/重定向|大小异常|过大/.test(error?.message || '')) received = 0;
      }
      if (received - before < 1024 * 1024) { stuck++; source = (source + 1) % sources.length; } else stuck = 0;
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    if (!total || received < total) {
      const code = lastError?.code || lastError?.message || '网络中断';
      throw new Error(`下载没能完成（${code}）。已尝试直连${sources.length > 1 ? '和加速镜像' : ''}，请稍后重试，或到发行版页面手动下载`);
    }
    onProgress?.({ received, total });
    // Verify: real size, a Windows executable header, and the published checksum when there is one.
    const head = Buffer.alloc(2);
    const fd = fs.openSync(target, 'r');
    fs.readSync(fd, head, 0, 2, 0);
    fs.closeSync(fd);
    const digest = await fileSha256(target);
    if (received < MIN_SIZE || head.toString('latin1') !== 'MZ') throw new Error('下载的文件不是有效的程序，请稍后重试');
    if (latest.sha256 && digest !== latest.sha256) throw new Error('安装包校验失败（SHA256 不一致），已丢弃');
    downloaded = target;
    return { version: latest.version, sha256: digest, verified: !!latest.sha256 };
  })().catch(error => {
    try { fs.rmSync(target, { force: true }); } catch (_) {}
    throw error;
  }).finally(() => { downloading = null; });
  return downloading;
}

// Hand over to a helper that waits for this program to release its .exe, swaps the file and starts
// the new version. Returns false if there is nothing to install.
//
// The portable build runs inside a launcher that ends every process it started when the app exits,
// including "detached" children. So the helper is started through WMI (Win32_Process.Create): it then
// belongs to the WMI service rather than to this app and survives the shutdown.
function install(quit) {
  const exe = installedExe();
  if (!exe || !downloaded || !fs.existsSync(downloaded)) return false;
  const script = path.join(os.tmpdir(), `guoju-update-${process.pid}.ps1`);
  const log = path.join(os.tmpdir(), 'guoju-update.log');
  fs.writeFileSync(script, [
    'param([string]$Source, [string]$Target, [string]$Log)',
    'function Note($text) { Add-Content -LiteralPath $Log -Value ("{0:yyyy-MM-dd HH:mm:ss} {1}" -f (Get-Date), $text) -Encoding UTF8 }',
    'Note "update helper started: $Source -> $Target"',
    '$moved = $false',
    'for ($i = 0; $i -lt 240; $i++) {',
    '  try { Move-Item -LiteralPath $Source -Destination $Target -Force -ErrorAction Stop; $moved = $true; break } catch { Start-Sleep -Milliseconds 500 }',
    '}',
    'if ($moved) { Note "replaced after $($i * 0.5)s" } else { Note "could not replace (file still in use); starting the old version" }',
    'Start-Process -FilePath $Target',
    'Note "started $Target"',
    'Remove-Item -LiteralPath $MyInvocation.MyCommand.Path -Force -ErrorAction SilentlyContinue'
  ].join('\r\n'), 'utf8');
  const quote = value => `"${String(value).replace(/"/g, '')}"`;
  const commandLine = ['powershell.exe', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden',
    '-File', quote(script), '-Source', quote(downloaded), '-Target', quote(exe), '-Log', quote(log)].join(' ');
  // Pass the WMI call as -EncodedCommand so no path ever needs shell quoting.
  const launcher = `$r = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{ CommandLine = '${commandLine.replace(/'/g, "''")}' }; exit $r.ReturnValue`;
  const encoded = Buffer.from(launcher, 'utf16le').toString('base64');
  try {
    require('node:child_process').execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded], { windowsHide: true, timeout: 20000 });
  } catch (_) {
    // Fallback: plain detached child (works when not inside the portable launcher).
    spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-File', script, '-Source', downloaded, '-Target', exe, '-Log', log], {
      detached: true, stdio: 'ignore', windowsHide: true
    }).unref();
  }
  quit();
  return true;
}

module.exports = { check, download, install, configured };
