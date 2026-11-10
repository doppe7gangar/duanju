const path = require('node:path');
const root = path.join(__dirname, '..');
process.env.HONGGUO_CLIENT_DIR = path.join(root, 'ui');
process.env.HONGGUO_EXTENSION_MODULE = path.join(root, 'extra-routes.js');
process.env.HONGGUO_DATA_DIR = path.join(root, 'smoke-data');
process.env.HONGGUO_LOG_DIR = path.join(root, 'smoke-logs');

async function main() {
  const { server, port } = await require('../vendor/hongguo-open-player/src/server').startServer(0);
  const origin = `http://127.0.0.1:${port}`;
  try {
    const home = await fetch(origin);
    if (!home.ok) throw new Error(`Home HTTP ${home.status}`);
    const cookie = home.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');
    // Concurrent requests reproduce playback plus next-episode prefetch.
    const results = await Promise.all(['7702764976515075096', '7702765030164401176', '7679446197634862142'].map(async vid => {
      const start = Date.now();
      const response = await fetch(`${origin}/api/stream/${vid}?quality=auto`, {
        headers: { Cookie: cookie, Range: 'bytes=0-32767' }, signal: AbortSignal.timeout(40000),
      });
      const buffer = Buffer.from(await response.arrayBuffer());
      if (response.status !== 206 || buffer.length !== 32768 || buffer.toString('ascii', 4, 8) !== 'ftyp') {
        throw new Error(`Stream ${vid}: HTTP ${response.status}, ${buffer.length} bytes`);
      }
      return { vid, status: response.status, bytes: buffer.length, elapsed: Date.now() - start };
    }));
    console.log(JSON.stringify({ ok: true, results }));
  } finally {
    server.closeAllConnections();
    server.close();
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
