'use strict';
// Episode / series comments and replies from the 红果 app comment API — the same signed endpoint the
// danmaku module already uses (/novel/commentapi/…), with the parameters the app sends for its
// comment tab. Read-only and anonymous: no account, cookie or login is involved.
//
// The endpoint is not a public API. It can change or start refusing requests at any time, so every
// failure resolves to { success: false, error } and the caller falls back to the website preview.

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const axios = require('axios');
const sign = require('./vendor/hongguo-open-player/src/server/native/danmaku-sign');

const BASE_URL = 'https://api5-normal-sinfonlineb.fqnovel.com';
// Must match the client the signature parameters were generated for.
const USER_AGENT = 'com.phoenix.read/73532 (Linux; U; Android 16; zh_CN; 25053RT47C; Build/BP2A.250605.031.A3; ' +
  'Cronet/TTNetVersion:04657795 2026-01-23 QuicVersion:c67e9834 2025-09-08)';
const TIMEOUT = 12000;
const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;
const PAGE_SIZE = 20;
const CACHE_TTL = 60 * 1000;

const KINDS = {
  // Comments under one episode (the app's 评论 tab in the player).
  episode: { group_type: 30, comment_type: 4, comment_source: 4, server_channel: 18 },
  // Comments on the whole series (the app's 剧评).
  series: { group_type: 1, comment_type: 2, comment_source: 1, server_channel: 46 }
};

// A stable anonymous client id, reused across restarts like the danmaku module does.
let identity = null;
function clientIdentity() {
  if (identity) return identity;
  const create = () => ({ deviceId: sign.newDeviceId(), installId: sign.newDeviceId() });
  const dir = process.env.HONGGUO_DATA_DIR;
  if (!dir) return (identity = create());
  const file = path.join(dir, 'comment-client.json');
  try {
    const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (/^\d{19}$/.test(saved?.deviceId) && /^\d{19}$/.test(saved?.installId)) return (identity = { deviceId: saved.deviceId, installId: saved.installId });
  } catch (_) { /* create below */ }
  identity = create();
  try { fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(file, JSON.stringify(identity), { mode: 0o600 }); } catch (_) {}
  return identity;
}

async function post(pathname, body) {
  const stampMs = Date.now();
  const { deviceId, installId } = clientIdentity();
  const rawQuery = sign.buildQuery({ stampMs, deviceId, installId });
  const headers = {
    'User-Agent': USER_AGENT,
    Accept: 'application/json',
    'X-XS-From-Web': '0',
    'Sdk-Version': '2',
    'Content-Type': 'application/json; charset=utf-8',
    'Comment-Source': String(body.comment_source),
    'Server-Channel': String(body.server_channel),
    ...sign.signCommentHeaders({ rawQuery, stamp: Math.floor(stampMs / 1000), nonce: crypto.randomBytes(sign.NONCE_BYTES) })
  };
  const response = await axios.post(`${BASE_URL}${pathname}?${rawQuery}`, JSON.stringify(body), {
    headers, timeout: TIMEOUT, signal: AbortSignal.timeout(TIMEOUT), maxRedirects: 0,
    responseType: 'text', maxContentLength: MAX_RESPONSE_BYTES
  });
  const payload = JSON.parse(typeof response.data === 'string' ? response.data : JSON.stringify(response.data));
  if ((payload?.code !== 0 && payload?.code !== '0') || !payload?.data || typeof payload.data !== 'object') {
    throw new Error(payload?.message ? `评论接口：${payload.message}` : '评论接口响应无效');
  }
  return payload.data;
}

