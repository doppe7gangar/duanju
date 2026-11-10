const { test } = require('node:test');
const assert = require('node:assert/strict');
const { gunzipSync } = require('node:zlib');
const { createHash } = require('node:crypto');
const axios = require('axios');
const appSource = require('../../src/server/native/app-source');
function model(vid, nested = true) {
  const entries = { [vid]: { video_model: { video_list: { video_1: {
    codec_type: 'h264', width: 720, height: 1280, definition: '720p',
    main_url: 'https://example.fqnovelvod.com/test.mp4',
  } } } } };
  return { code: 0, data: nested ? { video_model_data: entries } : entries };
}

function mockTransport(t, playback) {
  const adapter = axios.defaults.adapter;
  let registrations = 0;
  axios.defaults.adapter = async config => {
    const data = config.url.includes('/device_register/')
      ? { code: 0, device_id_str: String(++registrations), install_id_str: String(100 + registrations) }
      : await playback(config);
    return { data: typeof data === 'string' ? data : JSON.stringify(data), status: 200, statusText: 'OK', headers: {}, config };
  };
  t.after(() => { axios.defaults.adapter = adapter; });
  return () => registrations;
}

test('current video_tab GET binds its query, version and nested model to the selected episode', async t => {
  const vid = '7702764976515075096';
  mockTransport(t, config => {
    const url = new URL(config.url);
    assert.equal(config.method, 'get');
    assert.equal(url.pathname, '/reading/bookapi/video_tab/multi_video_model/v1/');
    assert.equal(url.searchParams.get('video_id'), vid);
    assert.equal(config.headers.get('x-ss-req-ticket'), url.searchParams.get('_rticket'));
    assert.equal(url.searchParams.get('version_name'), '7.3.9.32');
    assert.equal(url.searchParams.get('version_code'), '73932');
    assert.equal(url.searchParams.get('need_all_video_definition'), '1');
    assert.equal(config.headers.get('x-khronos'), url.searchParams.get('ts'));
    assert.match(config.headers.get('User-Agent'), /com\.phoenix\.read\/73932/);
    assert.equal(config.headers.get('Content-Encoding'), undefined);
    assert.equal(config.headers.get('x-ss-stub'), undefined);
    assert.ok(config.data == null);
    return model(vid);
  });
  const result = await appSource.fetchAppPlayUrl(vid);
  assert.equal(result.vid, vid);
  assert.equal(result.codec, 'h264');
});

test('empty video_tab response retries the gzip legacy API with a fresh device', async t => {
  const vid = '7702764976515075096';
  const devices = [];
  const registrations = mockTransport(t, config => {
      const url = new URL(config.url);
      devices.push(url.searchParams.get('device_id'));
      if (config.method === 'get') return '';
      assert.equal(url.pathname, '/novel/player/multi_video_model/v1/');
      assert.equal(config.headers.get('Content-Encoding'), 'gzip');
      assert.ok(Buffer.isBuffer(config.data));
      assert.equal(config.headers.get('x-ss-stub'), createHash('md5').update(config.data).digest('hex').toUpperCase());
      assert.equal(config.headers.get('x-ss-req-ticket'), url.searchParams.get('_rticket'));
      assert.equal(url.searchParams.get('version_name'), '7.4.3.32');
      const payload = JSON.parse(gunzipSync(config.data));
      assert.deepEqual(payload.mixed_video_id_map, { '1004': [vid] });
      return model(vid, false);
  });
  const result = await appSource.fetchAppPlayUrl(vid);
  assert.equal(result.vid, vid);
  assert.equal(registrations(), 2);
  assert.notEqual(devices[0], devices[1]);
});

test('simultaneous playback and prefetch reserve independent single-use devices', async t => {
  const devices = [];
  const registrations = mockTransport(t, async config => {
    const url = new URL(config.url);
    devices.push(url.searchParams.get('device_id'));
    await new Promise(resolve => setTimeout(resolve, 5));
    return model(url.searchParams.get('video_id'));
  });
  const vids = ['7702764976515075096', '7702765030164401176', '7679446197634862142'];
  const results = await Promise.all(vids.map(vid => appSource.fetchAppPlayUrl(vid)));
  assert.deepEqual(results.map(result => result.vid), vids);
  assert.equal(registrations(), 3);
  assert.equal(new Set(devices).size, 3);
});

test('video_tab rejects a model belonging to another episode', async t => {
  mockTransport(t, () => model('999999'));
  await assert.rejects(appSource.fetchAppPlayUrl('7702764976515075096'), { code: 'MISSING_MODEL' });
});
