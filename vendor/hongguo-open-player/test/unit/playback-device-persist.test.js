const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createPlaybackDeviceRegistrar } = require('../../src/server/native/playback-device');

function withDataDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'guoju-device-'));
  const previous = process.env.HONGGUO_DATA_DIR;
  process.env.HONGGUO_DATA_DIR = dir;
  t.after(() => {
    if (previous === undefined) delete process.env.HONGGUO_DATA_DIR; else process.env.HONGGUO_DATA_DIR = previous;
    fs.rmSync(dir, { recursive: true, force: true });
  });
  return path.join(dir, 'device.json');
}

function fakeRegister() {
  let count = 0;
  const requestJson = async () => ({ code: 0, device_id_str: String(500 + ++count), install_id_str: String(900 + count) });
  return { requestJson, count: () => count };
}

test('a verified device is saved and reused by the next launch without registering', async t => {
  const file = withDataDir(t);
  const first = createPlaybackDeviceRegistrar();
  const reg = fakeRegister();
  const device = await first(reg.requestJson);
  assert.equal(fs.existsSync(file), false, 'an unverified device is not saved');
  first.markVerified(device, 'https://example/api');
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).device_id, device.device_id);

  const relaunched = createPlaybackDeviceRegistrar();
  const reused = await relaunched(reg.requestJson);
  assert.equal(reg.count(), 1);
  assert.equal(reused.device_id, device.device_id);
  assert.equal(reused.api, 'https://example/api');
});

test('resetting a dead saved device deletes it and registers a fresh one', async t => {
  const file = withDataDir(t);
  fs.writeFileSync(file, JSON.stringify({ device_id: '123', iid: '456', cdid: 'abc', api: 'x' }));
  const registrar = createPlaybackDeviceRegistrar();
  const reg = fakeRegister();
  const saved = await registrar(reg.requestJson);
  assert.equal(saved.device_id, '123');
  assert.equal(registrar.reset(saved), true);
  const fresh = await registrar(reg.requestJson);
  assert.equal(fresh.device_id, '501');
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(fs.existsSync(file), false);
});

test('a corrupt device file is ignored', async t => {
  const file = withDataDir(t);
  fs.writeFileSync(file, '{not json');
  const reg = fakeRegister();
  assert.equal((await createPlaybackDeviceRegistrar()(reg.requestJson)).device_id, '501');
});
