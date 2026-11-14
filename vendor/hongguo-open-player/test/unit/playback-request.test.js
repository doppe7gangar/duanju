const { test } = require('node:test');
const assert = require('node:assert/strict');
const { gunzipSync } = require('node:zlib');
const { createHash } = require('node:crypto');
const axios = require('axios');
const appSource = require('../../src/server/native/app-source');
const { getPlaybackDevice } = require('../../src/server/native/playback-device');
function model(vid, nested = true) {
  const entries = { [vid]: { video_model: { video_list: { video_1: {
    codec_type: 'h264', width: 720, height: 1280, definition: '720p',
    main_url: 'https://example.fqnovelvod.com/test.mp4',
  } } } } };
  return { code: 0, data: nested ? { video_model_data: entries } : entries };
}

function mockTransport(t, playback) {
  getPlaybackDevice.reset();
  const adapter = axios.defaults.adapter;
  let registrations = 0;
  axios.defaults.adapter = async config => {
    const data = config.url.includes('/device_register/')
      ? { code: 0, device_id_str: String(++registrations), install_id_str: String(100 + registrations) }
      : await playback(config);
    return { data: typeof data === 'string' ? data : JSON.stringify(data), status: 200, statusText: 'OK', headers: {}, config };
  };
  t.after(() => { axios.defaults.adapter = adapter; getPlaybackDevice.reset(); });
  return () => registrations;
}

test('player POST binds full Argus/Ladon signatures and gzip body to the selected episode', async t => {
  const vid = '7702764976515075096';
  mockTransport(t, config => {
    const url = new URL(config.url);
    assert.equal(config.method, 'post');
    assert.equal(url.hostname, 'reading.snssdk.com');
    assert.equal(url.pathname, '/novel/player/multi_video_model/player/v1');
    assert.equal(url.searchParams.get('version_name'), '7.4.3.32');
    assert.equal(url.searchParams.get('version_code'), '74332');
    assert.match(config.headers.get('User-Agent'), /com\.phoenix\.read\/74332/);
    assert.equal(config.headers.get('Content-Encoding'), 'gzip');
    assert.equal(config.headers.get('x-ss-stub'), createHash('md5').update(config.data).digest('hex').toUpperCase());
    assert.ok(Buffer.from(config.headers.get('x-argus'), 'base64').length > 100);
    assert.ok(Buffer.from(config.headers.get('x-ladon'), 'base64').length > 20);
    assert.equal(config.headers.get('x-ss-req-ticket'), String(Number(config.headers.get('x-khronos')) * 1000));
    assert.match(config.headers.get('Cookie'), /install_id=101/);
    const payload = JSON.parse(gunzipSync(config.data));
    assert.deepEqual(payload.mixed_video_id_map, { '1004': [vid] });
    assert.equal(payload.dr_scene, 'player');
    return model(vid);
  });
  const result = await appSource.fetchAppPlayUrl(vid);
  assert.equal(result.vid, vid);
  assert.equal(result.codec, 'h264');
});

test('empty primary player response retries the signed backup using the registered device', async t => {
  const vid = '7702764976515075096';
  const devices = [];
  const registrations = mockTransport(t, config => {
      const url = new URL(config.url);
      devices.push(url.searchParams.get('device_id'));
      if (url.hostname === 'reading.snssdk.com') return '';
      assert.equal(url.hostname, 'api5-normal-sinfonlinea.fqnovel.com');
      assert.equal(url.pathname, '/novel/player/multi_video_model/player/v1');
      assert.equal(config.headers.get('Content-Encoding'), 'gzip');
      assert.ok(Buffer.isBuffer(config.data));
      assert.equal(config.headers.get('x-ss-stub'), createHash('md5').update(config.data).digest('hex').toUpperCase());
      assert.equal(url.searchParams.get('version_name'), '7.4.3.32');
      const payload = JSON.parse(gunzipSync(config.data));
      assert.deepEqual(payload.mixed_video_id_map, { '1004': [vid] });
      return model(vid, false);
  });
  const result = await appSource.fetchAppPlayUrl(vid);
  assert.equal(result.vid, vid);
  assert.equal(registrations(), 1);
  assert.equal(devices[0], devices[1]);
});

test('a device rejected by both player endpoints is replaced, and its successor keeps the working endpoint', async t => {
  const vid = '7702764976515075096';
  const calls = [];
  const registrations = mockTransport(t, config => {
    const url = new URL(config.url);
    const device = url.searchParams.get('device_id');
    calls.push(`${device}@${url.hostname}`);
    // Device 1 is dead on both endpoints; device 2 only answers the backup.
    if (device === '1' || url.hostname === 'reading.snssdk.com') return '';
    return model(vid);
  });
  assert.equal((await appSource.fetchAppPlayUrl(vid)).vid, vid);
  assert.equal(registrations(), 2);
  assert.deepEqual(calls, ['1@reading.snssdk.com', '1@api5-normal-sinfonlinea.fqnovel.com',
    '2@reading.snssdk.com', '2@api5-normal-sinfonlinea.fqnovel.com']);
  calls.length = 0;
  assert.equal((await appSource.fetchAppPlayUrl(vid)).vid, vid);
  assert.deepEqual(calls, ['2@api5-normal-sinfonlinea.fqnovel.com']);
  assert.equal(registrations(), 2);
});

test('playback gives up with EMPTY_RESPONSE after five dead devices', async t => {
  const registrations = mockTransport(t, () => '');
  await assert.rejects(appSource.fetchAppPlayUrl('7702764976515075096'), { code: 'EMPTY_RESPONSE' });
  assert.equal(registrations(), 5);
});

test('simultaneous playback and prefetch share one reusable registered identity', async t => {
  const devices = [];
  const registrations = mockTransport(t, async config => {
    const url = new URL(config.url);
    devices.push(url.searchParams.get('device_id'));
    await new Promise(resolve => setTimeout(resolve, 5));
    return model(JSON.parse(gunzipSync(config.data)).mixed_video_id_map['1004'][0]);
  });
  const vids = ['7702764976515075096', '7702765030164401176', '7679446197634862142'];
  const results = await Promise.all(vids.map(vid => appSource.fetchAppPlayUrl(vid)));
  assert.deepEqual(results.map(result => result.vid), vids);
  assert.equal(registrations(), 1);
  assert.equal(new Set(devices).size, 1);
});

test('player rejects a model belonging to another episode', async t => {
  mockTransport(t, () => model('999999'));
  await assert.rejects(appSource.fetchAppPlayUrl('7702764976515075096'), { code: 'MISSING_MODEL' });
});