const text = (value, max) => (typeof value === 'string' ? value.trim().slice(0, max) : '');
const count = value => (Number.isSafeInteger(Number(value)) && Number(value) >= 0 ? Number(value) : 0);
const httpsImage = value => {
  const url = text(value, 4096).replace(/^http:\/\//i, 'https://');
  return /^https:\/\//.test(url) ? url : '';
};
function toItem(raw) {
  const common = raw?.common || raw?.Common || {};
  const user = common.user_info?.base_info || {};
  const content = text(common.content?.text, 5000);
  const id = text(String(raw?.comment_id || raw?.reply_id || ''), 40);
  if (!content || !/^\d{1,30}$/.test(id)) return null;
  const created = count(common.create_timestamp);
  return {
    id, content,
    author: user.is_cancelled ? '已注销用户' : text(user.user_name, 60),
    avatar: httpsImage(user.user_avatar || user.expand_user_avatar),
    likes: count(raw?.stat?.digg_count),
    replies: count(raw?.stat?.reply_count),
    created_at: created ? created * 1000 : null
  };
}
// Cursors are opaque strings issued by the upstream; only pass back what looks like one.
function validCursor(cursor) {
  return typeof cursor === 'string' && cursor.length <= 1000 ? cursor : '';
}

const cache = new Map();
function cached(key, load) {
  const hit = cache.get(key);
  if (hit && hit.expires > Date.now()) return hit.promise;
  const promise = load().catch(error => { cache.delete(key); throw error; });
  cache.set(key, { expires: Date.now() + CACHE_TTL, promise });
  if (cache.size > 100) cache.delete(cache.keys().next().value);
  return promise;
}

/** One page of episode or series comments. */
async function fetchComments({ seriesId, vid, kind = 'episode', cursor = '' }) {
  try {
    if (!/^\d{6,30}$/.test(seriesId) || (kind === 'episode' && !/^\d{6,30}$/.test(vid)) || !KINDS[kind]) return { success: false, error: '评论请求编号无效' };
    cursor = validCursor(cursor);
    const group = kind === 'series' ? seriesId : vid;
    const body = {
      group_id: group, ...KINDS[kind], sort: 1, count: PAGE_SIZE, cursor, aid: 8662, compliance_status: 0,
      business_param: { book_id: seriesId, need_count: !cursor, ...(kind === 'episode' ? { sort: 'video_innerflow' } : {}) }
    };
    const data = await cached(`${kind}:${group}:${cursor}`, () => post(`/novel/commentapi/comment/list/${group}/v1/`, body));
    const info = data.common_list_info || {};
    const items = (Array.isArray(data.data_list) ? data.data_list : []).map(row => toItem(row?.comment)).filter(Boolean);
    return {
      success: true, source: 'app', scope: kind, items,
      total: info.total === undefined ? null : count(info.total),
      has_more: info.has_more === true && typeof info.cursor === 'string' && !!info.cursor,
      cursor: typeof info.cursor === 'string' ? info.cursor : ''
    };
  } catch (error) {
    return { success: false, error: error?.message || '评论暂时不可用' };
  }
}

/** One page of replies under a comment. */
async function fetchReplies({ seriesId, vid, commentId, cursor = '' }) {
  try {
    if (!/^\d{6,30}$/.test(seriesId) || !/^\d{6,30}$/.test(vid) || !/^\d{1,30}$/.test(commentId)) return { success: false, error: '回复请求编号无效' };
    cursor = validCursor(cursor);
    const body = {
      group_id: vid, ...KINDS.episode, comment_source: 504, comment_id: commentId, sort: 1, count: PAGE_SIZE, cursor,
      aid: 8662, compliance_status: 0, business_param: { book_id: seriesId, need_count: false }
    };
    const data = await cached(`reply:${commentId}:${cursor}`, () => post(`/novel/commentapi/reply/list/${commentId}/v1/`, body));
    const info = data.comment_list_info || {};
    return {
      success: true, items: (Array.isArray(data.reply_list) ? data.reply_list : []).map(toItem).filter(Boolean),
      has_more: info.has_more === true && typeof info.cursor === 'string' && !!info.cursor,
      cursor: typeof info.cursor === 'string' ? info.cursor : ''
    };
  } catch (error) {
    return { success: false, error: error?.message || '回复暂时不可用' };
  }
}

module.exports = { fetchComments, fetchReplies };
