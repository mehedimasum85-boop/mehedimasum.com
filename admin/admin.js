// Admin panel. Plain JavaScript, no libraries.
(function () {
  'use strict';

  // ---------- tiny helpers ----------
  function h(tag, a) {
    var e = document.createElement(tag);
    a = a || {};
    Object.keys(a).forEach(function (k) {
      var v = a[k];
      if (v == null || v === false) return;
      if (k === 'class') e.className = v;
      else if (k.slice(0, 2) === 'on') e.addEventListener(k.slice(2), v);
      else if (k === 'html') e.innerHTML = v;
      else if (k === 'style') e.setAttribute('style', v);
      else if (v === true) e.setAttribute(k, '');
      else if (k in e && k !== 'list') { try { e[k] = v; } catch (_) { e.setAttribute(k, v); } }
      else e.setAttribute(k, v);
    });
    for (var i = 2; i < arguments.length; i++) add(e, arguments[i]);
    return e;
  }
  function add(e, c) {
    if (c == null || c === false) return;
    if (Array.isArray(c)) { c.forEach(function (x) { add(e, x); }); return; }
    e.appendChild(c.nodeType ? c : document.createTextNode(String(c)));
  }
  function $(s, r) { return (r || document).querySelector(s); }
  function uid() { return Math.random().toString(36).slice(2, 10); }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function ru(u) { u = String(u || ''); return /^(https?:|\/|data:)/i.test(u) ? u : '/' + u; } // admin lives in /admin/, assets are relative to the site root
  function slugify(s) { return String(s).toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'item'; }
  function move(arr, i, d) { var j = i + d; if (j < 0 || j >= arr.length) return false; var t = arr[i]; arr[i] = arr[j]; arr[j] = t; return true; }

  function toast(msg, kind) {
    var t = h('div', { class: 'toast ' + (kind || '') }, msg);
    $('#toasts').appendChild(t);
    setTimeout(function () { t.remove(); }, kind === 'err' ? 6000 : 2600);
  }

  // ---------- state + api ----------
  var S = { me: null, content: null, rev: 0, dirty: false, view: { name: 'page', slug: 'home' }, pfCat: 'all' };
  var BUILTIN = { home: 'index.html', portfolio: 'portfolio.html', about: 'about.html', contact: 'contact.html' };
  var openSecs = new WeakSet(), openItems = new WeakSet();

  function api(method, url, body, headers) {
    var opt = { method: method, credentials: 'same-origin', headers: Object.assign({ 'X-Requested-With': 'admin' }, headers || {}) };
    if (body !== undefined) {
      if (body instanceof Blob) opt.body = body;
      else { opt.body = JSON.stringify(body); opt.headers['Content-Type'] = 'application/json'; }
    }
    return fetch(url, opt).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (!r.ok) {
          var e = new Error(j.error || 'Something went wrong (' + r.status + ').');
          e.status = r.status; e.code = j.code; throw e;
        }
        return j;
      });
    });
  }
  function fail(e) {
    if (e.status === 401) { S.me = null; renderLogin('Your session ended. Please log in again.'); return; }
    toast(e.message, 'err');
  }

  function touch() {
    if (!S.dirty) { S.dirty = true; updateTop(); }
  }
  function updateTop() {
    var st = $('#state'), sv = $('#saveBtn');
    if (!st) return;
    st.textContent = S.dirty ? 'Unsaved changes' : 'All changes saved';
    st.className = 'state ' + (S.dirty ? 'is-dirty' : 'is-ok');
    if (sv) sv.disabled = !S.dirty;
  }
  window.addEventListener('beforeunload', function (e) { if (S.dirty) { e.preventDefault(); e.returnValue = ''; } });
  document.addEventListener('keydown', function (e) {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's' && S.me) { e.preventDefault(); save(); }
  });

  function normalize(c) {
    c.site = c.site || {}; c.pages = c.pages || {}; c.portfolio = c.portfolio || {};
    c.portfolio.categories = c.portfolio.categories || []; c.portfolio.projects = c.portfolio.projects || [];
    c.site.nav = c.site.nav || []; c.site.footerContacts = c.site.footerContacts || []; c.site.socials = c.site.socials || [];
    c.site.navCta = c.site.navCta || { label: '', href: '' };
    Object.keys(BUILTIN).forEach(function (k) { if (!c.pages[k]) c.pages[k] = { title: '', description: '', sections: [] }; });
    Object.keys(c.pages).forEach(function (k) {
      var p = c.pages[k]; p.sections = p.sections || [];
      p.sections.forEach(function (s) { if (!s.id) s.id = uid(); });
    });
    c.portfolio.projects.forEach(function (p) {
      if (!p.id) p.id = 'p-' + uid();
      if (!Array.isArray(p.slides)) p.slides = (p.images || []).map(function (u) { return [u]; });
    });
    return c;
  }

  function loadContent() {
    return api('GET', '/api/content?fresh=1').then(function (j) {
      S.content = normalize(j.content ? j.content : clone(window.SITE_DEFAULT));
      S.rev = j.rev || 0;
      S.dirty = false;
    });
  }

  function save() {
    if (!S.dirty) return Promise.resolve();
    var btn = $('#saveBtn');
    if (btn) { btn.disabled = true; btn.textContent = 'Saving...'; }
    return api('PUT', '/api/content', { rev: S.rev, content: S.content }).then(function (j) {
      S.rev = j.rev; S.dirty = false; updateTop(); toast('Saved. Your live site is updated.', 'ok');
    }).catch(function (e) {
      if (e.code === 'must_change') { go({ name: 'account' }); }
      fail(e);
    }).then(function () { if (btn) { btn.textContent = 'Save changes'; btn.disabled = !S.dirty; } });
  }

  // ---------- field types (forms are generated from these lists) ----------
  var BTN = [
    { k: 'label', t: 'text', l: 'Button text' },
    { k: 'href', t: 'text', l: 'Link', h: 'For example contact.html, #contact-form or https://...' },
    { k: 'style', t: 'select', l: 'Look', o: [['primary', 'Solid (blue)'], ['ghost', 'Outline']] }
  ];
  var LINK = [{ k: 'label', t: 'text', l: 'Text' }, { k: 'href', t: 'text', l: 'Link' }];
  var ANCHOR = { k: 'anchor', t: 'text', l: 'Link ID (optional)', h: 'Lets you link to this section, for example type "pricing" and link to #pricing.' };

  var SECTIONS = {
    hero: {
      label: 'Hero banner', desc: 'Big headline, intro, buttons and an optional photo.', title: 'title',
      make: function () { return { layout: 'page', eyebrow: '', title: 'New headline', intro: '', buttons: [], image: '', imageAlt: '', captionName: '', captionRole: '', chips: [] }; },
      fields: [
        { k: 'layout', t: 'select', l: 'Style', o: [['home', 'Home style (photo on the right)'], ['page', 'Page banner (photo on the left, with floating tags)']] },
        { k: 'eyebrow', t: 'text', l: 'Small label above the headline' },
        { k: 'title', t: 'text', l: 'Headline' },
        { k: 'intro', t: 'area', l: 'Intro text' },
        { k: 'buttons', t: 'list', l: 'Buttons', n: 'Button', title: 'label', f: BTN },
        { k: 'image', t: 'image', l: 'Photo (optional)' },
        { k: 'imageAlt', t: 'text', l: 'Photo description (for screen readers)' },
        { k: 'captionName', t: 'text', l: 'Name under the photo' },
        { k: 'captionRole', t: 'text', l: 'Role under the photo' },
        { k: 'chips', t: 'lines', l: 'Floating tags next to the photo (page style, max 3, one per line)' },
        ANCHOR
      ]
    },
    story: {
      label: 'Text block', desc: 'A heading with paragraphs and optional milestones.', title: 'title',
      make: function () { return { eyebrow: '', title: 'Section title', lead: '', body: 'Write your text here.', milestones: [] }; },
      fields: [
        { k: 'eyebrow', t: 'text', l: 'Small label' }, { k: 'title', t: 'text', l: 'Title' },
        { k: 'lead', t: 'area', l: 'Highlighted first paragraph' },
        { k: 'body', t: 'area', l: 'Text', h: 'Leave a blank line between paragraphs.', rows: 8 },
        { k: 'milestones', t: 'list', l: 'Milestones (small timeline, optional)', n: 'Milestone', title: 'label', f: [{ k: 'label', t: 'text', l: 'Date / label' }, { k: 'text', t: 'text', l: 'Text' }] },
        ANCHOR
      ]
    },
    timeline: {
      label: 'Timeline / experience', desc: 'A list of jobs, steps or events with dates.', title: 'title',
      make: function () { return { eyebrow: '', title: 'Experience', intro: '', linkLabel: '', linkHref: '', items: [{ period: '2024', title: 'Title', role: '', summary: '', tags: [] }] }; },
      fields: [
        { k: 'eyebrow', t: 'text', l: 'Small label' }, { k: 'title', t: 'text', l: 'Title' }, { k: 'intro', t: 'text', l: 'Short intro' },
        { k: 'linkLabel', t: 'text', l: 'Link text (optional)' }, { k: 'linkHref', t: 'text', l: 'Link' },
        { k: 'items', t: 'list', l: 'Entries', n: 'Entry', title: 'title', f: [
          { k: 'period', t: 'text', l: 'Date / period' }, { k: 'title', t: 'text', l: 'Title (company or event)' }, { k: 'role', t: 'text', l: 'Role' },
          { k: 'summary', t: 'area', l: 'Summary', rows: 3 }, { k: 'tags', t: 'lines', l: 'Tags (one per line)' }] },
        ANCHOR
      ]
    },
    workgrid: {
      label: 'Image cards', desc: 'A grid of image cards that link somewhere.', title: 'title',
      make: function () { return { eyebrow: '', title: 'Selected Work', intro: '', actionLabel: '', actionHref: '', cards: [] }; },
      fields: [
        { k: 'eyebrow', t: 'text', l: 'Small label' }, { k: 'title', t: 'text', l: 'Title' }, { k: 'intro', t: 'text', l: 'Short intro' },
        { k: 'cards', t: 'list', l: 'Cards', n: 'Card', title: 'title', f: [
          { k: 'title', t: 'text', l: 'Title' }, { k: 'text', t: 'text', l: 'Short text' }, { k: 'href', t: 'text', l: 'Link' },
          { k: 'image', t: 'image', l: 'Image' }, { k: 'alt', t: 'text', l: 'Image description' },
          { k: 'size', t: 'select', l: 'Size', o: [['wide', 'Wide'], ['narrow', 'Narrow'], ['third', 'One third']] },
          { k: 'badge', t: 'check', l: 'Show "Placeholder" badge' }] },
        { k: 'actionLabel', t: 'text', l: 'Button under the grid (text)' }, { k: 'actionHref', t: 'text', l: 'Button link' },
        ANCHOR
      ]
    },
    cards: {
      label: 'Info cards', desc: 'Services, skills or any group of cards with bullet lists or tags.', title: 'title',
      make: function () { return { eyebrow: '', title: 'Services', intro: '', cards: [{ style: 'primary', title: 'Card title', text: '', bullets: [], tags: [] }] }; },
      fields: [
        { k: 'eyebrow', t: 'text', l: 'Small label' }, { k: 'title', t: 'text', l: 'Title' }, { k: 'intro', t: 'text', l: 'Short intro' },
        { k: 'cards', t: 'list', l: 'Cards', n: 'Card', title: 'title', f: [
          { k: 'style', t: 'select', l: 'Look', o: [['primary', 'Big card'], ['secondary', 'Small card']] },
          { k: 'title', t: 'text', l: 'Title' }, { k: 'text', t: 'area', l: 'Text', rows: 3 },
          { k: 'bullets', t: 'list', l: 'Bullet points', n: 'Point', title: 'title', f: [{ k: 'title', t: 'text', l: 'Bold text' }, { k: 'text', t: 'text', l: 'Small text (optional)' }] },
          { k: 'tags', t: 'lines', l: 'Tags (one per line)' }] },
        ANCHOR
      ]
    },
    steps: {
      label: 'Numbered steps', desc: 'A numbered list such as a process or approach.', title: 'title',
      make: function () { return { eyebrow: '', title: 'How I work', intro: '', items: [{ title: 'Step one', text: '' }] }; },
      fields: [
        { k: 'eyebrow', t: 'text', l: 'Small label' }, { k: 'title', t: 'text', l: 'Title' }, { k: 'intro', t: 'text', l: 'Short intro' },
        { k: 'items', t: 'list', l: 'Steps', n: 'Step', title: 'title', f: [{ k: 'title', t: 'text', l: 'Title' }, { k: 'text', t: 'area', l: 'Text', rows: 3 }] },
        ANCHOR
      ]
    },
    cta: {
      label: 'Call to action', desc: 'A highlighted block with a button.', title: 'title',
      make: function () { return { title: 'Ready to start?', text: '', buttonLabel: "Let's Work Together", buttonHref: 'contact.html' }; },
      fields: [{ k: 'title', t: 'text', l: 'Title' }, { k: 'text', t: 'text', l: 'Text' }, { k: 'buttonLabel', t: 'text', l: 'Button text' }, { k: 'buttonHref', t: 'text', l: 'Button link' }, ANCHOR]
    },
    gallery: {
      label: 'Portfolio gallery', desc: 'The category filter and project cards. Projects are edited in "Portfolio".', title: null,
      make: function () { return {}; }, fields: [ANCHOR], note: 'Add or edit categories and projects in the Portfolio manager. Use only one gallery per page.'
    },
    contactform: {
      label: 'Contact form', desc: 'Contact form with a side panel. Use only one per page.', title: null,
      make: function () { return { endpoint: '', submitLabel: 'Send Message', projectTypes: ['Other'], aside: [] }; },
      fields: [
        { k: 'endpoint', t: 'text', l: 'Form service URL', h: 'Paste your Formspree / Web3Forms URL here so messages reach your email. Empty = the form says it is not connected.' },
        { k: 'submitLabel', t: 'text', l: 'Send button text' },
        { k: 'projectTypes', t: 'lines', l: 'Project type choices (one per line)' },
        { k: 'aside', t: 'list', l: 'Side cards', n: 'Card', title: 'title', f: [
          { k: 'kind', t: 'select', l: 'Type', o: [['list', 'Bullet list'], ['linkedin', 'LinkedIn icon link']] },
          { k: 'title', t: 'text', l: 'Title' }, { k: 'href', t: 'text', l: 'LinkedIn URL (for the icon type)' }, { k: 'items', t: 'lines', l: 'List items (one per line)' }] },
        ANCHOR
      ]
    },
    html: {
      label: 'Custom HTML', desc: 'Advanced: paste your own HTML (embeds, special layouts).', title: null,
      make: function () { return { code: '<section class="section"><div class="container"><h2>Hello</h2></div></section>' }; },
      fields: [{ k: 'code', t: 'code', l: 'HTML code' }]
    }
  };

  function blank(fields) {
    var o = {};
    fields.forEach(function (f) {
      o[f.k] = f.t === 'list' || f.t === 'lines' ? [] : f.t === 'check' ? false : f.t === 'select' ? f.o[0][0] : f.t === 'group' ? blank(f.f) : '';
    });
    return o;
  }

  // ---------- form builder ----------
  function fieldsUI(fields, obj) {
    var box = h('div', { class: 'card__body', style: 'padding:0' });
    fields.forEach(function (f) {
      var cur = obj[f.k];
      var hint = f.h ? h('span', { class: 'hint' }, f.h) : null;
      if (f.t === 'text' || f.t === 'area' || f.t === 'code') {
        var inp = f.t === 'text' ? h('input', { class: 'in', type: 'text', value: cur == null ? '' : cur })
          : h('textarea', { class: 'in' + (f.t === 'code' ? ' code' : ''), rows: f.rows || 4 });
        if (f.t !== 'text') inp.value = cur == null ? '' : cur;
        inp.addEventListener('input', function () { obj[f.k] = inp.value; touch(); });
        box.appendChild(h('label', { class: 'f' }, f.l, inp, hint));
      } else if (f.t === 'lines') {
        var ta = h('textarea', { class: 'in', rows: 3 });
        ta.value = (cur || []).join('\n');
        ta.addEventListener('input', function () { obj[f.k] = ta.value.split('\n').map(function (x) { return x.trim(); }).filter(Boolean); touch(); });
        box.appendChild(h('label', { class: 'f' }, f.l, ta, hint));
      } else if (f.t === 'select') {
        var sel = h('select', { class: 'in' }, f.o.map(function (o) { return h('option', { value: o[0] }, o[1]); }));
        sel.value = cur == null ? f.o[0][0] : cur;
        obj[f.k] = sel.value;
        sel.addEventListener('change', function () { obj[f.k] = sel.value; touch(); });
        box.appendChild(h('label', { class: 'f' }, f.l, sel));
      } else if (f.t === 'check') {
        var cb = h('input', { type: 'checkbox', checked: !!cur });
        cb.addEventListener('change', function () { obj[f.k] = cb.checked; touch(); });
        box.appendChild(h('label', { class: 'check' }, cb, f.l));
      } else if (f.t === 'image') {
        box.appendChild(imageField(f.l, obj, f.k, f.h));
      } else if (f.t === 'group') {
        if (!obj[f.k] || typeof obj[f.k] !== 'object') obj[f.k] = blank(f.f);
        box.appendChild(h('div', { class: 'group' }, h('div', { class: 'lbl' }, f.l), fieldsUI(f.f, obj[f.k])));
      } else if (f.t === 'list') {
        if (!Array.isArray(obj[f.k])) obj[f.k] = [];
        box.appendChild(listField(f, obj[f.k]));
      }
    });
    return box;
  }

  function listField(f, arr) {
    var wrap = h('div', { class: 'list' });
    function render() {
      wrap.innerHTML = '';
      wrap.appendChild(h('div', { class: 'lbl' }, f.l));
      arr.forEach(function (it, i) {
        var body = h('div', { class: 'item__body', hidden: !openItems.has(it) });
        body.appendChild(fieldsUI(f.f, it));
        var title = h('span', { class: 'item__title' }, (it[f.title] || '') || f.n + ' ' + (i + 1));
        var head = h('div', { class: 'item__head', onclick: function () {
          if (openItems.has(it)) openItems.delete(it); else openItems.add(it);
          body.hidden = !openItems.has(it); title.textContent = (it[f.title] || '') || f.n + ' ' + (i + 1);
        } }, title,
          h('button', { class: 'icon', type: 'button', title: 'Move up', disabled: i === 0, onclick: function (e) { e.stopPropagation(); move(arr, i, -1); touch(); render(); } }, '\u2191'),
          h('button', { class: 'icon', type: 'button', title: 'Move down', disabled: i === arr.length - 1, onclick: function (e) { e.stopPropagation(); move(arr, i, 1); touch(); render(); } }, '\u2193'),
          h('button', { class: 'icon icon--danger', type: 'button', title: 'Delete', onclick: function (e) { e.stopPropagation(); if (confirm('Delete this ' + f.n.toLowerCase() + '?')) { arr.splice(i, 1); touch(); render(); } } }, '\u2715'));
        wrap.appendChild(h('div', { class: 'item' }, head, body));
      });
      wrap.appendChild(h('div', {}, h('button', { class: 'btn btn--sm', type: 'button', onclick: function () {
        var n = blank(f.f); arr.push(n); openItems.add(n); touch(); render();
      } }, '+ Add ' + f.n.toLowerCase())));
    }
    render();
    return wrap;
  }

  // ---------- images: upload, library ----------
  function prepareImage(file) {
    var raster = /^image\/(jpeg|png|webp)$/.test(file.type);
    var LIMIT = 4.1 * 1024 * 1024;
    if (!raster) {
      if (file.size > LIMIT) return Promise.reject(new Error(file.name + ' is too big. Please use a JPG, PNG or WebP.'));
      return Promise.resolve(file);
    }
    return (window.createImageBitmap ? createImageBitmap(file) : Promise.reject()).then(function (bmp) {
      var max = 2600, scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
      if (scale === 1 && file.size <= 1.6 * 1024 * 1024) return file;
      var w = Math.round(bmp.width * scale), hgt = Math.round(bmp.height * scale);
      var c = document.createElement('canvas'); c.width = w; c.height = hgt;
      c.getContext('2d').drawImage(bmp, 0, 0, w, hgt);
      function enc(q) {
        return new Promise(function (res) { c.toBlob(function (b) { res(b); }, 'image/webp', q); }).then(function (b) {
          if (!b || b.type !== 'image/webp') return new Promise(function (res) { c.toBlob(res, 'image/jpeg', q); });
          return b;
        });
      }
      function attempt(q) { return enc(q).then(function (b) { return b.size > LIMIT && q > 0.5 ? attempt(q - 0.12) : b; }); }
      return attempt(0.88).then(function (b) {
        if (b.size > LIMIT) throw new Error(file.name + ' is still too big after optimizing.');
        return b;
      });
    }).catch(function (e) {
      if (e && e.message) throw e;
      if (file.size > LIMIT) throw new Error(file.name + ' is too big for this browser to optimize. Please use a smaller file.');
      return file;
    });
  }
  function uploadFile(file) {
    return prepareImage(file).then(function (blob) {
      return api('POST', '/api/upload?name=' + encodeURIComponent(file.name), blob, { 'Content-Type': blob.type || 'application/octet-stream' });
    }).then(function (j) { return j.url; });
  }
  function pickFiles(multiple) {
    return new Promise(function (res) {
      var i = h('input', { type: 'file', accept: 'image/jpeg,image/png,image/webp,image/gif,image/avif', multiple: !!multiple });
      i.addEventListener('change', function () { res(Array.prototype.slice.call(i.files)); });
      i.click();
    });
  }
  function library(onPick) {
    var grid = h('div', { class: 'lib' }, h('p', { class: 'hint' }, 'Loading...'));
    var m = modal('Image library', h('div', { class: 'modal__body' }, h('p', { class: 'hint' }, 'Images you uploaded before. Click one to use it.'), grid));
    api('GET', '/api/upload').then(function (j) {
      grid.innerHTML = '';
      if (!j.items.length) grid.appendChild(h('p', { class: 'hint' }, 'No uploads yet.'));
      j.items.forEach(function (it) {
        grid.appendChild(h('button', { type: 'button', title: it.name, onclick: function () { m.close(); onPick(it.url); } }, h('img', { src: ru(it.url), alt: it.name, loading: 'lazy' })));
      });
    }).catch(fail);
  }

  function imageField(label, obj, key, hint) {
    var wrap = h('div', { class: 'f' });
    function render() {
      wrap.innerHTML = '';
      var url = obj[key] || '';
      var th = h('div', { class: 'thumb' }, url ? h('img', { src: ru(url), alt: '' }) : 'No image');
      var inp = h('input', { class: 'in', type: 'text', placeholder: 'Image URL or path', value: url });
      inp.addEventListener('change', function () { obj[key] = inp.value.trim(); touch(); render(); });
      var st = h('span', { class: 'prog' });
      var up = h('button', { class: 'btn btn--sm', type: 'button', onclick: function () {
        pickFiles(false).then(function (fs) {
          if (!fs[0]) return;
          st.textContent = 'Uploading...'; up.disabled = true;
          return uploadFile(fs[0]).then(function (u) { obj[key] = u; touch(); render(); }).catch(function (e) { st.textContent = ''; up.disabled = false; fail(e); });
        });
      } }, 'Upload');
      wrap.appendChild(h('div', { class: 'lbl' }, label));
      wrap.appendChild(h('div', { class: 'img' }, th, h('div', { class: 'img__col' }, inp,
        h('div', { class: 'row' }, up,
          h('button', { class: 'btn btn--sm', type: 'button', onclick: function () { library(function (u) { obj[key] = u; touch(); render(); }); } }, 'Library'),
          url ? h('button', { class: 'btn btn--sm btn--danger', type: 'button', onclick: function () { obj[key] = ''; touch(); render(); } }, 'Remove') : null, st),
        hint ? h('span', { class: 'hint' }, hint) : null)));
    }
    render();
    return wrap;
  }

  // ---------- modal ----------
  function modal(title, body, onClose) {
    var back = h('div', { class: 'modal' });
    function close() { back.remove(); document.body.style.overflow = ''; if (onClose) onClose(); }
    back.appendChild(h('div', { class: 'modal__box', role: 'dialog', 'aria-label': title },
      h('div', { class: 'modal__head' }, h('h2', {}, title), h('button', { class: 'btn btn--sm', type: 'button', onclick: close }, 'Close')), body));
    back.addEventListener('mousedown', function (e) { if (e.target === back) close(); });
    document.body.appendChild(back); document.body.style.overflow = 'hidden';
    return { close: close, el: back };
  }

  // ---------- login ----------
  function renderLogin(msg) {
    var app = $('#app'); app.innerHTML = '';
    var u = h('input', { class: 'in', type: 'text', autocomplete: 'username', required: true, value: '' });
    var p = h('input', { class: 'in', type: 'password', autocomplete: 'current-password', required: true });
    var err = h('p', { class: 'err' }, msg || '');
    var btn = h('button', { class: 'btn btn--primary', type: 'submit' }, 'Log in');
    var form = h('form', { class: 'login__card' },
      h('h1', {}, 'Admin login'), h('p', {}, 'Manage everything on your website from here.'),
      h('label', { class: 'f' }, 'ID', u), h('label', { class: 'f' }, 'Password', p), err, btn,
      h('button', { class: 'linkbtn', type: 'button', onclick: function () { renderForgot(); } }, 'Forgot password?'));
    form.addEventListener('submit', function (e) {
      e.preventDefault(); btn.disabled = true; err.textContent = '';
      api('POST', '/api/auth', { action: 'login', username: u.value.trim(), password: p.value }).then(function (j) {
        S.me = j; return loadContent();
      }).then(function () {
        S.view = S.me.mustChange ? { name: 'account' } : { name: 'page', slug: 'home' }; renderShell();
      }).catch(function (e2) { err.textContent = e2.message; btn.disabled = false; });
    });
    app.appendChild(h('div', { class: 'login' }, form));
    u.focus();
  }

  // ---------- forgot / reset password ----------
  function renderForgot() {
    var app = $('#app'); app.innerHTML = '';
    var em = h('input', { class: 'in', type: 'email', autocomplete: 'email', required: true, placeholder: 'Your email' });
    var err = h('p', { class: 'err' }, '');
    var ok = h('p', { class: 'okmsg' }, '');
    var btn = h('button', { class: 'btn btn--primary', type: 'submit' }, 'Send reset link');
    var form = h('form', { class: 'login__card' },
      h('h1', {}, 'Forgot password'), h('p', {}, 'Enter your email. If it is the allowed one, we send you a link to set a new password.'),
      h('label', { class: 'f' }, 'Email', em), err, ok, btn,
      h('button', { class: 'linkbtn', type: 'button', onclick: function () { renderLogin(); } }, 'Back to login'));
    form.addEventListener('submit', function (e) {
      e.preventDefault(); btn.disabled = true; err.textContent = ''; ok.textContent = '';
      api('POST', '/api/auth', { action: 'forgot', email: em.value.trim() }).then(function (j) {
        ok.textContent = j.message || 'If that email is allowed, a reset link has been sent.'; btn.disabled = false;
      }).catch(function (e2) { err.textContent = e2.message; btn.disabled = false; });
    });
    app.appendChild(h('div', { class: 'login' }, form));
    em.focus();
  }

  function renderReset(token) {
    var app = $('#app'); app.innerHTML = '';
    var u = h('input', { class: 'in', type: 'text', autocomplete: 'username', placeholder: 'Leave empty to keep the current ID' });
    var np = h('input', { class: 'in', type: 'password', autocomplete: 'new-password', required: true });
    var np2 = h('input', { class: 'in', type: 'password', autocomplete: 'new-password', required: true });
    var err = h('p', { class: 'err' }, '');
    var btn = h('button', { class: 'btn btn--primary', type: 'submit' }, 'Save new password');
    var form = h('form', { class: 'login__card' },
      h('h1', {}, 'Set a new password'), h('p', {}, 'Choose a new password (at least 10 characters).'),
      h('label', { class: 'f' }, 'ID (optional)', u),
      h('label', { class: 'f' }, 'New password', np), h('label', { class: 'f' }, 'Repeat new password', np2), err, btn);
    form.addEventListener('submit', function (e) {
      e.preventDefault(); err.textContent = '';
      if (np.value !== np2.value) { err.textContent = 'The two passwords do not match.'; return; }
      btn.disabled = true;
      api('POST', '/api/auth', { action: 'reset', token: token, username: u.value.trim(), newPassword: np.value }).then(function (j) {
        S.me = j; history.replaceState(null, '', location.pathname); return loadContent();
      }).then(function () {
        S.view = { name: 'page', slug: 'home' }; renderShell(); toast('Password updated.', 'ok');
      }).catch(function (e2) { err.textContent = e2.message; btn.disabled = false; });
    });
    app.appendChild(h('div', { class: 'login' }, form));
    np.focus();
  }

  // ---------- shell ----------
  function go(v) { S.view = v; renderShell(); }
  function pageLabel(slug) { var p = S.content.pages[slug]; return slug === 'home' ? 'Home' : slug === 'portfolio' ? 'Portfolio page' : slug === 'about' ? 'About' : slug === 'contact' ? 'Contact' : (p && p.title) || slug; }

  function renderShell() {
    var app = $('#app'); app.innerHTML = '';
    var v = S.view;
    var side = h('aside', { class: 'side', id: 'side' });
    side.appendChild(h('div', { class: 'side__brand' }, 'SITE MANAGER', h('small', {}, 'Signed in as ' + S.me.username)));
    function nav(label, view, small) {
      var on = v.name === view.name && (view.name !== 'page' || v.slug === view.slug);
      return h('button', { class: 'nav-btn' + (on ? ' is-on' : ''), type: 'button', onclick: function () { side.classList.remove('is-open'); go(view); } }, label, small ? h('small', {}, small) : null);
    }
    side.appendChild(h('div', { class: 'side__group' }, 'Pages'));
    Object.keys(S.content.pages).forEach(function (slug) {
      side.appendChild(nav(pageLabel(slug), { name: 'page', slug: slug }, BUILTIN[slug] ? '' : 'custom'));
    });
    side.appendChild(h('button', { class: 'nav-btn', type: 'button', onclick: newPage }, '+ New page'));
    side.appendChild(h('div', { class: 'side__group' }, 'Content'));
    side.appendChild(nav('Portfolio projects', { name: 'portfolio' }));
    side.appendChild(nav('Site settings', { name: 'site' }, 'menu, footer'));
    side.appendChild(h('div', { class: 'side__group' }, 'Tools'));
    side.appendChild(nav('History', { name: 'history' }, 'restore'));
    side.appendChild(nav('Account', { name: 'account' }, 'password'));
    side.appendChild(h('div', { class: 'side__foot' },
      h('a', { class: 'btn btn--sm', href: '/', target: '_blank', rel: 'noopener' }, 'Open live site'),
      h('button', { class: 'btn btn--sm', type: 'button', onclick: logout }, 'Log out')));

    var titles = { page: pageLabel(v.slug || 'home'), portfolio: 'Portfolio projects', site: 'Site settings', history: 'History', account: 'Account' };
    var top = h('header', { class: 'top' },
      h('button', { class: 'icon menu-btn', type: 'button', 'aria-label': 'Menu', onclick: function () { side.classList.toggle('is-open'); } }, '\u2630'),
      h('h1', {}, titles[v.name]), h('span', { id: 'state', class: 'state' }),
      h('button', { class: 'btn', type: 'button', onclick: preview }, 'Preview'),
      h('button', { class: 'btn btn--primary', id: 'saveBtn', type: 'button', onclick: save }, 'Save changes'));
    var view = h('div', { class: 'view', id: 'view' });
    app.appendChild(h('div', { class: 'shell' }, side, h('div', { class: 'main' }, top, view)));
    updateTop();
    if (S.me.mustChange && v.name !== 'account') view.appendChild(h('div', { class: 'banner' }, 'You are still using the demo password. Open the Account page and change it, otherwise you will not be able to save.'));
    ({ page: renderPage, portfolio: renderPortfolio, site: renderSite, history: renderHistory, account: renderAccount })[v.name](view);
    window.scrollTo(0, 0);
  }

  function logout() {
    if (S.dirty && !confirm('You have unsaved changes. Log out anyway?')) return;
    api('POST', '/api/auth', { action: 'logout' }).catch(function () {}).then(function () { S.dirty = false; S.me = null; renderLogin(); });
  }

  function previewUrl() {
    var v = S.view, slug = v.name === 'page' ? v.slug : 'home';
    return BUILTIN[slug] ? '/' + BUILTIN[slug] + '?preview=1' : '/page.html?p=' + encodeURIComponent(slug) + '&preview=1';
  }
  function preview() {
    try { localStorage.setItem('siteDraft', JSON.stringify(S.content)); } catch (e) { toast('Could not prepare the preview.', 'err'); return; }
    window.open(previewUrl(), '_blank');
  }

  function newPage() {
    var title = prompt('Name of the new page (for example "Services"):');
    if (!title || !title.trim()) return;
    var slug = slugify(title), n = 2, base = slug;
    while (S.content.pages[slug]) slug = base + '-' + n++;
    S.content.pages[slug] = { title: title.trim() + ' | ' + S.content.site.name, description: '', sections: [
      { id: uid(), type: 'hero', layout: 'page', eyebrow: '', title: title.trim(), intro: '', buttons: [], image: '', imageAlt: '', captionName: '', captionRole: '', chips: [] },
      Object.assign({ id: uid(), type: 'cta' }, SECTIONS.cta.make())] };
    if (confirm('Add "' + title.trim() + '" to the top menu?')) S.content.site.nav.push({ label: title.trim(), href: 'page.html?p=' + slug });
    touch(); go({ name: 'page', slug: slug });
  }

  // ---------- page editor ----------
  function sectionSummary(s) {
    var d = SECTIONS[s.type];
    var t = d && d.title ? s[d.title] : '';
    return t || (d ? d.label : s.type);
  }

  function renderPage(view) {
    var slug = S.view.slug, page = S.content.pages[slug];
    if (!page) { view.appendChild(h('p', {}, 'Page not found.')); return; }
    view.appendChild(h('div', { class: 'card' }, h('div', { class: 'card__body' },
      h('h2', {}, 'Page settings'),
      fieldsUI([{ k: 'title', t: 'text', l: 'Browser tab title' }, { k: 'description', t: 'area', l: 'Search engine description', rows: 2 }], page),
      BUILTIN[slug] ? null : h('div', { class: 'row' },
        h('span', { class: 'hint grow' }, 'Address: page.html?p=' + slug),
        h('button', { class: 'btn btn--sm btn--danger', type: 'button', onclick: function () {
          if (!confirm('Delete the whole page "' + pageLabel(slug) + '" with all its sections?')) return;
          delete S.content.pages[slug];
          S.content.site.nav = S.content.site.nav.filter(function (n) { return String(n.href).indexOf('p=' + slug) < 0; });
          touch(); go({ name: 'page', slug: 'home' });
        } }, 'Delete this page')))));

    function addBar(at) {
      return h('div', { class: 'add-bar' }, h('button', { type: 'button', onclick: function () { pickType(at); } }, '+ Add section here'));
    }
    view.appendChild(addBar(0));
    page.sections.forEach(function (s, i) {
      view.appendChild(sectionCard(page, s, i));
      view.appendChild(addBar(i + 1));
    });
    if (!page.sections.length) view.appendChild(h('p', { class: 'hint', style: 'text-align:center' }, 'This page has no sections yet. Add one above.'));

    function pickType(at) {
      var m;
      var grid = h('div', { class: 'types' }, Object.keys(SECTIONS).map(function (t) {
        return h('button', { class: 'type', type: 'button', onclick: function () {
          var s = Object.assign({ id: uid(), type: t }, SECTIONS[t].make());
          page.sections.splice(at, 0, s); openSecs.add(s); touch(); m.close(); renderShell();
        } }, h('b', {}, SECTIONS[t].label), h('span', {}, SECTIONS[t].desc));
      }));
      m = modal('Add a section', h('div', { class: 'modal__body' }, grid));
    }
  }

  function sectionCard(page, s, i) {
    var d = SECTIONS[s.type] || { label: s.type, fields: [] };
    var body = h('div', { class: 'sec__body', hidden: !openSecs.has(s) });
    if (d.note) body.appendChild(h('p', { class: 'hint' }, d.note));
    if (s.type === 'gallery') body.appendChild(h('div', {}, h('button', { class: 'btn btn--sm', type: 'button', onclick: function () { go({ name: 'portfolio' }); } }, 'Open Portfolio manager')));
    body.appendChild(fieldsUI(d.fields, s));
    var label = h('span', { class: 'sec__title' }, sectionSummary(s));
    var card = h('div', { class: 'sec' + (s.hidden ? ' is-hidden' : '') });
    var head = h('div', { class: 'sec__head', onclick: function () {
      if (openSecs.has(s)) openSecs.delete(s); else openSecs.add(s);
      body.hidden = !openSecs.has(s); label.textContent = sectionSummary(s);
    } }, h('span', { class: 'sec__type' }, d.label), label, s.hidden ? h('span', { class: 'hint' }, 'hidden') : null,
      h('span', { class: 'sec__tools' },
        h('button', { class: 'icon', type: 'button', title: 'Move up', disabled: i === 0, onclick: function (e) { e.stopPropagation(); move(page.sections, i, -1); touch(); renderShell(); } }, '\u2191'),
        h('button', { class: 'icon', type: 'button', title: 'Move down', disabled: i === page.sections.length - 1, onclick: function (e) { e.stopPropagation(); move(page.sections, i, 1); touch(); renderShell(); } }, '\u2193'),
        h('button', { class: 'icon', type: 'button', title: s.hidden ? 'Show on site' : 'Hide from site', onclick: function (e) { e.stopPropagation(); s.hidden = !s.hidden; touch(); renderShell(); } }, s.hidden ? '\u25CB' : '\u25CF'),
        h('button', { class: 'icon', type: 'button', title: 'Duplicate', onclick: function (e) { e.stopPropagation(); var c = clone(s); c.id = uid(); page.sections.splice(i + 1, 0, c); touch(); renderShell(); } }, '\u29C9'),
        h('button', { class: 'icon icon--danger', type: 'button', title: 'Delete section', onclick: function (e) {
          e.stopPropagation();
          if (confirm('Delete this section completely?\n"' + sectionSummary(s) + '"')) { page.sections.splice(i, 1); touch(); renderShell(); }
        } }, '\u2715')));
    card.appendChild(head); card.appendChild(body);
    return card;
  }

  // ---------- site settings ----------
  function renderSite(view) {
    var site = S.content.site;
    view.appendChild(h('div', { class: 'card' }, h('div', { class: 'card__body' }, h('h2', {}, 'Identity'),
      fieldsUI([{ k: 'name', t: 'text', l: 'Your name' }, { k: 'role', t: 'text', l: 'Your role / title' }, { k: 'logoText', t: 'text', l: 'Logo text in the header' }, { k: 'legal', t: 'text', l: 'Copyright line (after the year)' }], site))));
    view.appendChild(h('div', { class: 'card' }, h('div', { class: 'card__body' }, h('h2', {}, 'Header & menu'),
      fieldsUI([
        { k: 'navCta', t: 'group', l: 'Header button (leave text empty to hide it)', f: [{ k: 'label', t: 'text', l: 'Text' }, { k: 'href', t: 'text', l: 'Link' }] },
        { k: 'nav', t: 'list', l: 'Menu links (also used in the footer)', n: 'Link', title: 'label', f: LINK }], site))));
    view.appendChild(h('div', { class: 'card' }, h('div', { class: 'card__body' }, h('h2', {}, 'Footer'),
      fieldsUI([
        { k: 'footerContacts', t: 'list', l: 'Contact lines', n: 'Contact', title: 'label', f: [{ k: 'label', t: 'text', l: 'Label (e.g. Email)' }, { k: 'text', t: 'text', l: 'Shown text' }, { k: 'href', t: 'text', l: 'Link (e.g. mailto:you@mail.com)' }] },
        { k: 'socials', t: 'list', l: 'Social links', n: 'Social link', title: 'label', f: [{ k: 'label', t: 'text', l: 'Name (e.g. Behance)' }, { k: 'href', t: 'text', l: 'Profile URL' }] }], site))));
  }

  // ---------- portfolio manager ----------
  function renderPortfolio(view) {
    var pf = S.content.portfolio, cats = pf.categories, projects = pf.projects;
    function count(id) { return projects.filter(function (p) { return p.category === id; }).length; }

    // categories
    var catBody = h('div', { class: 'card__body' }, h('h2', {}, 'Categories'),
      h('p', { class: 'hint' }, 'These appear as the filter buttons on the Portfolio page, in this order. A category with no projects is hidden from visitors.'));
    cats.forEach(function (c, i) {
      var inp = h('input', { class: 'in grow', type: 'text', value: c.label });
      inp.addEventListener('input', function () { c.label = inp.value; touch(); });
      catBody.appendChild(h('div', { class: 'catrow' }, inp, h('span', { class: 'hint' }, count(c.id) + ' projects'),
        h('button', { class: 'icon', type: 'button', title: 'Move up', disabled: i === 0, onclick: function () { move(cats, i, -1); touch(); renderShell(); } }, '\u2191'),
        h('button', { class: 'icon', type: 'button', title: 'Move down', disabled: i === cats.length - 1, onclick: function () { move(cats, i, 1); touch(); renderShell(); } }, '\u2193'),
        h('button', { class: 'icon icon--danger', type: 'button', title: 'Delete category', onclick: function () {
          var n = count(c.id);
          if (!confirm('Delete the category "' + c.label + '"' + (n ? ' and its ' + n + ' project(s)' : '') + '?')) return;
          pf.projects = projects.filter(function (p) { return p.category !== c.id; });
          cats.splice(i, 1); if (S.pfCat === c.id) S.pfCat = 'all'; touch(); renderShell();
        } }, '\u2715')));
    });
    var newCat = h('input', { class: 'in grow', type: 'text', placeholder: 'New category name' });
    catBody.appendChild(h('div', { class: 'catrow' }, newCat, h('button', { class: 'btn btn--sm', type: 'button', onclick: function () {
      var l = newCat.value.trim(); if (!l) return;
      var id = slugify(l), n = 2, b = id;
      while (cats.some(function (c) { return c.id === id; })) id = b + '-' + n++;
      cats.push({ id: id, label: l }); S.pfCat = id; touch(); renderShell();
    } }, '+ Add category')));
    view.appendChild(h('div', { class: 'card' }, catBody));

    // projects
    var chips = h('div', { class: 'chips' }, h('button', { class: 'chip' + (S.pfCat === 'all' ? ' is-on' : ''), type: 'button', onclick: function () { S.pfCat = 'all'; renderShell(); } }, 'All', h('small', {}, String(projects.length))));
    cats.forEach(function (c) {
      chips.appendChild(h('button', { class: 'chip' + (S.pfCat === c.id ? ' is-on' : ''), type: 'button', onclick: function () { S.pfCat = c.id; renderShell(); } }, c.label, h('small', {}, String(count(c.id)))));
    });
    var list = projects.filter(function (p) { return S.pfCat === 'all' || p.category === S.pfCat; });
    var body = h('div', { class: 'card__body' }, h('div', { class: 'row' }, h('h2', { class: 'grow' }, 'Projects'),
      h('button', { class: 'btn btn--primary btn--sm', type: 'button', disabled: !cats.length, onclick: function () {
        var p = { id: 'p-' + uid(), title: 'New project', category: S.pfCat !== 'all' ? S.pfCat : cats[0].id, brand: '', cover: '', alt: '', slides: [], placeholder: false };
        projects.push(p); touch(); openProject(p, true);
      } }, '+ Add project')), chips);
    if (!cats.length) body.appendChild(h('p', { class: 'hint' }, 'Add a category first.'));
    list.forEach(function (p) {
      var imgs = [].concat.apply([], p.slides || []);
      var cover = p.cover || imgs[0];
      body.appendChild(h('div', { class: 'proj' }, h('div', { class: 'thumb' }, cover ? h('img', { src: ru(cover), alt: '' }) : 'No cover'),
        h('div', { class: 'grow' }, h('div', { class: 'proj__t' }, p.title || 'Untitled'),
          h('div', { class: 'proj__m' }, (cats.filter(function (c) { return c.id === p.category; })[0] || { label: '(no category)' }).label + (p.brand ? ' \u00B7 ' + p.brand : '') + ' \u00B7 ' + imgs.length + ' images in ' + p.slides.length + ' slides')),
        h('div', { class: 'row' },
          h('button', { class: 'btn btn--sm', type: 'button', onclick: function () { openProject(p); } }, 'Edit'),
          h('button', { class: 'icon', type: 'button', title: 'Move up', onclick: function () { moveProject(p, -1); } }, '\u2191'),
          h('button', { class: 'icon', type: 'button', title: 'Move down', onclick: function () { moveProject(p, 1); } }, '\u2193'),
          h('button', { class: 'icon', type: 'button', title: 'Duplicate', onclick: function () { var c = clone(p); c.id = 'p-' + uid(); c.title += ' (copy)'; projects.splice(projects.indexOf(p) + 1, 0, c); touch(); renderShell(); } }, '\u29C9'),
          h('button', { class: 'icon icon--danger', type: 'button', title: 'Delete', onclick: function () {
            if (confirm('Delete the project "' + p.title + '"?')) { projects.splice(projects.indexOf(p), 1); touch(); renderShell(); }
          } }, '\u2715'))));
    });
    if (cats.length && !list.length) body.appendChild(h('p', { class: 'hint' }, 'No projects here yet. Click "+ Add project".'));
    view.appendChild(h('div', { class: 'card' }, body));
  }

  function moveProject(p, d) {
    var arr = S.content.portfolio.projects;
    var same = arr.filter(function (x) { return x.category === p.category; });
    var i = same.indexOf(p), other = same[i + d];
    if (!other) return;
    var a = arr.indexOf(p), b = arr.indexOf(other);
    arr[a] = other; arr[b] = p; touch(); renderShell();
  }

  function openProject(p, isNew) {
    var pf = S.content.portfolio;
    var body = h('div', { class: 'modal__body' });
    body.appendChild(h('div', { class: 'grid2' },
      h('label', { class: 'f' }, 'Project title (shown on the card)', (function () { var i = h('input', { class: 'in', type: 'text', value: p.title }); i.addEventListener('input', function () { p.title = i.value; touch(); }); return i; })()),
      h('label', { class: 'f' }, 'Brand name (for your own reference)', (function () { var i = h('input', { class: 'in', type: 'text', value: p.brand || '' }); i.addEventListener('input', function () { p.brand = i.value; touch(); }); return i; })())));
    var sel = h('select', { class: 'in' }, pf.categories.map(function (c) { return h('option', { value: c.id }, c.label); }));
    sel.value = p.category; sel.addEventListener('change', function () { p.category = sel.value; touch(); });
    body.appendChild(h('div', { class: 'grid2' }, h('label', { class: 'f' }, 'Category', sel),
      h('label', { class: 'f' }, 'Image description (for screen readers)', (function () { var i = h('input', { class: 'in', type: 'text', value: p.alt || '' }); i.addEventListener('input', function () { p.alt = i.value; touch(); }); return i; })())));
    body.appendChild(imageField('Cover image (the card on the Portfolio page)', p, 'cover', 'Best size 4000 x 3000 px (4:3). Leave empty to use the first slide image.'));
    var ph = h('input', { type: 'checkbox', checked: !!p.placeholder });
    ph.addEventListener('change', function () { p.placeholder = ph.checked; touch(); });
    body.appendChild(h('label', { class: 'check' }, ph, 'Show "Placeholder" badge'));
    body.appendChild(slidesEditor(p));
    modal(isNew ? 'New project' : 'Edit project', body, function () { renderShell(); });
  }

  function slidesEditor(p) {
    var wrap = h('div', { class: 'list' });
    function render() {
      wrap.innerHTML = '';
      wrap.appendChild(h('div', { class: 'lbl' }, 'Slides (the preview slider)'));
      wrap.appendChild(h('p', { class: 'hint' }, 'Add as many slides as you like. Each slide holds 1 to 3 images shown side by side, and the frame fits the images.'));
      p.slides.forEach(function (sl, i) {
        var imgs = h('div', { class: 'slide__imgs' });
        sl.forEach(function (u, j) {
          imgs.appendChild(h('div', { class: 'sthumb' }, h('img', { src: ru(u), alt: '' }),
            h('button', { type: 'button', title: 'Remove image', onclick: function () { sl.splice(j, 1); if (!sl.length) p.slides.splice(i, 1); touch(); render(); } }, '\u2715')));
        });
        var row = h('div', { class: 'slide' }, h('span', { class: 'slide__n' }, String(i + 1)), imgs);
        var prog = h('span', { class: 'prog' });
        if (sl.length < 3) {
          imgs.appendChild(h('button', { class: 'addimg', type: 'button', onclick: function () {
            pickFiles(true).then(function (fs) {
              fs = fs.slice(0, 3 - sl.length);
              if (!fs.length) return;
              return seq(fs, function (f, k) { prog.textContent = 'Uploading ' + (k + 1) + '/' + fs.length + '...'; return uploadFile(f).then(function (u) { sl.push(u); }); })
                .then(function () { touch(); render(); }).catch(function (e) { fail(e); touch(); render(); });
            });
          } }, '+ Image'));
          imgs.appendChild(h('button', { class: 'addimg', type: 'button', onclick: function () { library(function (u) { sl.push(u); touch(); render(); }); } }, 'Library'));
        }
        row.appendChild(prog);
        row.appendChild(h('div', { class: 'row' },
          h('button', { class: 'icon', type: 'button', disabled: i === 0, title: 'Move up', onclick: function () { move(p.slides, i, -1); touch(); render(); } }, '\u2191'),
          h('button', { class: 'icon', type: 'button', disabled: i === p.slides.length - 1, title: 'Move down', onclick: function () { move(p.slides, i, 1); touch(); render(); } }, '\u2193'),
          h('button', { class: 'icon icon--danger', type: 'button', title: 'Delete slide', onclick: function () { p.slides.splice(i, 1); touch(); render(); } }, '\u2715')));
        wrap.appendChild(row);
      });
      var per = h('select', { class: 'in', style: 'width:auto' }, [1, 2, 3].map(function (n) { return h('option', { value: n }, n + (n === 1 ? ' image per slide' : ' images per slide')); }));
      var prog2 = h('span', { class: 'prog' });
      wrap.appendChild(h('div', { class: 'row' },
        h('button', { class: 'btn btn--sm', type: 'button', onclick: function () { p.slides.push([]); touch(); render(); } }, '+ Add empty slide'),
        h('span', { class: 'hint' }, 'or add many images at once:'), per,
        h('button', { class: 'btn btn--sm btn--primary', type: 'button', onclick: function () {
          pickFiles(true).then(function (fs) {
            if (!fs.length) return;
            var n = parseInt(per.value, 10), urls = [];
            return seq(fs, function (f, k) { prog2.textContent = 'Uploading ' + (k + 1) + '/' + fs.length + '...'; return uploadFile(f).then(function (u) { urls.push(u); }); })
              .catch(fail).then(function () {
                for (var k = 0; k < urls.length; k += n) p.slides.push(urls.slice(k, k + n));
                if (urls.length) { touch(); toast(urls.length + ' image(s) added.', 'ok'); }
                render();
              });
          });
        } }, 'Upload images'), prog2));
    }
    render();
    return wrap;
  }
  function seq(list, fn) {
    return list.reduce(function (pr, x, i) { return pr.then(function () { return fn(x, i); }); }, Promise.resolve());
  }

  // ---------- history ----------
  function renderHistory(view) {
    var card = h('div', { class: 'card__body' }, h('h2', {}, 'Earlier saved versions'),
      h('p', { class: 'hint' }, 'Every time you save, the previous version is kept (last 25). Load one into the editor, check it with Preview, then Save to make it live.'));
    view.appendChild(h('div', { class: 'card' }, card));
    api('GET', '/api/content?history=').then(function (j) {
      if (!j.items.length) card.appendChild(h('p', { class: 'hint' }, 'Nothing here yet. Versions appear after your second save.'));
      j.items.forEach(function (it) {
        card.appendChild(h('div', { class: 'row' }, h('span', { class: 'grow' }, new Date(it.savedAt).toLocaleString()),
          h('button', { class: 'btn btn--sm', type: 'button', onclick: function () {
            if (S.dirty && !confirm('This replaces your current unsaved edits. Continue?')) return;
            api('GET', '/api/content?history=' + encodeURIComponent(it.id)).then(function (snap) {
              S.content = normalize(snap.content); S.dirty = true; toast('Loaded. Click "Save changes" to make it live.', 'ok'); go({ name: 'page', slug: 'home' });
            }).catch(fail);
          } }, 'Load into editor')));
      });
    }).catch(fail);
  }

  // ---------- account ----------
  function renderAccount(view) {
    if (S.me.mustChange) view.appendChild(h('div', { class: 'banner' }, 'Please set your own ID and password now. Until then saving is switched off, so nobody can use the public demo login to change your site.'));
    var u = h('input', { class: 'in', type: 'text', value: S.me.username, autocomplete: 'username' });
    var cur = h('input', { class: 'in', type: 'password', autocomplete: 'current-password' });
    var np = h('input', { class: 'in', type: 'password', autocomplete: 'new-password' });
    var np2 = h('input', { class: 'in', type: 'password', autocomplete: 'new-password' });
    var err = h('p', { class: 'err' });
    var btn = h('button', { class: 'btn btn--primary', type: 'submit' }, 'Change ID / password');
    var form = h('form', { class: 'card__body' }, h('h2', {}, 'Change login'),
      h('label', { class: 'f' }, 'ID (username)', u), h('label', { class: 'f' }, 'Current password', cur),
      h('label', { class: 'f' }, 'New password', np, h('span', { class: 'hint' }, 'At least 10 characters.')), h('label', { class: 'f' }, 'Repeat new password', np2), err, h('div', {}, btn));
    form.addEventListener('submit', function (e) {
      e.preventDefault(); err.textContent = '';
      if (np.value !== np2.value) { err.textContent = 'The two new passwords do not match.'; return; }
      btn.disabled = true;
      api('POST', '/api/auth', { action: 'change', username: u.value.trim(), currentPassword: cur.value, newPassword: np.value }).then(function (j) {
        S.me = j; toast('Login updated.', 'ok'); renderShell();
      }).catch(function (e2) { err.textContent = e2.message; btn.disabled = false; if (e2.status === 401) fail(e2); });
    });
    view.appendChild(h('div', { class: 'card' }, form));
  }

  // ---------- boot ----------
  var resetToken = new URLSearchParams(location.search).get('reset');
  if (resetToken) { renderReset(resetToken); return; }
  api('GET', '/api/auth').then(function (j) {
    if (!j.loggedIn) return renderLogin();
    S.me = j;
    return loadContent().then(function () { S.view = j.mustChange ? { name: 'account' } : { name: 'page', slug: 'home' }; renderShell(); });
  }).catch(function (e) {
    $('#app').innerHTML = '';
    $('#app').appendChild(h('div', { class: 'login' }, h('div', { class: 'login__card' }, h('h1', {}, 'Cannot reach the server'),
      h('p', {}, 'The admin panel needs the site to be running on Vercel (or locally with: node dev-server.js). ' + (e.message || '')))));
  });
})();
