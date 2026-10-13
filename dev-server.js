// Local test server (no packages needed):   node dev-server.js
// Serves the site on http://localhost:3000 and runs the same /api code that Vercel runs.
// Admin changes made here are stored in the .data folder, so they never touch your live site.
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const PORT = process.env.PORT || 3000;
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json', '.svg': 'image/svg+xml',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif', '.avif': 'image/avif', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ico': 'image/x-icon' };

http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://localhost');
  let p = decodeURIComponent(u.pathname);

  const m = /^\/api\/([a-z]+)$/.exec(p);
  if (m && fs.existsSync(path.join(ROOT, 'api', m[1] + '.js'))) {
    try { return await require('./api/' + m[1] + '.js')(req, res); }
    catch (e) { console.error(e); res.statusCode = 500; return res.end('Server error'); }
  }

  let file;
  if (p.startsWith('/uploads/')) file = path.join(ROOT, '.data', p);
  else {
    if (p === '/admin' || p === '/admin/') p = '/admin/index.html';
    if (p === '/') p = '/index.html';
    file = path.join(ROOT, p);
  }
  const base = p.startsWith('/uploads/') ? path.join(ROOT, '.data') : ROOT;
  if (!file.startsWith(base) || /\/(\.data|api|node_modules)\//.test(p) || p.startsWith('/dev-server')) { res.statusCode = 404; return res.end('Not found'); }
  fs.readFile(file, (err, data) => {
    if (err) { res.statusCode = 404; return res.end('Not found'); }
    res.setHeader('Content-Type', TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream');
    res.setHeader('Cache-Control', 'no-store');
    res.end(data);
  });
}).listen(PORT, () => console.log('Site:   http://localhost:' + PORT + '\nAdmin:  http://localhost:' + PORT + '/admin/'));
