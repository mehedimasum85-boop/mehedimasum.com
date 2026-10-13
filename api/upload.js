'use strict';
const A = require('./_lib/auth');
const store = require('./_lib/store');

const MAX = 4.3 * 1024 * 1024; // Vercel functions accept request bodies up to 4.5 MB

function kind(b) {
  if (b.length > 12 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return ['jpg', 'image/jpeg'];
  if (b.length > 8 && b.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return ['png', 'image/png'];
  if (b.length > 12 && b.slice(0, 4).toString() === 'RIFF' && b.slice(8, 12).toString() === 'WEBP') return ['webp', 'image/webp'];
  if (b.length > 6 && /^GIF8[79]a/.test(b.slice(0, 6).toString())) return ['gif', 'image/gif'];
  if (b.length > 12 && b.slice(4, 8).toString() === 'ftyp' && /avif|avis/.test(b.slice(8, 12).toString())) return ['avif', 'image/avif'];
  return null;
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
