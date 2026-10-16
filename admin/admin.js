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
  var S = { me: null, content: null, rev: 0, dirty: false, view: { name: 'page', slug: 'home' }, pfCat: 'all', trash: {} };
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

  var bgRefresh = null; // set while the project popup is open: repaints the background demo
  function touch() {
    if (!S.dirty) { S.dirty = true; updateTop(); }
    if (bgRefresh) bgRefresh();
  }
  function updateTop() {
    Array.prototype.forEach.call(document.querySelectorAll('.js-save'), function (b) { b.disabled = !S.dirty; });
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

  var saveQ = Promise.resolve();
  function save() { saveQ = saveQ.then(doSave, doSave); return saveQ; } // saves run one after another, so the version number never clashes
  function doSave() {
    if (!S.dirty) return Promise.resolve();
    function btns() { return Array.prototype.slice.call(document.querySelectorAll('#saveBtn, .js-save')); }
    btns().forEach(function (b) { b.disabled = true; b.textContent = 'Saving...'; });
    return api('PUT', '/api/content', { rev: S.rev, content: S.content }).then(function (j) {
      S.rev = j.rev; S.dirty = false; updateTop();
      return purgeTrash().then(function (n) {
        toast('Saved. Your live site is updated.' + (n ? ' ' + n + ' unused file' + (n > 1 ? 's' : '') + ' deleted from the Library.' : ''), 'ok');
      });
    }).catch(function (e) {
      if (e.code === 'must_change') { go({ name: 'account' }); }
      fail(e);
    }).then(function () { btns().forEach(function (b) { b.textContent = 'Save changes'; b.disabled = !S.dirty; }); });
  }
  // Files of removed images/projects. They are deleted from the Library right after a successful save,
  // and only if nothing on the site uses them any more (a duplicated project may share the same file).
  // Is this file address used in the content? Matches the whole address only, so "images/a.jpg" does not match inside "https://host/images/a.jpg".
  function urlInUse(text, url) {
    var from = 0, i, before, after;
    while ((i = text.indexOf(url, from)) !== -1) {
      before = i ? text.charAt(i - 1) : '';
      after = text.charAt(i + url.length);
      if (!/[A-Za-z0-9\/.:_~%@-]/.test(before) && !/[A-Za-z0-9_~%\/-]/.test(after)) return true;
      from = i + 1;
    }
    return false;
  }
  function queueTrash(urls) { (urls || []).forEach(function (u) { if (u) S.trash[u] = true; }); }
  function filesOf(p) {
    var all = [p.cover].concat([].concat.apply([], p.slides || []));
    return all.filter(function (u, i) { return u && all.indexOf(u) === i; });
  }
  function purgeTrash() {
    var urls = Object.keys(S.trash);
    if (!urls.length) return Promise.resolve(0);
    var text = JSON.stringify(S.content);
    var doomed = urls.filter(function (u) { return !urlInUse(text, u); });
    S.trash = {};
    if (!doomed.length) return Promise.resolve(0);
    return api('GET', '/api/upload').then(function (j) {
      var map = {};
      (j.items || []).forEach(function (it) { map[it.url] = it.pathname; });
      var paths = doomed.map(function (u) { return map[u]; }).filter(Boolean); // only files in the Library can be deleted
      if (!paths.length) return 0;
      return api('POST', '/api/upload?action=delete', { paths: paths }).then(function (r) { return r.deleted || 0; });
    }).catch(function () { return 0; });
  }
  function confirmBox(title, text, okLabel) {
    return new Promise(function (resolve) {
      var back = h('div', { class: 'modal modal--confirm' });
      function done(v) { document.removeEventListener('keydown', onKey, true); back.remove(); resolve(v); }
      function onKey(e) { if (e.key === 'Escape') { e.stopPropagation(); done(false); } }
      var cancel = h('button', { class: 'btn', type: 'button', onclick: function () { done(false); } }, 'Cancel');
      var ok = h('button', { class: 'btn btn--danger btn--solid', type: 'button', onclick: function () { done(true); } }, okLabel || 'Delete');
      back.appendChild(h('div', { class: 'modal__box confirm', role: 'alertdialog', 'aria-label': title },
        h('div', { class: 'modal__head' }, h('h2', {}, title)),
        h('div', { class: 'confirm__body' }, h('p', { class: 'confirm__text' }, text), h('div', { class: 'row confirm__btns' }, cancel, ok))));
      back.addEventListener('click', function (e) { if (e.target === back) done(false); });
      document.addEventListener('keydown', onKey, true);
      document.body.appendChild(back);
      cancel.focus();
    });
  }
  function saveButton(extra) {
    var b = h('button', { class: 'btn btn--primary js-save' + (extra ? ' ' + extra : ''), type: 'button', onclick: save }, 'Save changes');
    b.disabled = !S.dirty;
    return b;
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
  var VIDEO_RE = /\.(mp4|webm|mov|m4v)(\?|#|$)/i;
  function isVideo(u) { return VIDEO_RE.test(String(u || '')); }
  function mediaThumb(u) {
    return isVideo(u) ? h('video', { src: ru(u) + '#t=0.1', muted: true, preload: 'metadata', playsinline: true }) : h('img', { src: ru(u), alt: '' });
  }
  function typeOf(file) {
    if (file.type) return file.type;
    var m = /\.([a-z0-9]+)$/i.exec(file.name || '');
    return ({ mp4: 'video/mp4', m4v: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime' })[m && m[1].toLowerCase()] || '';
  }
  // Send the file straight to R2 (original quality, no Vercel size limit).
  function putDirect(uploadUrl, file, type, onProgress) {
    return new Promise(function (resolve, reject) {
      var x = new XMLHttpRequest();
      x.open('PUT', uploadUrl);
      x.setRequestHeader('Content-Type', type);
      x.upload.onprogress = function (e) { if (onProgress && e.lengthComputable) onProgress(Math.round(e.loaded / e.total * 100)); };
      x.onload = function () { if (x.status >= 200 && x.status < 300) resolve(); else reject(new Error('Upload failed (' + x.status + '). Check the CORS policy of your R2 bucket.')); };
      x.onerror = function () { reject(new Error('The browser blocked the upload. Add the CORS policy to your R2 bucket, then try again.')); };
      x.send(file);
    });
  }
  function uploadFile(file, onProgress) {
    var type = typeOf(file);
    return api('POST', '/api/upload?action=sign', { name: file.name, type: type, size: file.size }).then(function (j) {
      if (j.direct) return putDirect(j.uploadUrl, file, type, onProgress).then(function () { return j.url; });
      if (/^video\//.test(type)) throw new Error('Video upload needs Cloudflare R2 storage.');
      // old path (no R2): compress to fit the 4.5 MB limit
      return prepareImage(file).then(function (blob) {
        return api('POST', '/api/upload?name=' + encodeURIComponent(file.name), blob, { 'Content-Type': blob.type || 'application/octet-stream' });
      }).then(function (r) { return r.url; });
    });
  }
  function pickFiles(multiple, kind) {
    return new Promise(function (res) {
      var accept = kind === 'video' ? 'video/mp4,video/webm,video/quicktime,.mp4,.webm,.mov,.m4v' : 'image/jpeg,image/png,image/webp,image/gif,image/avif';
      var i = h('input', { type: 'file', accept: accept, multiple: !!multiple });
      i.addEventListener('change', function () { res(Array.prototype.slice.call(i.files)); });
      i.click();
    });
  }
  function library(onPick) {
    var grid = h('div', { class: 'lib' }, h('p', { class: 'hint' }, 'Loading...'));
    var m = modal('Image library', h('div', { class: 'modal__body' }, h('p', { class: 'hint' }, 'Images you uploaded before. Click one to use it.'), grid));
    api('GET', '/api/upload').then(function (j) {
      grid.innerHTML = '';
      j.items = j.items.filter(function (it) { return !isVideo(it.url) && it.url.indexOf('/uploads/_check/') === -1; });
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
  function modal(title, body, onClose, withSave) {
    var back = h('div', { class: 'modal' });
    function close() { back.remove(); document.body.style.overflow = ''; if (onClose) onClose(); }
    back.appendChild(h('div', { class: 'modal__box', role: 'dialog', 'aria-label': title },
      h('div', { class: 'modal__head' }, h('h2', {}, title), withSave ? saveButton('btn--sm') : null, h('button', { class: 'btn btn--sm', type: 'button', onclick: close }, 'Close')), body));
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
      h('h1', {}, 'Forgot password'), h('p', {}, 'Enter your email. We send a 6-digit code to it.'),
      h('label', { class: 'f' }, 'Email', em), err, ok, btn,
      h('button', { class: 'linkbtn', type: 'button', onclick: function () { renderLogin(); } }, 'Back to login'));
    form.addEventListener('submit', function (e) {
      e.preventDefault(); btn.disabled = true; err.textContent = ''; ok.textContent = '';
      api('POST', '/api/auth', { action: 'forgot', email: em.value.trim() }).then(function (j) {
        ok.textContent = j.message || 'Email found.';
        setTimeout(function () { renderOtp(em.value.trim(), j.seconds || 60); }, 700);
      }).catch(function (e2) { err.textContent = e2.message; btn.disabled = false; });
    });
    app.appendChild(h('div', { class: 'login' }, form));
    em.focus();
  }

  var otpTimer = null;
  function renderOtp(email, seconds) {
    if (otpTimer) clearInterval(otpTimer);
    var app = $('#app'); app.innerHTML = '';
    var code = h('input', { class: 'in', type: 'text', inputmode: 'numeric', autocomplete: 'one-time-code', maxlength: 6, required: true, placeholder: '6-digit code' });
    var err = h('p', { class: 'err' }, '');
    var info = h('p', { class: 'okmsg' }, 'Code valid for ' + seconds + ' seconds.');
    var btn = h('button', { class: 'btn btn--primary', type: 'submit' }, 'Verify code');
    var resend = h('button', { class: 'linkbtn', type: 'button', disabled: true }, 'Send a new code');
    var form = h('form', { class: 'login__card' },
      h('h1', {}, 'Enter the code'), h('p', {}, 'We sent a 6-digit code to ' + email + '.'),
      h('label', { class: 'f' }, 'Code', code), info, err, btn, resend,
      h('button', { class: 'linkbtn', type: 'button', onclick: function () { clearInterval(otpTimer); renderLogin(); } }, 'Back to login'));
    var left = seconds;
    otpTimer = setInterval(function () {
      left--;
      if (left <= 0) { clearInterval(otpTimer); info.textContent = 'The code has expired. Send a new code.'; resend.disabled = false; }
      else info.textContent = 'Code valid for ' + left + ' seconds.';
    }, 1000);
    resend.addEventListener('click', function () {
      err.textContent = ''; resend.disabled = true;
      api('POST', '/api/auth', { action: 'forgot', email: email }).then(function (j) { renderOtp(email, j.seconds || 60); })
        .catch(function (e2) { err.textContent = e2.message; resend.disabled = false; });
    });
    form.addEventListener('submit', function (e) {
      e.preventDefault(); err.textContent = ''; btn.disabled = true;
      api('POST', '/api/auth', { action: 'verify-otp', code: code.value.trim() }).then(function (j) {
        clearInterval(otpTimer); renderReset(j.token);
      }).catch(function (e2) { err.textContent = e2.message; btn.disabled = false; });
    });
    app.appendChild(h('div', { class: 'login' }, form));
    code.focus();
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
    side.appendChild(nav('Library', { name: 'library' }, 'images, videos'));
    side.appendChild(nav('Site settings', { name: 'site' }, 'menu, footer'));
    side.appendChild(h('div', { class: 'side__group' }, 'Tools'));
    side.appendChild(nav('History', { name: 'history' }, 'restore'));
    side.appendChild(nav('Account', { name: 'account' }, 'password'));
    side.appendChild(h('div', { class: 'side__foot' },
      h('a', { class: 'btn btn--sm', href: '/', target: '_blank', rel: 'noopener' }, 'Open live site'),
      h('button', { class: 'btn btn--sm', type: 'button', onclick: logout }, 'Log out')));

    var titles = { page: pageLabel(v.slug || 'home'), portfolio: 'Portfolio projects', library: 'Library', site: 'Site settings', history: 'History', account: 'Account' };
    var top = h('header', { class: 'top' },
      h('button', { class: 'icon menu-btn', type: 'button', 'aria-label': 'Menu', onclick: function () { side.classList.toggle('is-open'); } }, '\u2630'),
      h('h1', {}, titles[v.name]), h('span', { id: 'state', class: 'state' }),
      h('button', { class: 'btn', type: 'button', onclick: preview }, 'Preview'),
      h('button', { class: 'btn btn--primary', id: 'saveBtn', type: 'button', onclick: save }, 'Save changes'));
    var view = h('div', { class: 'view', id: 'view' });
    app.appendChild(h('div', { class: 'shell' }, side, h('div', { class: 'main' }, top, view)));
    updateTop();
    if (S.me.mustChange && v.name !== 'account') view.appendChild(h('div', { class: 'banner' }, 'You are still using the demo password. Open the Account page and change it, otherwise you will not be able to save.'));
    ({ page: renderPage, portfolio: renderPortfolio, library: renderLibrary, site: renderSite, history: renderHistory, account: renderAccount })[v.name](view);
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

    view.appendChild(h('div', { class: 'card' }, h('div', { class: 'card__body' }, h('div', { class: 'row' },
      h('p', { class: 'hint grow' }, 'Add or change projects, categories and uploads here, then click Save to put them on your live site. You do not need to leave this page.'),
      saveButton()))));

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
      var cover = p.cover || imgs.filter(function (u) { return !isVideo(u); })[0];
      body.appendChild(h('div', { class: 'proj' }, h('div', { class: 'thumb' }, cover ? h('img', { src: ru(cover), alt: '' }) : 'No cover'),
        h('div', { class: 'grow' }, h('div', { class: 'proj__t' }, p.title || 'Untitled'),
          h('div', { class: 'proj__m' }, (cats.filter(function (c) { return c.id === p.category; })[0] || { label: '(no category)' }).label + (p.brand ? ' \u00B7 ' + p.brand : '') + ' \u00B7 ' + imgs.length + ' images in ' + p.slides.length + ' slides')),
        h('div', { class: 'row' },
          h('button', { class: 'btn btn--sm', type: 'button', onclick: function () { openProject(p); } }, 'Edit'),
          h('button', { class: 'icon', type: 'button', title: 'Move up', onclick: function () { moveProject(p, -1); } }, '\u2191'),
          h('button', { class: 'icon', type: 'button', title: 'Move down', onclick: function () { moveProject(p, 1); } }, '\u2193'),
          h('button', { class: 'icon', type: 'button', title: 'Duplicate', onclick: function () { var c = clone(p); c.id = 'p-' + uid(); c.title += ' (copy)'; projects.splice(projects.indexOf(p) + 1, 0, c); touch(); renderShell(); } }, '\u29C9'),
          h('button', { class: 'icon icon--danger', type: 'button', title: 'Delete project', onclick: function () {
            var files = filesOf(p);
            var msg = '"' + p.title + '" will be removed from your website' +
              (files.length ? ', and its ' + files.length + (files.length > 1 ? ' images/videos' : ' image/video') + ' will be deleted from the Library' : '') +
              '. This cannot be undone.' + (S.dirty ? '\n\nYour other unsaved changes will be saved too.' : '');
            confirmBox('Delete this project?', msg, 'Delete project').then(function (yes) {
              if (!yes) return;
              projects.splice(projects.indexOf(p), 1); queueTrash(files); touch(); renderShell();
              save(); // saves the site, then removes the files that nothing uses any more
            });
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
    body.appendChild(imageField('Cover image (the card on the Portfolio page)', p, 'cover', 'Best size 4000 x 3000 px (4:3). Leave empty to use the first slide image. A project that has only videos needs a cover image.'));
    var ph = h('input', { type: 'checkbox', checked: !!p.placeholder });
    ph.addEventListener('change', function () { p.placeholder = ph.checked; touch(); });
    body.appendChild(h('label', { class: 'check' }, ph, 'Show "Placeholder" badge'));
    body.appendChild(bgSection(p));
    body.appendChild(slidesEditor(p));
    modal(isNew ? 'New project' : 'Edit project', body, function () { bgRefresh = null; renderShell(); }, true);
  }

  // ---------- small colour picker (no browser eyedropper, no zoom) ----------
  function hexToRgb(t) { var m = /^#?([0-9a-f]{6})$/i.exec(String(t || '')); if (!m) return null; var n = parseInt(m[1], 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; }
  function rgbToHex(r, g, b) { return '#' + [r, g, b].map(function (v) { return ('0' + Math.round(Math.max(0, Math.min(255, v))).toString(16)).slice(-2); }).join(''); }
  function normHex(t) {
    t = String(t || '').trim().replace(/^#/, '');
    if (/^[0-9a-f]{3}$/i.test(t)) t = t.split('').map(function (c) { return c + c; }).join('');
    return /^[0-9a-f]{6}$/i.test(t) ? '#' + t.toLowerCase() : null;
  }
  function rgbToHsv(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    var mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn, hh = 0;
    if (d) { hh = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; hh *= 60; if (hh < 0) hh += 360; }
    return [hh, mx ? d / mx : 0, mx];
  }
  function hsvToRgb(hh, s, v) {
    var c = v * s, x = c * (1 - Math.abs((hh / 60) % 2 - 1)), m = v - c, r = 0, g = 0, b = 0;
    if (hh < 60) { r = c; g = x; } else if (hh < 120) { r = x; g = c; } else if (hh < 180) { g = c; b = x; }
    else if (hh < 240) { g = x; b = c; } else if (hh < 300) { r = x; b = c; } else { r = c; b = x; }
    return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
  }
  // the project's image, read from the file itself (so the browser lets us look at its pixels). Cached per address.
  var bitmapCache = {};
  var PIPETTE = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m2 22 1-1h3l9-9"/><path d="M3 21v-3l9-9"/><path d="m15 6 3.4-3.4a2.1 2.1 0 1 1 3 3L18 9l.4.4a2.1 2.1 0 1 1-3 3l-3.8-3.8a2.1 2.1 0 1 1 3-3l.4.4Z"/></svg>';
  function loadBitmap(url) {
    if (bitmapCache[url]) return bitmapCache[url];
    bitmapCache[url] = fetch(ru(url), { mode: 'cors', cache: 'no-store' }).then(function (r) {
      if (!r.ok) throw new Error('x'); return r.blob();
    }).then(function (blob) {
      return createImageBitmap(blob, { resizeWidth: 640, resizeQuality: 'medium' }).catch(function () { return createImageBitmap(blob); });
    }).catch(function () { delete bitmapCache[url]; return null; });
    return bitmapCache[url];
  }
  // up to 6 main colours of an image
  function imageColors(url) {
    return loadBitmap(url).then(function (bm) {
      if (!bm) return [];
      var S = 48, c = document.createElement('canvas'); c.width = S; c.height = S;
      var x = c.getContext('2d', { willReadFrequently: true });
      x.drawImage(bm, 0, 0, S, S);
      var d = x.getImageData(0, 0, S, S).data, bins = {}, i;
      for (i = 0; i < d.length; i += 4) {
        if (d[i + 3] < 200) continue;
        var k = ((d[i] >> 4) << 8) | ((d[i + 1] >> 4) << 4) | (d[i + 2] >> 4);
        var bn = bins[k] || (bins[k] = { n: 0, r: 0, g: 0, b: 0 });
        bn.n++; bn.r += d[i]; bn.g += d[i + 1]; bn.b += d[i + 2];
      }
      var list = Object.keys(bins).map(function (k2) { return bins[k2]; }).sort(function (a, b) { return b.n - a.n; }), out = [];
      list.forEach(function (bn) {
        if (out.length >= 6) return;
        var col = [bn.r / bn.n, bn.g / bn.n, bn.b / bn.n];
        var far = out.every(function (o) { return Math.abs(o[0] - col[0]) + Math.abs(o[1] - col[1]) + Math.abs(o[2] - col[2]) > 90; });
        if (far) out.push(col);
      });
      return out.map(function (o) { return rgbToHex(o[0], o[1], o[2]); });
    });
  }
  var openPop = null;
  function closePop() { if (openPop) { if (openPop.reset) openPop.reset(); openPop.pop.hidden = true; openPop.sw.classList.remove('is-open'); openPop = null; } }
  if (!window.__cpInit) {
    window.__cpInit = true;
    document.addEventListener('pointerdown', function (e) { if (openPop && !e.target.closest('.cppop') && !e.target.closest('.cpswatch') && !e.target.closest('.cpeye')) closePop(); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && openPop) { closePop(); e.stopPropagation(); } }, true);
  }
  function colorField(label, start, onChange, getImage) {
    var cur = start, hsv = rgbToHsv.apply(null, hexToRgb(start) || [0, 0, 0]);
    var sw = h('button', { class: 'cpswatch', type: 'button', title: 'Choose a color', 'aria-label': label + ' color' });
    sw.style.background = cur;
    var eye = h('button', { class: 'cpeye', type: 'button', title: 'Eyedropper: pick a color from your image', 'aria-label': label + ' eyedropper', html: PIPETTE });
    var hx = h('input', { class: 'in cphex', type: 'text', value: cur, maxlength: 7, spellcheck: false, autocomplete: 'off', 'aria-label': label + ' color code', placeholder: '#rrggbb' });
    var pop = null, svEl, dot, hue, chipsBox, pickBox, imgBtn;
    function apply(hex, fromTyping) {
      cur = hex; sw.style.background = hex;
      if (!fromTyping) hx.value = hex;
      hx.classList.remove('bad');
      onChange(hex);
    }
    function paintPop() {
      if (!pop) return;
      svEl.style.background = 'linear-gradient(to top, #000, rgba(0,0,0,0)), linear-gradient(to right, #fff, hsl(' + Math.round(hsv[0]) + ', 100%, 50%))';
      dot.style.left = (hsv[1] * 100) + '%'; dot.style.top = ((1 - hsv[2]) * 100) + '%';
      hue.value = Math.round(hsv[0]);
    }
    function fromHsv() { var rgb = hsvToRgb(hsv[0], hsv[1], hsv[2]); apply(rgbToHex(rgb[0], rgb[1], rgb[2])); paintPop(); }
    function setHex(hex) { if (!hex) return; hsv = rgbToHsv.apply(null, hexToRgb(hex)); apply(hex); paintPop(); }

    // eyedropper on the project's own image: hover shows the colour under the pointer, click takes it. No zoom.
    function showPick(on) {
      if (!pop) return;
      pickBox.hidden = !on; pop.classList.toggle('wide', on); imgBtn.classList.toggle('btn--primary', on);
      pickBox.innerHTML = '';
      if (!on) return;
      var msg = function (t) { pickBox.innerHTML = ''; pickBox.appendChild(h('p', { class: 'hint' }, t)); };
      var url = getImage();
      if (!url) return msg('Add a cover image first, then you can pick colors from it.');
      msg('Loading your image...');
      loadBitmap(url).then(function (bm) {
        if (pickBox.hidden) return;
        if (!bm) return msg('This image cannot be read here (its host does not allow it). Use the color square, the code box or "Pick from screen" instead.');
        pickBox.innerHTML = '';
        pickBox.appendChild(h('p', { class: 'hint' }, 'Move over the image and click the color you want.'));
        var cv = h('canvas', { class: 'cpcanvas' }); cv.width = bm.width; cv.height = bm.height;
        var ctx = cv.getContext('2d', { willReadFrequently: true }); ctx.drawImage(bm, 0, 0);
        var tipSw = h('span', { class: 'cptip__sw' }), tipHex = h('span', {}, '');
        var tip = h('div', { class: 'cptip', hidden: true }, tipSw, tipHex);
        var holder = h('div', { class: 'cpholder' }, cv, tip);
        function sample(e) {
          var r = cv.getBoundingClientRect();
          var x = Math.max(0, Math.min(cv.width - 1, Math.round((e.clientX - r.left) * cv.width / r.width)));
          var y = Math.max(0, Math.min(cv.height - 1, Math.round((e.clientY - r.top) * cv.height / r.height)));
          var x0 = Math.max(0, x - 1), y0 = Math.max(0, y - 1), w = Math.min(3, cv.width - x0), hh = Math.min(3, cv.height - y0);
          var d = ctx.getImageData(x0, y0, w, hh).data, rr = 0, gg = 0, bb = 0, n = 0;
          for (var i = 0; i < d.length; i += 4) { rr += d[i]; gg += d[i + 1]; bb += d[i + 2]; n++; }
          return { hex: rgbToHex(rr / n, gg / n, bb / n), px: e.clientX - r.left, py: e.clientY - r.top };
        }
        cv.addEventListener('pointermove', function (e) {
          var s = sample(e);
          tip.hidden = false; tipSw.style.background = s.hex; tipHex.textContent = s.hex;
          tip.style.left = Math.max(0, Math.min(s.px + 14, holder.clientWidth - 98)) + 'px';
          tip.style.top = Math.max(0, s.py - 36) + 'px';
        });
        cv.addEventListener('pointerleave', function () { tip.hidden = true; });
        cv.addEventListener('click', function (e) { setHex(sample(e).hex); showPick(false); });
        pickBox.appendChild(holder);
        pop.scrollIntoView({ block: 'nearest' });
      });
    }

    function build() {
      svEl = h('div', { class: 'cpsv' }); dot = h('div', { class: 'cpdot' }); svEl.appendChild(dot);
      function move(e) {
        var r = svEl.getBoundingClientRect();
        hsv[1] = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
        hsv[2] = 1 - Math.max(0, Math.min(1, (e.clientY - r.top) / r.height));
        fromHsv();
      }
      svEl.addEventListener('pointerdown', function (e) { svEl.setPointerCapture(e.pointerId); move(e); svEl.onpointermove = move; });
      svEl.addEventListener('pointerup', function () { svEl.onpointermove = null; });
      hue = h('input', { class: 'cphue', type: 'range', min: 0, max: 359, step: 1, 'aria-label': 'Shade' });
      hue.addEventListener('input', function () { hsv[0] = Number(hue.value); if (hsv[1] === 0) hsv[1] = 0.5; if (hsv[2] === 0) hsv[2] = 0.5; fromHsv(); });
      imgBtn = h('button', { class: 'btn btn--sm cpbtn', type: 'button', title: 'Pick a color from your image', html: PIPETTE + '<span>Pick from image</span>' });
      imgBtn.addEventListener('click', function () { showPick(pickBox.hidden); });
      var tools = h('div', { class: 'row' }, imgBtn);
      if (window.EyeDropper) { // the browser's own screen eyedropper (Chrome / Edge), for colors outside the image
        var scr = h('button', { class: 'btn btn--sm cpbtn', type: 'button', title: 'Pick any color on your screen (the browser shows its own magnifier)', html: PIPETTE + '<span>Pick from screen</span>' });
        scr.addEventListener('click', function () { new window.EyeDropper().open().then(function (r) { setHex(normHex(r.sRGBHex)); }).catch(function () {}); });
        tools.appendChild(scr);
      }
      pickBox = h('div', { class: 'cppick', hidden: true });
      chipsBox = h('div', { class: 'cpchips' });
      pop = h('div', { class: 'cppop' }, tools, pickBox, svEl, hue, h('div', { class: 'cplbl', hidden: true }, 'Colors from your image'), chipsBox);
      pop.hidden = true;
      var lbl = pop.querySelector('.cplbl');
      var url = getImage();
      if (url) imageColors(url).then(function (cols) {
        if (!cols.length) return;
        lbl.hidden = false;
        cols.forEach(function (c) {
          var chip = h('button', { class: 'cpchip', type: 'button', title: c });
          chip.style.background = c;
          chip.addEventListener('click', function () { setHex(c); });
          chipsBox.appendChild(chip);
        });
      });
      return pop;
    }
    function openIt() {
      if (!pop) wrap.appendChild(build());
      if (openPop && openPop.sw === sw) return;
      closePop();
      pop.hidden = false; sw.classList.add('is-open');
      openPop = { pop: pop, sw: sw, reset: function () { showPick(false); } };
      paintPop();
      setTimeout(function () { pop.scrollIntoView({ block: 'nearest' }); }, 0);
    }
    sw.addEventListener('click', function () { if (openPop && openPop.sw === sw) { closePop(); return; } openIt(); });
    eye.addEventListener('click', function () { openIt(); showPick(true); });
    hx.addEventListener('input', function () {
      var n = normHex(hx.value);
      if (!n) { hx.classList.add('bad'); return; }
      hsv = rgbToHsv.apply(null, hexToRgb(n)); apply(n, true); paintPop();
    });
    hx.addEventListener('blur', function () { hx.value = cur; hx.classList.remove('bad'); });
    var wrap = h('div', { class: 'bgpick' }, h('span', { class: 'cplbl' }, label), h('div', { class: 'cprow' }, sw, hx, eye));
    return wrap;
  }

  // ---------- preview background colours (per project) ----------
  var BG_PRESETS = [
    ['Ocean', ['#2a5d8f', '#1d4268', '#132c47']],
    ['Forest', ['#2f6b57', '#235043', '#17372f']],
    ['Violet', ['#5b4a8f', '#443770', '#2c2450']],
    ['Rose', ['#8a4a65', '#693850', '#47273a']],
    ['Sunset', ['#8a5a3c', '#6a3f35', '#432a36']],
    ['Slate', ['#3d4b63', '#2c3850', '#1e2739']],
    ['Sand', ['#8a7352', '#6a5a42', '#4a3f2f']]
  ];
  function bgSection(p) {
    var wrap = h('div', { class: 'list bgsec' });
    var prev, prevImg, note;
    function gradient(c) { return 'linear-gradient(135deg, ' + c[0] + ', ' + c[1] + ' 55%, ' + c[2] + ')'; }
    function custom() { return Array.isArray(p.bg) && p.bg.length === 3 ? p.bg : null; }
    function firstImage() {
      if (p.cover) return p.cover;
      var all = [].concat.apply([], p.slides || []).filter(function (u) { return !isVideo(u); });
      return all[0] || '';
    }
    function paint() { // live demo: runs on every colour change, before saving
      if (!prev) return;
      var c = custom();
      prev.style.background = gradient(c || ['#11264a', '#0c1b38', '#0a1630']);
      note.textContent = c ? 'This is how the preview popup will look on your website.' : 'Auto: the website picks soft colors from the image itself. The box below shows a plain example.';
      var u = firstImage();
      if (u) { prevImg.src = ru(u); prevImg.style.display = ''; } else prevImg.style.display = 'none';
    }
    function render() {
      wrap.innerHTML = '';
      var c = custom();
      wrap.appendChild(h('div', { class: 'lbl' }, 'Preview background (the colors behind the images)'));
      wrap.appendChild(h('div', { class: 'row' },
        h('button', { class: 'btn btn--sm' + (c ? '' : ' btn--primary'), type: 'button', onclick: function () { if (!c) return; delete p.bg; touch(); render(); } }, 'Auto (from the image)'),
        h('button', { class: 'btn btn--sm' + (c ? ' btn--primary' : ''), type: 'button', onclick: function () { if (c) return; p.bg = BG_PRESETS[0][1].slice(); touch(); render(); } }, 'Choose colors')));
      closePop();
      note = h('p', { class: 'hint' }, '');
      prevImg = h('img', { alt: '' });
      prev = h('div', { class: 'bgprev' }, prevImg);
      wrap.appendChild(note);
      wrap.appendChild(prev); // the demo sits right here, above the pickers, so it is always visible while choosing
      if (c) {
        var picks = h('div', { class: 'bgpicks' });
        ['Start', 'Middle', 'End'].forEach(function (label, i) {
          picks.appendChild(colorField(label, c[i], function (hex) { p.bg[i] = hex; touch(); paint(); }, firstImage));
        });
        wrap.appendChild(picks);
        var chips = h('div', { class: 'bgpresets' });
        BG_PRESETS.forEach(function (pr) {
          chips.appendChild(h('button', { class: 'bgchip', type: 'button', title: pr[0], style: 'background:' + gradient(pr[1]), onclick: function () { p.bg = pr[1].slice(); touch(); render(); } }, pr[0]));
        });
        wrap.appendChild(h('div', { class: 'lbl' }, 'Or pick a ready-made one'));
        wrap.appendChild(chips);
      }
      paint();
    }
    bgRefresh = paint;
    render();
    return wrap;
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
          imgs.appendChild(h('div', { class: 'sthumb' }, mediaThumb(u),
            h('button', { type: 'button', title: 'Remove image', onclick: function () { var gone = sl.splice(j, 1); if (!sl.length) p.slides.splice(i, 1); queueTrash(gone); touch(); render(); save(); } }, '\u2715')));
        });
        var row = h('div', { class: 'slide' }, h('span', { class: 'slide__n' }, String(i + 1)), imgs);
        var prog = h('span', { class: 'prog' });
        if (sl.length < 3 && !sl.some(isVideo)) {
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
          h('button', { class: 'icon icon--danger', type: 'button', title: 'Delete slide', onclick: function () { var gone = p.slides.splice(i, 1); queueTrash([].concat.apply([], gone)); touch(); render(); save(); } }, '\u2715')));
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
        } }, 'Upload images'),
        h('button', { class: 'btn btn--sm btn--primary', type: 'button', onclick: function () {
          pickFiles(false, 'video').then(function (fs) {
            if (!fs[0]) return;
            prog2.textContent = 'Uploading video 0%...';
            return uploadFile(fs[0], function (pct) { prog2.textContent = 'Uploading video ' + pct + '%...'; })
              .then(function (u) { p.slides.push([u]); touch(); toast('Video added as a new slide.', 'ok'); render(); })
              .catch(function (e) { prog2.textContent = ''; fail(e); });
          });
        } }, '+ Video (up to 1 GB)'), prog2));
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

  // ---------- library: every uploaded file, with size, and delete ----------
  function fmtSize(b) {
    b = Number(b) || 0;
    if (b >= 1048576) return (b / 1048576).toFixed(b >= 10485760 ? 1 : 2) + ' MB';
    return Math.max(1, Math.round(b / 1024)) + ' KB';
  }
  function renderLibrary(view) {
    var items = [], selected = {}, filter = 'all';
    var usedText = JSON.stringify(S.content); // a file counts as "in use" if its address appears anywhere in your content (even unsaved edits)
    function isUsed(it) { return urlInUse(usedText, it.url); }
    var summary = h('p', { class: 'hint' }, 'Loading...');
    var listEl = h('div', { class: 'liblist' });
    var tools = h('div', { class: 'libtools' });
    view.appendChild(h('div', { class: 'card' }, h('div', { class: 'card__body' },
      h('h2', {}, 'Uploaded files'),
      h('p', { class: 'hint' }, 'Every image and video you uploaded. Tick the files you do not need and delete them to free up space. Deleting here happens immediately, you do not need to click Save changes.'),
      summary, tools, listEl)));

    function visible() {
      return items.filter(function (it) {
        if (filter === 'images') return !isVideo(it.url);
        if (filter === 'videos') return isVideo(it.url);
        if (filter === 'unused') return !isUsed(it);
        return true;
      });
    }
    function chosen() { return items.filter(function (it) { return selected[it.pathname]; }); }
    function drawTools() {
      tools.innerHTML = '';
      var vis = visible(), sel = chosen();
      var all = h('input', { type: 'checkbox', 'aria-label': 'Select all shown files' });
      all.checked = vis.length > 0 && vis.every(function (it) { return selected[it.pathname]; });
      all.addEventListener('change', function () { vis.forEach(function (it) { if (all.checked) selected[it.pathname] = true; else delete selected[it.pathname]; }); draw(); });
      tools.appendChild(h('label', { class: 'libsel' }, all, 'Select all'));
      [['all', 'All'], ['images', 'Images'], ['videos', 'Videos'], ['unused', 'Not used']].forEach(function (f) {
        tools.appendChild(h('button', { class: 'chip' + (filter === f[0] ? ' is-on' : ''), type: 'button', onclick: function () { filter = f[0]; draw(); } }, f[1]));
      });
      var total = sel.reduce(function (n, it) { return n + (it.size || 0); }, 0);
      tools.appendChild(h('span', { class: 'grow' }));
      if (sel.length) tools.appendChild(h('span', { class: 'hint' }, sel.length + ' selected, ' + fmtSize(total)));
      var del = h('button', { class: 'btn btn--sm btn--danger', type: 'button', onclick: remove }, 'Delete selected' + (sel.length ? ' (' + sel.length + ')' : ''));
      del.disabled = !sel.length;
      tools.appendChild(del);
    }
    function draw() {
      var all = items.reduce(function (n, it) { return n + (it.size || 0); }, 0);
      summary.textContent = items.length ? items.length + ' file' + (items.length > 1 ? 's' : '') + ', ' + fmtSize(all) + ' in total' : 'No uploads yet.';
      drawTools();
      listEl.innerHTML = '';
      var vis = visible();
      if (items.length && !vis.length) listEl.appendChild(h('p', { class: 'hint' }, 'No files in this view.'));
      vis.forEach(function (it) {
        var used = isUsed(it);
        var cb = h('input', { type: 'checkbox', 'aria-label': 'Select ' + it.name });
        cb.checked = !!selected[it.pathname];
        cb.addEventListener('change', function () { if (cb.checked) selected[it.pathname] = true; else delete selected[it.pathname]; row.classList.toggle('is-sel', cb.checked); drawTools(); });
        var row = h('label', { class: 'librow' + (cb.checked ? ' is-sel' : '') }, cb,
          h('div', { class: 'libthumb' }, mediaThumb(it.url)),
          h('div', { class: 'libinfo' }, h('div', { class: 'libname' }, it.name),
            h('div', { class: 'hint' }, fmtSize(it.size) + (it.uploadedAt ? '  \u00b7  ' + new Date(it.uploadedAt).toLocaleDateString() : ''))),
          h('span', { class: 'libbadge' + (used ? ' is-used' : '') }, used ? 'In use' : 'Not used'));
        listEl.appendChild(row);
      });
    }
    function load() {
      return api('GET', '/api/upload').then(function (j) {
        items = (j.items || []).filter(function (it) { return it.pathname && it.pathname.indexOf('uploads/_check/') === -1; });
        draw();
      }).catch(function (e) { summary.textContent = ''; fail(e); });
    }
    function remove() {
      var sel = chosen();
      if (!sel.length) return;
      var used = sel.filter(isUsed).length;
      var total = sel.reduce(function (n, it) { return n + (it.size || 0); }, 0);
      var msg = 'Delete ' + sel.length + ' file' + (sel.length > 1 ? 's' : '') + ' (' + fmtSize(total) + ')? This cannot be undone.';
      if (used) msg += '\n\n' + used + ' of them ' + (used > 1 ? 'are' : 'is') + ' still used on your website. Those images or videos will stop showing.';
      if (!confirm(msg)) return;
      api('POST', '/api/upload?action=delete', { paths: sel.map(function (it) { return it.pathname; }) }).then(function (j) {
        toast('Deleted ' + j.deleted + ' file' + (j.deleted > 1 ? 's' : '') + '.', 'ok');
        selected = {};
        return load();
      }).catch(fail);
    }
    load();
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

    // storage check: keys, bucket, browser upload (CORS) and the public link
    var out = h('div', {});
    var chk = h('button', { class: 'btn btn--primary', type: 'button' }, 'Check storage and uploads');
    function line(t, ok) { out.appendChild(h('p', { class: ok ? 'okmsg' : 'err' }, (ok ? '\u2713 ' : '\u2717 ') + t)); }
    function pngBlob() {
      var b = atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='), a = new Uint8Array(b.length);
      for (var i = 0; i < b.length; i++) a[i] = b.charCodeAt(i);
      return new Blob([a], { type: 'image/png' });
    }
    function imgLoads(u) { return new Promise(function (res) { var im = new Image(); im.onload = function () { res(true); }; im.onerror = function () { res(false); }; im.src = u + '?t=' + Date.now(); }); }
    chk.addEventListener('click', function () {
      out.innerHTML = ''; chk.disabled = true;
      api('POST', '/api/upload?action=check', {}).then(function (j) {
        if (!j.direct) { line(j.message, false); return; }
        if (!j.storageOk) { line(j.error, false); return; }
        line('R2 keys and bucket are correct.', true);
        return putDirect(j.uploadUrl, pngBlob(), 'image/png').then(function () {
          line('Uploading from the browser works (CORS is correct). Images up to 100 MB and videos up to 1 GB can be uploaded.', true);
          return imgLoads(j.url).then(function (ok) {
            if (ok) line('The public link works, so visitors will see your uploads.', true);
            else line('The test file uploaded, but its public link does not open. In Cloudflare: bucket Settings > Public Development URL > Enable, and check that R2_PUBLIC_URL is exactly that link.', false);
          });
        }, function (e) { line(e.message, false); });
      }).catch(function (e) { line(e.message, false); if (e.status === 401) fail(e); }).then(function () { chk.disabled = false; });
    });
    view.appendChild(h('div', { class: 'card' }, h('div', { class: 'card__body' }, h('h2', {}, 'Storage check'),
      h('p', { class: 'hint' }, 'Tests your Cloudflare R2 setup end to end. Run it once after changing storage settings.'), h('div', {}, chk), out)));
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
