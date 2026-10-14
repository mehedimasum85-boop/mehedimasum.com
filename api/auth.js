'use strict';
const A = require('./_lib/auth');

// Only this address can request a password reset (override with the RESET_EMAIL env var).
const RESET_EMAIL = String(process.env.RESET_EMAIL || 'mehedimasum85@gmail.com').trim().toLowerCase();
const RESET_TTL = 30 * 60; // reset link works for 30 minutes
const resetTag = (acc) => 'reset:' + (acc.pwv || 'default'); // link dies as soon as the password changes

async function sendResetMail(link) {
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + process.env.RESEND_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: process.env.MAIL_FROM || 'Portfolio Admin <onboarding@resend.dev>',
      to: [RESET_EMAIL],
      subject: 'Reset your admin password',
      text: 'Someone asked to reset the admin password for your website.\n\nOpen this link within 30 minutes to choose a new password:\n' + link + '\n\nIf this was not you, ignore this email. Nothing will change.',
      html: '<p>Someone asked to reset the admin password for your website.</p><p><a href="' + link + '">Choose a new password</a> (works for 30 minutes).</p><p>If this was not you, ignore this email. Nothing will change.</p>'
    })
  });
  return r.ok;
}

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

    if (b.action === 'forgot') {
      const ip = 'f:' + A.ipOf(req);
      if (A.limited(ip)) return A.send(res, 429, { error: 'Too many attempts. Please wait 10 minutes and try again.' });
      A.noteFail(ip);
      const generic = { ok: true, message: 'If that email is allowed, a reset link has been sent. It works for 30 minutes.' };
      if (String(b.email || '').trim().toLowerCase() !== RESET_EMAIL) return A.send(res, 200, generic);
      if (!process.env.RESEND_API_KEY) return A.send(res, 500, { error: 'Email is not set up yet: RESEND_API_KEY is missing in Vercel.' });
      const acc = await A.getAccount();
      const token = A.sign({ k: 'reset', v: resetTag(acc), exp: Math.floor(Date.now() / 1000) + RESET_TTL });
      const base = String(process.env.SITE_URL || ('https://' + req.headers.host)).replace(/\/+$/, '');
      const sent = await sendResetMail(base + '/admin/?reset=' + encodeURIComponent(token));
      if (!sent) return A.send(res, 502, { error: 'Could not send the email. Check RESEND_API_KEY, and that your Resend account was created with this same email.' });
      return A.send(res, 200, generic);
    }

    if (b.action === 'reset') {
      const ip = 'r:' + A.ipOf(req);
      if (A.limited(ip)) return A.send(res, 429, { error: 'Too many attempts. Please wait 10 minutes and try again.' });
      const acc = await A.getAccount();
      const p = A.verify(String(b.token || ''));
      if (!p || p.k !== 'reset' || p.v !== resetTag(acc)) {
        A.noteFail(ip);
        return A.send(res, 400, { error: 'This reset link is invalid or has expired. Please request a new one.' });
      }
      const username = String(b.username || acc.username).trim();
      const pw = String(b.newPassword || '');
      if (username.length < 3 || username.length > 40) return A.send(res, 400, { error: 'ID must be 3 to 40 characters.' });
      if (pw.length < 10) return A.send(res, 400, { error: 'New password must be at least 10 characters.' });
      if (pw === 'Masum@Demo2026') return A.send(res, 400, { error: 'Please choose a password different from the demo one.' });
      const rec = await A.saveAccount(username, pw);
      const token = A.sign({ u: rec.username, v: rec.pwv, exp: Math.floor(Date.now() / 1000) + A.MAX_AGE });
      return A.send(res, 200, { loggedIn: true, username: rec.username, mustChange: false },
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
