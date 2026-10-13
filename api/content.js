'use strict';
const A = require('./_lib/auth');
const store = require('./_lib/store');

const KEY = 'site/content';
const HISTORY = 'history/content-';
const KEEP = 25;

module.exports = async (req, res) => {
  try {
    const url = new URL(req.url, 'http://x');

    if (req.method === 'GET') {
      // history list / one snapshot (admin only)
      if (url.searchParams.has('history')) {
        const s = await A.session(req);
        if (!s) return A.send(res, 401, { error: 'Please log in again.' });
        const id = url.searchParams.get('history');
        if (id) {
          if (!/^history\/content-[\w.-]+\.json$/.test(id)) return A.send(res, 400, { error: 'Bad id.' });
          const snap = await store.fetchJSONByPathname(id);
          return snap ? A.send(res, 200, snap) : A.send(res, 404, { error: 'Not found.' });
        }
        const list = (await store.listFiles(HISTORY)).map((f) => ({ id: f.pathname, savedAt: f.uploadedAt }));
        return A.send(res, 200, { items: list });
      }
      const doc = await store.getJSON(KEY);
      const fresh = url.searchParams.has('fresh');
      return A.send(res, 200, { rev: doc ? doc.rev : 0, content: doc ? doc.content : null },
        { 'Cache-Control': fresh ? 'no-store' : 'public, s-maxage=10, stale-while-revalidate=60' });
    }

    if (req.method === 'PUT') {
      const s = await A.requireWriter(req, res);
      if (!s) return;
      const b = await A.readJSON(req, 3 * 1024 * 1024);
      const c = b.content;
      if (!c || typeof c !== 'object' || !c.site || !c.pages || !c.pages.home || !c.portfolio) {
        return A.send(res, 400, { error: 'Content looks incomplete, nothing was saved.' });
      }
      const cur = await store.getJSON(KEY);
      const curRev = cur ? cur.rev : 0;
      if (Number(b.rev) !== curRev) {
        return A.send(res, 409, { error: 'The site was changed somewhere else (another tab or device). Reload the admin panel to get the latest version.', rev: curRev });
      }
      if (cur) {
        await store.putJSON(HISTORY + new Date().toISOString().replace(/[:.]/g, '-'), cur);
        const all = await store.listFiles(HISTORY);
        await store.removeFiles(all.slice(KEEP).map((f) => f.pathname));
      }
      await store.putJSON(KEY, { rev: curRev + 1, savedAt: new Date().toISOString(), content: c });
      return A.send(res, 200, { ok: true, rev: curRev + 1 });
    }

    return A.send(res, 405, { error: 'Method not allowed.' });
  } catch (e) {
    return A.send(res, e.status || 500, { error: e.message || 'Server error.' });
  }
};
