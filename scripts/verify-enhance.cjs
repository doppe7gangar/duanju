// Exercise the actual WebGL renderer in Electron with low-contrast fine texture.
// Run: electron scripts/verify-enhance.cjs [optional previous enhance.js]
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.join(__dirname, '..');
app.setPath('userData', path.join(root, 'smoke-data/enhance-profile'));

app.whenReady().then(async () => {
  const window = new BrowserWindow({ show: false, webPreferences: { offscreen: true } });
  const render = async (code, scale = 1) => {
    await window.loadURL('data:text/html,<body>Enhancement verification</body>');
    return window.webContents.executeJavaScript(`(async () => {
      document.body.innerHTML = '<div id="theater"><div id="frame" style="width:${256 * scale}px;height:${256 * scale}px"><canvas id="enhance-canvas"></canvas></div></div><select id="enhance"><option value="0">off</option><option value="0.5">standard</option><option value="0.9" selected>strong</option><option value="ultra">fine</option></select><select id="fit"></select>';
      window.$ = selector => document.querySelector(selector);
      const source = document.createElement('canvas');
      source.width = source.height = 256;
      source.videoWidth = source.videoHeight = 256;
      source.readyState = 2;
      window.video = source;
      const ctx = source.getContext('2d');
      const pixels = ctx.createImageData(256, 256);
      for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) {
        const i = (y * 256 + x) * 4;
        // Low-contrast four-pixel texture next to a clean high-contrast edge.
        const v = x < 128 ? 128 + 5 * Math.cos(x * Math.PI / 2) : (x < 192 ? 48 : 208);
        pixels.data.set([v, v, v, 255], i);
      }
      ctx.putImageData(pixels, 0, 0);
      ${code}
      const canvas = $('#enhance-canvas');
      const select = $('#enhance');
      function capture(mode) {
        select.value = mode;
        select.dispatchEvent(new Event('change'));
        const gl = canvas.getContext('webgl');
        if (canvas.hidden || !canvas.classList.contains('live') || !gl) throw new Error('Renderer fell back');
        const rgba = new Uint8Array(canvas.width * canvas.height * 4);
        gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, rgba);
        const row = Math.floor(canvas.height / 2);
        let lo = 255, hi = 0;
        for (let x = Math.round(16 * ${scale}); x < Math.round(112 * ${scale}); x++) {
          const value = rgba[(row * canvas.width + x) * 4];
          lo = Math.min(lo, value); hi = Math.max(hi, value);
        }
        return { textureContrast: hi - lo, width: canvas.width, height: canvas.height, error: gl.getError() };
      }
      const strong = capture('0.9');
      const fine = capture('ultra');
      const switchedBack = capture('0.9');
      select.value = '0'; select.dispatchEvent(new Event('change'));
      const off = canvas.hidden && !canvas.classList.contains('live');
      return { strong, fine, switchedBack, off };
    })()`);
  };
  try {
    const code = fs.readFileSync(path.join(root, 'ui/enhance.js'), 'utf8');
    const results = [];
    for (const scale of [1, 1.5, 0.4]) {
      const result = await render(code, scale);
      for (const mode of ['strong', 'fine', 'switchedBack']) assert.equal(result[mode].error, 0);
      assert.deepEqual(result.switchedBack, result.strong, 'Switching from fine must restore strong');
      assert.equal(result.off, true);
      assert.ok(result.fine.textureContrast > 0, 'Fine texture must remain visible');
      if (scale === 1) assert.ok(result.fine.textureContrast >= result.strong.textureContrast,
        'Fine must not smooth away texture that strong retains at native size');
      results.push({ scale, ...result });
    }
    if (process.argv[2]) {
      const previous = await render(fs.readFileSync(path.resolve(process.argv[2]), 'utf8'));
      assert.ok(results[0].fine.textureContrast > previous.fine.textureContrast,
        'The replacement must preserve more fine texture than the old denoiser');
      results.push({ previous });
    }
    const output = JSON.stringify({ ok: true, results }, null, 2);
    fs.writeFileSync(path.join(root, 'smoke-data/enhance-result.json'), output);
    console.log(output);
  } catch (error) {
    console.error(error);
    fs.writeFileSync(path.join(root, 'smoke-data/enhance-result.json'), JSON.stringify({ ok: false, error: error.stack }));
    process.exitCode = 1;
  } finally {
    window.destroy();
    app.quit();
  }
});
