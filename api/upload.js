'use strict';
const A = require('./_lib/auth');
const store = require('./_lib/store');

const MAX = 4.3 * 1024 * 1024; // Vercel functions accept request bodies up to 4.5 MB (old upload path)

// Direct-to-R2 uploads (no Vercel size limit): originals are kept as they are.
const IMG = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'image/avif': 'avif' };
const VID = { 'video/mp4': 'mp4', 'video/webm': 'webm', 'video/quicktime': 'mov' };
const MAX_IMG_DIRECT = 100 * 1024 * 1024;
const MAX_VID = 1024 * 1024 * 1024;
const slug = (n) => String(n || 'file').replace(/\.[a-z0-9]+$/i, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'file';

function kind(b) {
  if (b.length > 12 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return ['jpg', 'image/jpeg'];
  if (b.length > 8 && b.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return ['png', 'image/png'];
  if (b.length > 12 && b.slice(0, 4).toString() === 'RIFF' && b.slice(8, 12).toString() === 'WEBP') return ['webp', 'image/webp'];
  if (b.length > 6 && /^GIF8[79]a/.test(b.slice(0, 6).toString())) return ['gif', 'image/gif'];
  if (b.length > 12 && b.slice(4, 8).toString() === 'ftyp' && /avif|avis/.test(b.slice(8, 12).toString())) return ['avif', 'image/avif'];
  return null;
}

function friendly(e) {
  const n = (e && (e.name || e.Code)) || '';
  if (/InvalidAccessKeyId|SignatureDoesNotMatch|InvalidToken/i.test(n)) return 'Cloudflare rejected the keys. Re-check R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY (and R2_ACCOUNT_ID) in Vercel, then redeploy.';
  if (/AccessDenied|Forbidden/i.test(n)) return 'The R2 token has no permission for this bucket. Create a token with "Object Read & Write" for the bucket, and update the two key variables.';
  if (/NoSuchBucket/i.test(n)) return 'Bucket not found. Check that R2_BUCKET matches the bucket name exactly.';
  return 'Could not reach R2: ' + ((e && e.message) || n || 'unknown error') + '. Check R2_ACCOUNT_ID.';
}

module.exports = async (req, res) => {
  try {
    if (req.method === 'GET') {
      const s = await A.session(req);
      if (!s) return A.send(res, 401, { error: 'Please log in again.' });
      const files = await store.listFiles('uploads/');
      return A.send(res, 200, { items: files.slice(0, 300).map((f) => ({ url: f.url, name: f.pathname.split('/').pop(), size: f.size, uploadedAt: f.uploadedAt })) });
    }
    if (req.method !== 'POST') return A.send(res, 405, { error: 'Method not allowed.' });
    const s = await A.requireWriter(req, res);
    if (!s) return;

    const action = new URL(req.url, 'http://x').searchParams.get('action');

    // "Check storage" button in the admin: verifies keys + bucket here, the browser then tests upload (CORS) and the public link.
    if (action === 'check') {
      if (!store.useR2) return A.send(res, 200, { direct: false, message: 'Cloudflare R2 is not set up (the R2_ variables are missing in Vercel). Uploads use the old path: images only, up to 4.3 MB.' });
      try {
        const old = await store.listFiles('uploads/_check/');
        if (old.length) await store.removeFiles(old.map((f) => f.pathname));
      } catch (e) {
        return A.send(res, 200, { direct: true, storageOk: false, error: friendly(e) });
      }
      const r = await store.presignPut('uploads/_check/storage-check.png', 'image/png');
      return A.send(res, 200, { direct: true, storageOk: true, uploadUrl: r.uploadUrl, url: r.url });
    }

    if (action === 'sign') {
      if (!store.useR2) return A.send(res, 200, { direct: false });
      const b = await A.readJSON(req, 10 * 1024);
      const type = String(b.type || '').toLowerCase();
      const size = Number(b.size);
      const ext = IMG[type] || VID[type];
      if (!ext) return A.send(res, 400, { error: 'Only JPG, PNG, WebP, GIF, AVIF images or MP4, WebM, MOV videos can be uploaded.' });
      const isVideo = !!VID[type];
      if (!(size > 0)) return A.send(res, 400, { error: 'The file looks empty.' });
      if (size > (isVideo ? MAX_VID : MAX_IMG_DIRECT)) return A.send(res, 400, { error: 'That file is too big (limit: 1 GB for video, 100 MB for images).' });
      const ym = new Date().toISOString().slice(0, 7);
      const r = await store.presignPut('uploads/' + ym + '/' + slug(b.name) + '.' + ext, type);
      return A.send(res, 200, { direct: true, uploadUrl: r.uploadUrl, url: r.url });
    }

    const buf = await A.readBody(req, MAX);
    const k = kind(buf);
    if (!k) return A.send(res, 400, { error: 'Only JPG, PNG, WebP, GIF or AVIF images can be uploaded.' });
    const url = new URL(req.url, 'http://x');
    const base = String(url.searchParams.get('name') || 'image').replace(/\.[a-z0-9]+$/i, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'image';
    const ym = new Date().toISOString().slice(0, 7);
    const out = await store.putFile('uploads/' + ym + '/' + base + '.' + k[0], buf, k[1]);
    return A.send(res, 200, { url: out, size: buf.length });
  } catch (e) {
    return A.send(res, e.status || 500, { error: e.message || 'Upload failed.' });
  }
};
