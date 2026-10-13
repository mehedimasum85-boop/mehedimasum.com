'use strict';
const A = require('./_lib/auth');

module.exports = async (req, res) => {
  try {
    if (req.method === 'GET') {
      const s = await A.session(req);
      return A.send(res, 200, s ? { loggedIn: true, username: s.username, mustChange: s.mustChange } : { loggedIn: false });
    }
    if (req.method !== 'POST') return A.send(res, 405, { error: 'Method not allowed.' });
    if (!A.sameOrigin(req) || req.headers['x-requested-with'] !== 'admin') return A.send(res, 403, { error: 'Request blocked.' });
    const b = await A.readJSON(req, 20 * 1024);

    if (b.action === 'login') {
      const ip = A.ipOf(req);
      if (A.limited(ip)) return A.send(res, 429, { error: 'Too many attempts. Please wait 10 minutes and try again.' });
      const acc = await A.verifyLogin(b.username || '', b.password || '');
      if (!acc) {
        A.noteFail(ip);
        await new Promise((r) => setTimeout(r, 700));
        return A.send(res, 401, { error: 'Wrong ID or password.' });
      }
      A.clearFail(ip);
      const token = A.sign({ u: acc.username, v: acc.pwv || 'default', exp: Math.floor(Date.now() / 1000) + A.MAX_AGE });
      return A.send(res, 200, { loggedIn: true, username: acc.username, mustChange: !!acc.mustChange },
        { 'Set-Cookie': A.cookieHeader(req, token, A.MAX_AGE) });
    }

    if (b.action === 'logout') {
      return A.send(res, 200, { loggedIn: false }, { 'Set-Cookie': A.cookieHeader(req, '', 0) });
    }

    if (b.action === 'change') {
      const s = await A.session(req);
      if (!s) return A.send(res, 401, { error: 'Please log in again.' });
      const ok = await A.verifyLogin(s.username, b.currentPassword || '');
      if (!ok) return A.send(res, 400, { error: 'Current password is wrong.' });
      const username = String(b.username || s.username).trim();
      const pw = String(b.newPassword || '');
      if (username.length < 3 || username.length > 40) return A.send(res, 400, { error: 'ID must be 3 to 40 characters.' });
      if (pw.length < 10) return A.send(res, 400, { error: 'New password must be at least 10 characters.' });
      if (pw === 'Masum@Demo2026') return A.send(res, 400, { error: 'Please choose a password different from the demo one.' });
      const rec = await A.saveAccount(username, pw);
      const token = A.sign({ u: rec.username, v: rec.pwv, exp: Math.floor(Date.now() / 1000) + A.MAX_AGE });
      return A.send(res, 200, { loggedIn: true, username: rec.username, mustChange: false },
        { 'Set-Cookie': A.cookieHeader(req, token, A.MAX_AGE) });
    }

    return A.send(res, 400, { error: 'Unknown action.' });
  } catch (e) {
    return A.send(res, e.status || 500, { error: e.message || 'Server error.' });
  }
};
