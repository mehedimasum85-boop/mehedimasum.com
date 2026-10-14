'use strict';
const A = require('./_lib/auth');

const crypto = require('crypto');
const store = require('./_lib/store');

// Only this address can request a password reset (override with the RESET_EMAIL env var).
const RESET_EMAIL = String(process.env.RESET_EMAIL || 'mehedimasum85@gmail.com').trim().toLowerCase();
const OTP_KEY = 'admin/reset-otp';
const OTP_TTL = 60;        // the 6-digit code works for this many seconds (1 minute)
const OTP_TRIES = 5;       // wrong guesses allowed per code
const RESET_TTL = 10 * 60; // after a correct code you have this many seconds to type the new password
const resetTag = (acc) => 'reset:' + (acc.pwv || 'default'); // everything dies as soon as the password changes
const nowSec = () => Math.floor(Date.now() / 1000);
const otpHash = (code, tag) => crypto.createHmac('sha256', process.env.SESSION_SECRET || process.env.BLOB_READ_WRITE_TOKEN || 'dev').update('otp:' + code + ':' + tag).digest('hex');

async function sendCodeMail(code) {
  const mins = OTP_TTL / 60;
  const when = mins >= 1 && OTP_TTL % 60 === 0 ? mins + (mins === 1 ? ' minute' : ' minutes') : OTP_TTL + ' seconds';
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + process.env.RESEND_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: process.env.MAIL_FROM || 'Portfolio Admin <onboarding@resend.dev>',
      to: [RESET_EMAIL],
      subject: 'Your admin password reset code: ' + code,
      text: 'Your password reset code is ' + code + '\n\nIt works for ' + when + '. If this was not you, ignore this email. Nothing will change.',
      html: '<p>Your password reset code is</p><p style="font-size:28px;letter-spacing:6px"><b>' + code + '</b></p><p>It works for ' + when + '. If this was not you, ignore this email. Nothing will change.</p>'
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
      if (String(b.email || '').trim().toLowerCase() !== RESET_EMAIL) return A.send(res, 404, { error: 'This email was not found.' });
      if (!process.env.RESEND_API_KEY) return A.send(res, 500, { error: 'Email is not set up yet: RESEND_API_KEY is missing in Vercel.' });
      const acc = await A.getAccount();
      const tag = resetTag(acc);
      const old = await store.getJSON(OTP_KEY);
      if (old && old.tag === tag && old.exp > nowSec()) {
        return A.send(res, 429, { error: 'A code was just sent. Please wait ' + (old.exp - nowSec()) + ' seconds, then ask for a new one.' });
      }
      const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
      await store.putJSON(OTP_KEY, { hash: otpHash(code, tag), tag: tag, exp: nowSec() + OTP_TTL, tries: 0 }, { secret: true });
      const sent = await sendCodeMail(code);
      if (!sent) {
        await store.putJSON(OTP_KEY, { exp: 0 }, { secret: true });
        return A.send(res, 502, { error: 'Could not send the email. Check RESEND_API_KEY, and that your Resend account was created with this same email.' });
      }
      return A.send(res, 200, { ok: true, seconds: OTP_TTL, message: 'Email found. A 6-digit code was sent to it.' });
    }

    if (b.action === 'verify-otp') {
      const ip = 'v:' + A.ipOf(req);
      if (A.limited(ip)) return A.send(res, 429, { error: 'Too many attempts. Please wait 10 minutes and try again.' });
      const acc = await A.getAccount();
      const tag = resetTag(acc);
      const rec = await store.getJSON(OTP_KEY);
      const code = String(b.code || '').replace(/\s/g, '');
      if (!rec || rec.tag !== tag || !(rec.exp > nowSec()) || typeof rec.hash !== 'string' || rec.hash.length !== 64) {
        return A.send(res, 400, { error: 'This code has expired. Please ask for a new one.' });
      }
      if (rec.tries >= OTP_TRIES) return A.send(res, 400, { error: 'Too many wrong tries. Please ask for a new code.' });
      const ok = /^\d{6}$/.test(code) && crypto.timingSafeEqual(Buffer.from(otpHash(code, tag), 'hex'), Buffer.from(rec.hash, 'hex'));
      if (!ok) {
        rec.tries = (rec.tries || 0) + 1;
        await store.putJSON(OTP_KEY, rec, { secret: true });
        A.noteFail(ip);
        const left = OTP_TRIES - rec.tries;
        return A.send(res, 400, { error: left > 0 ? 'Wrong code. ' + left + (left === 1 ? ' try left.' : ' tries left.') : 'Too many wrong tries. Please ask for a new code.' });
      }
      await store.putJSON(OTP_KEY, { exp: 0 }, { secret: true }); // a code works only once
      const token = A.sign({ k: 'reset', v: tag, exp: nowSec() + RESET_TTL });
      return A.send(res, 200, { ok: true, token: token });
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
