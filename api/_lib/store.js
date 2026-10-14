'use strict';
// Storage layer. Priority: Cloudflare R2 (R2_* env vars) > Vercel Blob > local .data folder
// (local fallback lets you try the admin panel with node dev-server.js without any account).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// ---- Cloudflare R2 (S3-compatible) ----
const R2 = {
  account: process.env.R2_ACCOUNT_ID,
  key: process.env.R2_ACCESS_KEY_ID,
  secret: process.env.R2_SECRET_ACCESS_KEY,
  bucket: process.env.R2_BUCKET,
  pub: String(process.env.R2_PUBLIC_URL || '').replace(/\/+$/, '')
};
const useR2 = !!(R2.account && R2.key && R2.secret && R2.bucket && R2.pub);

const TOKEN = process.env.BLOB_READ_WRITE_TOKEN;
const useBlob = !useR2 && !!(TOKEN || process.env.BLOB_STORE_ID);
const LOCAL = path.join(process.cwd(), '.data');

function ensureConfigured() {
  if (!useR2 && !useBlob && process.env.VERCEL) {
    const e = new Error('Storage is not connected. Add the R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET and R2_PUBLIC_URL environment variables in Vercel, then redeploy.');
    e.status = 500;
    throw e;
  }
}

let _s3;
function s3() {
  if (_s3) return _s3;
  const m = require('@aws-sdk/client-s3');
  const client = new m.S3Client({
    region: 'auto',
    endpoint: 'https://' + R2.account + '.r2.cloudflarestorage.com',
    credentials: { accessKeyId: R2.key, secretAccessKey: R2.secret }
  });
  _s3 = { client, m };
  return _s3;
}
const r2Url = (key) => R2.pub + '/' + key.split('/').map(encodeURIComponent).join('/');

async function r2List(prefix) {
  const { client, m } = s3();
  let token, out = [];
  do {
    const r = await client.send(new m.ListObjectsV2Command({ Bucket: R2.bucket, Prefix: prefix, ContinuationToken: token }));
    (r.Contents || []).forEach((o) => out.push({ pathname: o.Key, url: r2Url(o.Key), size: o.Size, uploadedAt: new Date(o.LastModified).toISOString() }));
    token = r.IsTruncated ? r.NextContinuationToken : undefined;
  } while (token);
  return out;
}
async function r2Get(key) {
  const { client, m } = s3();
  try {
    const r = await client.send(new m.GetObjectCommand({ Bucket: R2.bucket, Key: key }));
    return await r.Body.transformToString();
  } catch (e) {
    if (e && (e.name === 'NoSuchKey' || (e.$metadata && e.$metadata.httpStatusCode === 404))) return null;
    throw e;
  }
}
async function r2Put(key, body, contentType, cacheControl) {
  const { client, m } = s3();
  await client.send(new m.PutObjectCommand({ Bucket: R2.bucket, Key: key, Body: body, ContentType: contentType, CacheControl: cacheControl }));
}
async function r2Delete(keys) {
  const { client, m } = s3();
  for (const k of keys) await client.send(new m.DeleteObjectCommand({ Bucket: R2.bucket, Key: k }));
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
  if (useR2) {
    const hit = newest((await r2List(key)).filter((b) => b.pathname.endsWith('.json')))[0];
    if (!hit) return null;
    const txt = await r2Get(hit.pathname);
    return txt ? JSON.parse(txt) : null;
  }
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
  if (useR2) {
    const k = opts.secret ? key + '-' + crypto.randomBytes(12).toString('hex') + '.json' : key + '.json';
    await r2Put(k, body, 'application/json', 'max-age=60');
    if (opts.secret) {
      const old = (await r2List(key)).filter((b) => b.pathname !== k && b.pathname.endsWith('.json')).map((b) => b.pathname);
      if (old.length) await r2Delete(old);
    }
    return;
  }
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
  const items = useR2 ? await r2List(prefix) : useBlob ? await listBlobs(prefix) : localList(prefix);
  return newest(items).map((b) => ({ pathname: b.pathname, url: b.url, size: b.size, uploadedAt: b.uploadedAt }));
}

async function fetchJSONByPathname(pathname) {
  ensureConfigured();
  if (useR2) {
    const txt = await r2Get(pathname);
    return txt ? JSON.parse(txt) : null;
  }
  const hit = (await listFiles(pathname)).find((b) => b.pathname === pathname);
  if (!hit) return null;
  if (useBlob) return (await fetch(hit.url + '?t=' + Date.now(), { cache: 'no-store' })).json();
  return JSON.parse(fs.readFileSync(path.join(LOCAL, pathname), 'utf8'));
}

async function removeFiles(pathnames) {
  if (!pathnames.length) return;
  if (useR2) { await r2Delete(pathnames); return; }
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
  if (useR2) {
    const dot = pathname.lastIndexOf('.');
    const k = (dot > pathname.lastIndexOf('/') ? pathname.slice(0, dot) : pathname) + '-' + crypto.randomBytes(5).toString('hex') + (dot > pathname.lastIndexOf('/') ? pathname.slice(dot) : '');
    await r2Put(k, buffer, contentType, 'public, max-age=31536000, immutable');
    return r2Url(k);
  }
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

module.exports = { getJSON, putJSON, listFiles, fetchJSONByPathname, removeFiles, putFile, useBlob: useBlob || useR2, useR2, LOCAL };
