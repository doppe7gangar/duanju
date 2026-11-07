// Publishes the current build as a release so installed copies can update themselves.
// Works with the provider in package.json → updater ("github" or "gitee").
//
//   1. npm run build                      (creates dist/GuojuDesktop-<version>-win-x64.exe)
//   2. save a token (one line) to %USERPROFILE%\.github_token.txt  (or .gitee_token.txt),
//      or set $env:GITHUB_TOKEN / $env:GITEE_TOKEN
//   3. npm run release -- "这次更新了什么"
//
// It creates (or reuses) tag v<version>, writes the notes plus a "SHA256: …" line the in-app updater
// verifies, and uploads the .exe as the release asset. The token is never written out or printed.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const axios = require('axios');

const root = path.join(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const { provider, owner, repo } = pkg.updater || {};
const version = pkg.version;
const tag = `v${version}`;
const fileName = `GuojuDesktop-${version}-win-x64.exe`;
const exe = path.join(root, 'dist', fileName);
const notes = process.argv.slice(2).join(' ').trim() || `果剧桌面 ${tag}`;

function fail(message) {
  console.error(`\n✗ ${message}\n`);
  process.exit(1);
}
function readToken(kind) {
  const env = process.env[`${kind.toUpperCase()}_TOKEN`];
  if (env) return env.trim();
  for (const name of [`.${kind}_token`, `.${kind}_token.txt`]) {
    try {
      const value = fs.readFileSync(path.join(os.homedir(), name), 'utf8').replace(/^﻿/, '').trim();
      if (value) return value;
    } catch (_) { /* try next */ }
  }
  return '';
}
function explain(error) {
  const status = error?.response?.status;
  const data = error?.response?.data;
  const detail = data?.message || (Array.isArray(data?.errors) ? data.errors.map(item => item.message || item.code).join('; ') : '') || error?.message || String(error);
  if (status === 401 || status === 403) return `被拒绝（${status}）：令牌无效、已过期，或没有写入这个仓库的权限。${detail ? `（${detail}）` : ''}`;
  if (status === 413) return '附件太大，服务器拒绝接收（413）。';
  return status ? `服务器返回 ${status}：${detail}` : detail;
}
let lastPercent = -1;
function progress({ loaded, total }) {
  const percent = total ? Math.floor(loaded / total * 100) : 0;
  if (percent !== lastPercent && percent % 5 === 0) { lastPercent = percent; console.log(`  上传中… ${percent}%`); }
}

async function publishGithub(token, data, body) {
  const api = `https://api.github.com/repos/${owner}/${repo}`;
  const headers = { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'GuojuDesktop-Release' };
  const { data: info } = await axios.get(api, { headers, timeout: 20000 });
  const branch = info.default_branch || 'main';
  // A release needs a commit to point at; give an empty repository a README first.
  try { await axios.get(`${api}/commits`, { headers, params: { per_page: 1 }, timeout: 20000 }); }
  catch (error) {
    if (error?.response?.status !== 409) throw error;
    await axios.put(`${api}/contents/README.md`, {
      message: 'Initial commit', branch,
      content: Buffer.from(`# 果剧桌面\n\n非官方 Windows 短剧桌面播放器。安装包见 Releases。\n`).toString('base64')
    }, { headers, timeout: 20000 });
    console.log('  仓库是空的，已创建 README.md 作为第一个提交。');
  }
  let release = null;
  try { ({ data: release } = await axios.get(`${api}/releases/tags/${tag}`, { headers, timeout: 20000 })); }
  catch (error) { if (error?.response?.status !== 404) throw error; }
  if (release?.id) {
    console.log(`  发行版 ${tag} 已存在，继续使用它。`);
    if ((release.assets || []).some(asset => asset.name === fileName)) fail(`发行版 ${tag} 里已经有 ${fileName}，无需重复上传。`);
  } else {
    ({ data: release } = await axios.post(`${api}/releases`, { tag_name: tag, name: `果剧桌面 ${tag}`, body, target_commitish: branch, draft: false, prerelease: false }, { headers, timeout: 30000 }));
    console.log(`  已创建发行版 ${tag}（分支 ${branch}）。`);
  }
  await axios.post(`https://uploads.github.com/repos/${owner}/${repo}/releases/${release.id}/assets`, data, {
    params: { name: fileName },
    headers: { ...headers, 'Content-Type': 'application/octet-stream', 'Content-Length': data.length },
    maxBodyLength: Infinity, maxContentLength: Infinity, timeout: 60 * 60 * 1000, onUploadProgress: progress
  });
  return `https://github.com/${owner}/${repo}/releases/tag/${tag}`;
}

async function publishGitee(token, data, body) {
  const api = `https://gitee.com/api/v5/repos/${owner}/${repo}`;
  const { data: info } = await axios.get(api, { params: { access_token: token }, timeout: 20000 });
  const branch = info.default_branch || 'master';
  let release = null;
  try { ({ data: release } = await axios.get(`${api}/releases/tags/${tag}`, { params: { access_token: token }, timeout: 20000 })); }
  catch (error) { if (error?.response?.status !== 404) throw error; }
  if (release?.id) {
    console.log(`  发行版 ${tag} 已存在，继续使用它。`);
    if ((release.assets || []).some(asset => asset.name === fileName)) fail(`发行版 ${tag} 里已经有 ${fileName}，无需重复上传。`);
  } else {
    ({ data: release } = await axios.post(`${api}/releases`, null, {
      params: { access_token: token, tag_name: tag, name: `果剧桌面 ${tag}`, body, prerelease: false, target_commitish: branch }, timeout: 30000
    }));
    console.log(`  已创建发行版 ${tag}（分支 ${branch}）。`);
  }
  const form = new FormData();
  form.append('access_token', token);
  form.append('file', new Blob([data], { type: 'application/vnd.microsoft.portable-executable' }), fileName);
  await axios.post(`${api}/releases/${release.id}/attach_files`, form, {
    maxBodyLength: Infinity, maxContentLength: Infinity, timeout: 3 * 60 * 60 * 1000, onUploadProgress: progress
  });
  return `https://gitee.com/${owner}/${repo}/releases/tag/${tag}`;
}

(async () => {
  if (!['github', 'gitee'].includes(provider) || !owner || !repo) fail('package.json 里的 updater 需要设置 provider（github / gitee）、owner 和 repo。');
  const token = readToken(provider);
  if (!token) fail(`没有找到 ${provider === 'github' ? 'GitHub' : 'Gitee'} 令牌。请把令牌单独保存到 ${path.join(os.homedir(), `.${provider}_token.txt`)}，或设置 $env:${provider.toUpperCase()}_TOKEN。`);
  if (!fs.existsSync(exe)) fail(`找不到 ${path.relative(root, exe)}，请先运行 npm run build。`);

  const data = fs.readFileSync(exe);
  const sha256 = crypto.createHash('sha256').update(data).digest('hex');
  const body = `${notes}\n\nSHA256: ${sha256}`;
  console.log(`准备发布 ${tag} 到 ${provider === 'github' ? 'github.com' : 'gitee.com'}/${owner}/${repo}`);
  console.log(`  文件：${fileName}（${(data.length / 1048576).toFixed(1)} MB）`);
  console.log(`  SHA256：${sha256}`);
  try {
    const url = provider === 'github' ? await publishGithub(token, data, body) : await publishGitee(token, data, body);
    console.log('  上传完成。');
    console.log(`\n✓ 已发布：${url}`);
    console.log('  已安装的果剧桌面下次启动几秒后会提示更新。\n');
  } catch (error) {
    fail(explain(error));
  }
})();
