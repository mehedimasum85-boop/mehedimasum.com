'use strict';
const crypto = require('crypto');
const store = require('./store');

const DEFAULT_USER = process.env.ADMIN_USER || 'admin';
const DEFAULT_PASS = process.env.ADMIN_PASSWORD || 'Masum@Demo2026';
const COOKIE = 'admin_session';
const MAX_AGE = 60 * 60 * 12; // 12 hours
const AUTH_KEY = 'admin/auth';

// ---------- small http helpers ----------
function send(res, status, obj, headers) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  Object.keys(headers || {}).forEach((k) => res.setHeader(k, headers[k]));
  res.end(JSON.stringify(obj));
}
function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(Object.assign(new Error('Request is too large.'), { status: 413 })); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}
async function readJSON(req, limit) {
  const buf = await readBody(req, limit || 2 * 1024 * 1024);
  if (!buf.length) return {};
  try { return JSON.parse(buf.toString('utf8')); } catch (e) { throw Object.assign(new Error('Invalid JSON.'), { status: 400 }); }
}
function cookies(req) {
  const out = {};
  String(req.headers.cookie || '').split(';').forEach((p) => {
    const i = p.indexOf('=');
    if (i > 0) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim());
  });
  return out;
}

// ---------- secrets / tokens ----------
let devSecret;
function secret() {
  const s = process.env.SESSION_SECRET || process.env.BLOB_READ_WRITE_TOKEN;
  if (s) return s;
  if (process.env.VERCEL) throw Object.assign(new Error('SESSION_SECRET is not set.'), { status: 500 });
  return devSecret || (devSecret = crypto.randomBytes(32).toString('hex'));
}
const b64 = (b) => Buffer.from(b).toString('base64url');
function sign(payload) {
  const body = b64(JSON.stringify(payload));
  const mac = crypto.createHmac('sha256', secret()).update(body).digest('base64url');
  return body + '.' + mac;
}
function verify(token) {
  if (!token || token.indexOf('.') < 0) return null;
  const [body, mac] = token.split('.');
  const want = crypto.createHmac('sha256', secret()).update(body).digest('base64url');
  const a = Buffer.from(mac), b = Buffer.from(want);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    return p.exp > Date.now() / 1000 ? p : null;
  } catch (e) { return null; }
}

// ---------- password ----------
function hashPassword(pw, salt) {
  salt = salt || crypto.randomBytes(16).toString('hex');
  return { salt, hash: crypto.scryptSync(pw, salt, 64).toString('hex') };
}
function checkPassword(pw, rec) {
  const h = crypto.scryptSync(pw, rec.salt, 64);
  const want = Buffer.from(rec.hash, 'hex');
  return h.length === want.length && crypto.timingSafeEqual(h, want);
}
async function getAccount() {
  const rec = await store.getJSON(AUTH_KEY);
  if (rec) return Object.assign({ mustChange: false }, rec);
  return { username: DEFAULT_USER, isDefault: true, mustChange: true, pwv: 'default' };
}
async function saveAccount(username, password) {
  const h = hashPassword(password);
  const rec = { username, salt: h.salt, hash: h.hash, pwv: crypto.randomBytes(8).toString('hex'), updatedAt: new Date().toISOString() };
  await store.putJSON(AUTH_KEY, rec, { secret: true });
  return rec;
}
async function verifyLogin(username, password) {
  const acc = await getAccount();
  if (String(username).toLowerCase() !== String(acc.username).toLowerCase()) return null;
  if (acc.isDefault) {
    const a = Buffer.from(String(password)), b = Buffer.from(DEFAULT_PASS);
    return a.length === b.length && crypto.timingSafeEqual(a, b) ? acc : null;
  }
  return checkPassword(String(password), acc) ? acc : null;
}

// ---------- sessions ----------
function cookieHeader(req, value, maxAge) {
  const secure = String(req.headers['x-forwarded-proto'] || '').split(',')[0] === 'https' || !!process.env.VERCEL;
  return COOKIE + '=' + value + '; Path=/; HttpOnly; SameSite=Strict; Max-Age=' + maxAge + (secure ? '; Secure' : '');
}
async function session(req) {
  const p = verify(cookies(req)[COOKIE]);
  if (!p) return null;
  const acc = await getAccount();
  if (p.v !== (acc.pwv || 'default')) return null; // password changed: old sessions stop working
  return { username: acc.username, mustChange: !!acc.mustChange, account: acc };
}
function sameOrigin(req) {
  const o = req.headers.origin;
  if (!o) return true;
  try { return new URL(o).host === req.headers.host; } catch (e) { return false; }
}
// Guard for anything that changes data: logged in, same origin, custom header, and password already changed.
async function requireWriter(req, res) {
  if (!sameOrigin(req) || req.headers['x-requested-with'] !== 'admin') { send(res, 403, { error: 'Request blocked.' }); return null; }
  const s = await session(req);
  if (!s) { send(res, 401, { error: 'Please log in again.' }); return null; }
  if (s.mustChange) { send(res, 403, { error: 'Change the demo password first (Account page), then you can save.', code: 'must_change' }); return null; }
  return s;
}

// ---------- login rate limit (best effort; resets when the server instance restarts) ----------
const fails = new Map();
function limited(ip) {
  const f = fails.get(ip);
  return !!(f && f.n >= 6 && Date.now() - f.t < 10 * 60 * 1000);
}
function noteFail(ip) {
  const f = fails.get(ip);
  fails.set(ip, f && Date.now() - f.t < 10 * 60 * 1000 ? { n: f.n + 1, t: Date.now() } : { n: 1, t: Date.now() });
}
const clearFail = (ip) => fails.delete(ip);
const ipOf = (req) => String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();

module.exports = {
  send, readBody, readJSON, sign, verify, saveAccount, verifyLogin, getAccount, session, requireWriter,
  cookieHeader, sameOrigin, limited, noteFail, clearFail, ipOf, COOKIE, MAX_AGE
};
