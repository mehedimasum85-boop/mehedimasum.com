'use strict';
// Storage layer. On Vercel it uses a Blob store (BLOB_READ_WRITE_TOKEN). Locally (node dev-server.js)
// it falls back to the .data folder so you can try the admin panel without any account.
const fs = require('fs');
const path = require('path');

const TOKEN = process.env.BLOB_READ_WRITE_TOKEN;
const useBlob = !!(TOKEN || process.env.BLOB_STORE_ID);
const LOCAL = path.join(process.cwd(), '.data');

function ensureConfigured() {
  if (!useBlob && process.env.VERCEL) {
    const e = new Error('Storage is not connected. In Vercel: Storage > Create a Blob store > Connect to this project, then redeploy.');
    e.status = 500;
    throw e;
  }
}

const blobLib = () => import('@vercel/blob');

async function listBlobs(prefix) {
  const { list } = await blobLib();
  let cursor, out = [];
  do {
    const r = await list({ prefix, cursor, limit: 1000 });
    out = out.concat(r.blobs);
    cursor = r.hasMore ? r.cursor : undefined;
  } while (cursor);
  return out;
}
const newest = (a) => a.slice().sort((x, y) => new Date(y.uploadedAt) - new Date(x.uploadedAt));

function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  let out = [];
  for (const n of fs.readdirSync(dir)) {
    const p = path.join(dir, n);
    if (fs.statSync(p).isDirectory()) out = out.concat(walk(p)); else out.push(p);
  }
  return out;
}
function localList(prefix) {
  return walk(LOCAL).map((f) => {
    const rel = path.relative(LOCAL, f).split(path.sep).join('/');
    const st = fs.statSync(f);
    return { pathname: rel, url: rel.startsWith('uploads/') ? '/' + rel : '', size: st.size, uploadedAt: st.mtime.toISOString() };
  }).filter((b) => b.pathname.startsWith(prefix));
}

// Read a JSON document stored under `key` (no extension). Returns null if missing.
async function getJSON(key) {
  ensureConfigured();
  if (useBlob) {
    const hit = newest((await listBlobs(key)).filter((b) => b.pathname.endsWith('.json')))[0];
    if (!hit) return null;
    const r = await fetch(hit.url + (hit.url.includes('?') ? '&' : '?') + 't=' + Date.now(), { cache: 'no-store' });
    if (!r.ok) throw new Error('Could not read ' + key);
    return r.json();
  }
  const f = path.join(LOCAL, key + '.json');
  return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : null;
}

// Write a JSON document. {secret:true} gives the file an unguessable name (used for the password file).
async function putJSON(key, obj, opts) {
  ensureConfigured();
  opts = opts || {};
  const body = JSON.stringify(obj);
  if (useBlob) {
    const { put, del } = await blobLib();
    const before = opts.secret ? await listBlobs(key) : [];
    const r = await put(key + '.json', body, {
      access: 'public', contentType: 'application/json', addRandomSuffix: !!opts.secret,
      allowOverwrite: !opts.secret, cacheControlMaxAge: 60
    });
    const old = before.filter((b) => b.url !== r.url).map((b) => b.url);
    if (old.length) await del(old);
    return;
  }
  const f = path.join(LOCAL, key + '.json');
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, body);
}

async function listFiles(prefix) {
  ensureConfigured();
  const items = useBlob ? await listBlobs(prefix) : localList(prefix);
  return newest(items).map((b) => ({ pathname: b.pathname, url: b.url, size: b.size, uploadedAt: b.uploadedAt }));
}

async function fetchJSONByPathname(pathname) {
  const hit = (await listFiles(pathname)).find((b) => b.pathname === pathname);
  if (!hit) return null;
  if (useBlob) return (await fetch(hit.url + '?t=' + Date.now(), { cache: 'no-store' })).json();
  return JSON.parse(fs.readFileSync(path.join(LOCAL, pathname), 'utf8'));
}

async function removeFiles(pathnames) {
  if (!pathnames.length) return;
  if (useBlob) {
    const all = await listFiles(pathnames[0].split('/')[0] + '/');
    const urls = all.filter((b) => pathnames.includes(b.pathname)).map((b) => b.url);
    if (urls.length) { const { del } = await blobLib(); await del(urls); }
    return;
  }
  pathnames.forEach((p) => { try { fs.unlinkSync(path.join(LOCAL, p)); } catch (e) {} });
}

// Save an uploaded image. Returns its public URL.
async function putFile(pathname, buffer, contentType) {
  ensureConfigured();
  if (useBlob) {
    const { put } = await blobLib();
    const r = await put(pathname, buffer, { access: 'public', contentType, addRandomSuffix: true, cacheControlMaxAge: 31536000 });
    return r.url;
  }
  const f = path.join(LOCAL, pathname);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, buffer);
  return '/' + pathname;
}

module.exports = { getJSON, putJSON, listFiles, fetchJSONByPathname, removeFiles, putFile, useBlob, LOCAL };
