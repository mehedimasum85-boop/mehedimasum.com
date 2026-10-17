// Portfolio page: category filter, project cards and the preview slider.
// Data comes from the site content (edit it in the admin panel). Each project has slides,
// and every slide shows 1 to 3 images side by side. No libraries.
window.PortfolioPage = (function () {
  'use strict';

  function init(data) {
  var cats = (data && data.categories) || [];
  var gallery = document.getElementById('gallery');
  var filterBox = document.getElementById('filters');
  var countEl = document.getElementById('gallery-count');
  var dialog = document.getElementById('lightbox');
  if (!gallery || !filterBox || !dialog) return;

  var PER_SLIDE = 3;
  // A YouTube link in a slide plays inside the preview popup (YouTube's own adaptive player, so it stays smooth on slow internet).
  function ytId(u) {
    var m = /^(?:https?:\/\/)?(?:www\.|m\.)?(?:youtu\.be\/|youtube(?:-nocookie)?\.com\/(?:watch\?(?:[^#\s]*&)?v=|embed\/|shorts\/|live\/|v\/))([A-Za-z0-9_-]{11})(?![A-Za-z0-9_-])/.exec(String(u || '').trim());
    return m ? m[1] : '';
  }
  function isVideo(u) { return !!ytId(u) || /\.(mp4|webm|mov|m4v)(\?|#|$)/i.test(String(u || '')); }
  function makeYT(id, p) {
    var box = el('div', 'lb__yt');
    function poster() {
      box.innerHTML = '';
      box.classList.remove('is-playing');
      var btn = el('button', 'lb__ytplay');
      btn.type = 'button';
      btn.setAttribute('aria-label', 'Play video: ' + (p.title || ''));
      var im = el('img');
      im.alt = '';
      var sizes = ['maxresdefault', 'sddefault', 'hqdefault'], k = 0;
      function next() { if (k < sizes.length) im.src = 'https://i.ytimg.com/vi/' + id + '/' + sizes[k++] + '.jpg'; }
      im.addEventListener('error', next);
      im.addEventListener('load', function () { if (im.naturalWidth < 200 && k < sizes.length) next(); }); // YouTube answers with a tiny grey picture when the HD one does not exist
      next();
      btn.appendChild(im);
      btn.appendChild(el('span', 'lb__ytplay__icon'));
      btn.addEventListener('click', play);
      box.appendChild(btn);
    }
    function play() {
      box.innerHTML = '';
      box.classList.add('is-playing');
      var f = document.createElement('iframe');
      f.src = 'https://www.youtube-nocookie.com/embed/' + id + '?autoplay=1&rel=0&playsinline=1';
      f.allow = 'autoplay; encrypted-media; picture-in-picture; fullscreen';
      f.allowFullscreen = true;
      f.title = p.title || 'Video';
      box.appendChild(f);
    }
    box._reset = poster;
    poster();
    return box;
  }
  function stopMedia() { // pause uploaded videos and put YouTube players back to their picture (this stops the sound)
    Array.prototype.forEach.call(track.querySelectorAll('video'), function (v) { v.pause(); });
    Array.prototype.forEach.call(track.querySelectorAll('.lb__yt.is-playing'), function (b) { if (b._reset) b._reset(); });
  }
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ---------- soft background colours taken from the images ----------
  // The preview background is a calm gradient built from the colours of the images on screen.
  // It is made darker/lighter than the images on purpose, so the images always stand out from it.
  // If the browser cannot read the pixels (the image host does not allow it), a neutral default is used.
  var DEFAULT_BG = ['#11264a', '#0c1b38', '#0a1630'];
  // Colours chosen by hand in the admin (3 hex colours). Anything else means "pick automatically from the image".
  function cleanBg(b) {
    if (!Array.isArray(b) || b.length !== 3) return null;
    for (var i = 0; i < 3; i++) if (!/^#[0-9a-f]{6}$/i.test(String(b[i]))) return null;
    return b.slice();
  }
  function rgbToHsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    var mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, h = 0, s = 0, d = mx - mn;
    if (d) {
      s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
      h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
      h *= 60;
    }
    return [h, s, l];
  }
  function hsl(h, s, l) { return 'hsl(' + Math.round((h % 360 + 360) % 360) + ', ' + Math.round(s * 100) + '%, ' + Math.round(l * 100) + '%)'; }
  function paletteOf(imgs) {
    var S = 40, c = document.createElement('canvas');
    c.width = S; c.height = S;
    var ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.imageSmoothingQuality = 'high';
    var buckets = [], i, n = 0, lum = 0;
    for (i = 0; i < 12; i++) buckets.push({ w: 0, r: 0, g: 0, b: 0 });
    imgs.forEach(function (im) {
      ctx.clearRect(0, 0, S, S);
      ctx.drawImage(im, 0, 0, S, S);
      var d = ctx.getImageData(0, 0, S, S).data; // throws if the image host does not allow reading
      for (var k = 0; k < d.length; k += 4) {
        if (d[k + 3] < 200) continue;
        var q = rgbToHsl(d[k], d[k + 1], d[k + 2]);
        n++; lum += q[2];
        var w = q[1] * (1 - Math.abs(q[2] - 0.5) * 1.6); // colourful, mid-tone pixels count most
        if (q[1] > 0.15 && w > 0.02) {
          var b = buckets[Math.floor(q[0] / 30) % 12];
          b.w += w; b.r += d[k] * w; b.g += d[k + 1] * w; b.b += d[k + 2] * w;
        }
      }
    });
    if (!n) return null;
    var avgL = lum / n;
    var hues = buckets.filter(function (b) { return b.w > 0; }).sort(function (a, b) { return b.w - a.w; }).slice(0, 3)
      .map(function (b) { return rgbToHsl(b.r / b.w, b.g / b.w, b.b / b.w); });
    // Bright/mid image -> deep background. Very dark image -> a softly lighter one. Either way the image stands out.
    var light = avgL < 0.30;
    var L = light ? Math.min(0.32, Math.max(0.26, avgL + 0.18)) : 0.16;
    var base = hues.length ? hues[0] : [215, 0.2, 0.5];
    function near(hh, d) { var x = Math.abs(((hh - base[0]) % 360 + 540) % 360 - 180); return x <= d; } // within d degrees of the main colour
    var h2 = hues[1] && near(hues[1][0], 45) ? hues[1][0] : base[0] + 22;
    var h3 = hues[2] && near(hues[2][0], 45) ? hues[2][0] : base[0] - 22;
    var sat = hues.length ? (light ? Math.min(0.32, Math.max(0.2, base[1] * 0.45)) : Math.min(0.5, Math.max(0.28, base[1] * 0.55))) : 0.16; // calm, never loud
    return [hsl(base[0], sat, L + 0.04), hsl(h2, sat, L), hsl(h3, sat, L - 0.04)];
  }
  function setStageColors(cols) {
    cols = cols || DEFAULT_BG;
    stage.style.setProperty('--g1', cols[0]);
    stage.style.setProperty('--g2', cols[1]);
    stage.style.setProperty('--g3', cols[2]);
  }

  // ---------- tidy the data ----------
  var projects = ((data && data.projects) || []).map(function (p) {
    var slides = [];
    if (Array.isArray(p.slides) && p.slides.length) {
      slides = p.slides.map(function (sl) { return (Array.isArray(sl) ? sl : [sl]).filter(Boolean).slice(0, PER_SLIDE); })
        .filter(function (sl) { return sl.length; });
    } else if (Array.isArray(p.images) && p.images.length) {
      slides = p.images.map(function (u) { return [u]; });
    }
    var all = [].concat.apply([], slides);
    var cover = p.cover || all.filter(function (u) { return !isVideo(u); })[0];
    if (!slides.length && cover) slides = [[cover]];
    return {
      title: p.title || 'Untitled',
      category: p.category,
      brand: p.brand || '',
      cover: cover,
      slides: slides,
      count: Math.max(1, all.length),
      alt: p.alt || p.title || '',
      placeholder: !!p.placeholder,
      bg: cleanBg(p.bg)
    };
  }).filter(function (p) { return p.cover; });

  var activeFilter = 'all';
  var flat = [];          // projects in the order they appear on screen (used by the preview)
  var io = null;          // scroll-reveal observer
  var token = 0;          // guards quick filter clicks

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text) n.textContent = text;
    return n;
  }
  function plural(n, word) { return n + ' ' + word + (n === 1 ? '' : 's'); }
  function pad(n) { return n < 10 ? '0' + n : String(n); }
  function countIn(catId) { return projects.filter(function (p) { return p.category === catId; }).length; }
  function catLabel(id) {
    for (var i = 0; i < cats.length; i++) if (cats[i].id === id) return cats[i].label;
    return id;
  }

  var shownCats = cats.filter(function (c) { return countIn(c.id) > 0; });

  // ---------- filters (with a sliding highlight) ----------
  // wrap the filter row so left/right arrow buttons can sit on top of it
  var wrap = el('div', 'filters-wrap');
  filterBox.parentNode.insertBefore(wrap, filterBox);
  var prevBtn = el('button', 'filters__arrow filters__arrow--prev');
  var nextBtn = el('button', 'filters__arrow filters__arrow--next');
  prevBtn.type = nextBtn.type = 'button';
  prevBtn.setAttribute('aria-label', 'Scroll categories left');
  nextBtn.setAttribute('aria-label', 'Scroll categories right');
  prevBtn.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  nextBtn.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M9 5l7 7-7 7" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  wrap.appendChild(prevBtn);
  wrap.appendChild(filterBox);
  wrap.appendChild(nextBtn);

  function updateArrows() {
    var max = filterBox.scrollWidth - filterBox.clientWidth;
    var scrollable = max > 2;
    var x = filterBox.scrollLeft;
    wrap.classList.toggle('has-prev', scrollable && x > 2);
    wrap.classList.toggle('has-next', scrollable && x < max - 2);
  }
  function nudge(dir) {
    filterBox.scrollBy({ left: dir * Math.max(160, filterBox.clientWidth * 0.6), behavior: reduce ? 'auto' : 'smooth' });
  }
  prevBtn.addEventListener('click', function () { nudge(-1); });
  nextBtn.addEventListener('click', function () { nudge(1); });
  filterBox.addEventListener('scroll', updateArrows, { passive: true });
  window.addEventListener('resize', updateArrows);

  var pill = el('span', 'filters__pill');
  pill.setAttribute('aria-hidden', 'true');
  filterBox.appendChild(pill);

  var defs = [{ id: 'all', label: 'All Projects', n: projects.length }].concat(
    shownCats.map(function (c) { return { id: c.id, label: c.label, n: countIn(c.id) }; })
  );

  var hash = (location.hash || '').replace('#', '');
  if (hash && shownCats.some(function (c) { return c.id === hash; })) activeFilter = hash;

  defs.forEach(function (d) {
    var b = el('button', 'filter-btn' + (d.id === 'video' ? ' filter-btn--secondary' : ''));
    b.type = 'button';
    b.setAttribute('data-filter', d.id);
    b.setAttribute('aria-pressed', d.id === activeFilter ? 'true' : 'false');
    b.appendChild(document.createTextNode(d.label));
    filterBox.appendChild(b);
  });

  function movePill(instant) {
    var b = filterBox.querySelector('.filter-btn[aria-pressed="true"]');
    if (!b) return;
    if (instant) pill.classList.add('no-anim');
    pill.style.width = b.offsetWidth + 'px';
    pill.style.height = b.offsetHeight + 'px';
    pill.style.transform = 'translate(' + b.offsetLeft + 'px,' + b.offsetTop + 'px)';
    if (instant) { void pill.offsetWidth; pill.classList.remove('no-anim'); }
    if (filterBox.scrollWidth > filterBox.clientWidth) {
      filterBox.scrollTo({ left: Math.max(0, b.offsetLeft - (filterBox.clientWidth - b.offsetWidth) / 2), behavior: reduce ? 'auto' : 'smooth' });
    }
  }
  window.addEventListener('resize', function () { movePill(true); });
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { movePill(true); updateArrows(); });
  updateArrows();

  filterBox.addEventListener('click', function (e) {
    var b = e.target.closest('.filter-btn');
    if (!b) return;
    setFilter(b.getAttribute('data-filter'));
  });

  function setFilter(id) {
    if (id === activeFilter) return;
    activeFilter = id;
    Array.prototype.forEach.call(filterBox.querySelectorAll('.filter-btn'), function (x) {
      x.setAttribute('aria-pressed', String(x.getAttribute('data-filter') === id));
    });
    movePill(false);
    try { history.replaceState(null, '', id === 'all' ? location.pathname + location.search : '#' + id); } catch (err) { /* file:// may block this */ }

    var mine = ++token;
    if (reduce) { render(); return; }
    gallery.classList.add('is-leaving');
    setTimeout(function () {
      if (mine !== token) return;
      render();
      var top = gallery.getBoundingClientRect().top + window.scrollY - 150;
      if (window.scrollY > top) window.scrollTo({ top: top, behavior: 'smooth' });
      gallery.classList.remove('is-leaving');
    }, 240);
  }

  // ---------- build the view: category -> projects ----------
  function buildView(filter) {
    var view = [];
    flat = [];
    shownCats.forEach(function (c, ci) {
      if (filter !== 'all' && c.id !== filter) return;
      var list = projects.filter(function (p) { return p.category === c.id; });
      list.forEach(function (p) { p._i = flat.length; flat.push(p); });
      view.push({ cat: c, num: ci + 1, items: list, total: list.length });
    });
    return view;
  }

  function buildCard(p) {
    var card = el('article', 'pf-card');
    var btn = el('button', 'pf-card__open');
    btn.type = 'button';
    btn.setAttribute('data-index', String(p._i));
    btn.setAttribute('aria-label', 'Open project: ' + p.title +
      (p.count > 1 ? ', ' + p.count + ' images' : ''));

    var media = el('span', 'pf-card__media');
    var img = el('img');
    img.crossOrigin = 'anonymous'; // lets the preview read this image's colours later (falls back below if the host refuses)
    img.src = p.cover; img.alt = p.alt; img.width = 4000; img.height = 3000;
    img.loading = 'lazy'; img.decoding = 'async';
    img.addEventListener('error', function () {
      if (img.crossOrigin) { img.removeAttribute('crossorigin'); img.src = p.cover; return; }
      card.classList.add('is-broken');
      console.warn('Portfolio: image not found: ' + p.cover);
    });
    media.appendChild(img);
    media.appendChild(el('span', 'pf-card__sheen'));
    media.appendChild(el('span', 'pf-card__view', 'View project'));
    if (p.count > 1) media.appendChild(el('span', 'pf-card__chip', p.count + ' images'));

    var body = el('span', 'pf-card__body');
    body.appendChild(el('span', 'pf-card__title', p.title));

    btn.appendChild(media);
    btn.appendChild(body);
    card.appendChild(btn);
    if (p.placeholder) card.appendChild(el('span', 'project__badge', 'Placeholder'));
    return card;
  }

  function render() {
    if (io) { io.disconnect(); io = null; }
    var view = buildView(activeFilter);
    var reveal = [];
    gallery.innerHTML = '';

    view.forEach(function (v) {
      var sec = el('section', 'pf-cat');
      sec.id = 'cat-' + v.cat.id;
      sec.setAttribute('aria-labelledby', 'cat-title-' + v.cat.id);

      var head = el('header', 'pf-cat__head');
      head.appendChild(el('span', 'pf-cat__num', pad(v.num)));
      var titles = el('div', 'pf-cat__titles');
      var h2 = el('h2', '', v.cat.label);
      h2.id = 'cat-title-' + v.cat.id;
      titles.appendChild(h2);
      head.appendChild(titles);
      sec.appendChild(head);
      reveal.push(head);

      var grid = el('div', 'pf-grid');
      v.items.forEach(function (p, i) {
        var card = buildCard(p);
        card.style.setProperty('--d', (i % 3) * 110 + 'ms');
        grid.appendChild(card);
        reveal.push(card);
      });
      sec.appendChild(grid);
      gallery.appendChild(sec);
    });

    if (!view.length) gallery.appendChild(el('p', 'gallery-empty', 'No projects yet.'));
    countEl.textContent = 'Showing ' + plural(flat.length, 'project');
    observe(reveal);
  }

  // ---------- scroll reveal ----------
  function observe(list) {
    if (reduce || !('IntersectionObserver' in window)) return;
    io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (!en.isIntersecting) return;
        var node = en.target;
        io.unobserve(node);
        node.classList.add('is-in');
        if (node.classList.contains('pf-card')) {
          // Clean up afterwards so the hover effects work normally.
          setTimeout(function () {
            node.classList.remove('pf-reveal', 'is-in');
            node.style.removeProperty('--d');
          }, 1500);
        }
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -4% 0px' });
    list.forEach(function (n) { n.classList.add('pf-reveal'); io.observe(n); });
  }

  // ---------- card hover glow follows the pointer ----------
  gallery.addEventListener('pointermove', function (e) {
    var c = e.target.closest && e.target.closest('.pf-card');
    if (!c) return;
    var r = c.getBoundingClientRect();
    c.style.setProperty('--mx', ((e.clientX - r.left) / r.width * 100) + '%');
    c.style.setProperty('--my', ((e.clientY - r.top) / r.height * 100) + '%');
  });

  // ---------- preview with slider (native <dialog>) ----------
  var stage = document.getElementById('lb-stage');
  var track = document.getElementById('lb-track');
  var dots = document.getElementById('lb-dots');
  var bg = document.getElementById('lb-bg');
  var btnPrevImg = document.getElementById('lb-prev-img');
  var btnNextImg = document.getElementById('lb-next-img');
  var lbImgCount = document.getElementById('lb-img-count');
  var lbTitle = document.getElementById('lightbox-title');
  var lbCat = document.getElementById('lightbox-cat');
  var lbBadge = document.getElementById('lightbox-badge');
  var lbCount = document.getElementById('lightbox-count');
  var projIndex = 0, slideIndex = 0, opener = null;
  // On phones every image gets its own slide (one at a time, in order). On bigger screens the slides stay as set in the admin (1 to 3 images each).
  var mobileMQ = window.matchMedia ? window.matchMedia('(max-width: 640px)') : { matches: false };
  var groups = [];
  function groupsOf(p) {
    if (!mobileMQ.matches) return p.slides;
    return [].concat.apply([], p.slides).map(function (u) { return [u]; });
  }
  function groupFor(gs, imageIdx) { // which slide holds the n-th image of the project
    var seen = 0;
    for (var g = 0; g < gs.length; g++) { seen += gs[g].length; if (imageIdx < seen) return g; }
    return Math.max(0, gs.length - 1);
  }
  function imageIndexOf(gs, slideIdx) { // number of images before this slide
    var n = 0;
    for (var g = 0; g < slideIdx && g < gs.length; g++) n += gs[g].length;
    return n;
  }

  function loadProject(i, startImage) {
    var p = flat[i];
    if (!p) return;
    projIndex = i;
    groups = groupsOf(p);
    track.innerHTML = '';
    dots.innerHTML = '';
    var n = groups.length;

    groups.forEach(function (imgs, k) {
      var s = el('div', 'lb__slide lb__slide--' + imgs.length);
      s.setAttribute('role', 'group');
      s.setAttribute('aria-roledescription', 'slide');
      s.setAttribute('aria-label', (k + 1) + ' of ' + n);
      imgs.forEach(function (u, j) {
        if (ytId(u)) { s.classList.add('lb__slide--yt'); s.appendChild(makeYT(ytId(u), p)); return; }
        if (isVideo(u)) {
          var vd = el('video');
          vd.src = u;
          vd.controls = true;
          vd.preload = 'metadata';
          vd.setAttribute('playsinline', '');
          if (p.cover && !isVideo(p.cover)) vd.poster = p.cover;
          vd.setAttribute('aria-label', p.alt || p.title);
          s.appendChild(vd);
          return;
        }
        var im = el('img');
        im.crossOrigin = 'anonymous';
        im.src = u;
        im.alt = p.alt + (n > 1 || imgs.length > 1 ? ' (slide ' + (k + 1) + ' of ' + n + (imgs.length > 1 ? ', image ' + (j + 1) : '') + ')' : '');
        im.draggable = false;
        im.addEventListener('load', function () { if (s === track.children[slideIndex]) updateStageColors(); });
        im.addEventListener('error', function () {
          if (im.crossOrigin) { im.removeAttribute('crossorigin'); im.src = u; return; } // host has no CORS: show the image anyway
          im.classList.add('is-broken');
          console.warn('Portfolio: image not found: ' + u);
        });
        s.appendChild(im);
      });
      track.appendChild(s);
      if (n > 1) {
        var d = el('button', 'lb__dot');
        d.type = 'button';
        d.setAttribute('aria-label', 'Show slide ' + (k + 1) + ' of ' + n);
        d.addEventListener('click', function () { goTo(k); });
        dots.appendChild(d);
      }
    });

    stage.classList.toggle('is-multi', n > 1);
    lbTitle.textContent = p.title;
    lbCat.textContent = catLabel(p.category);
    lbBadge.hidden = !p.placeholder;
    lbCount.textContent = 'Project ' + (i + 1) + ' / ' + flat.length;
    goTo(startImage ? groupFor(groups, startImage) : 0, true);
  }

  function goTo(k, instant) {
    var p = flat[projIndex];
    var n = groups.length;
    if (k < 0 || k >= n) return;
    slideIndex = k;
    if (instant) track.classList.add('no-anim');
    track.style.transform = 'translateX(' + (-k * 100) + '%)';
    if (instant) { void track.offsetWidth; track.classList.remove('no-anim'); }
    Array.prototype.forEach.call(track.children, function (s, j) { s.setAttribute('aria-hidden', String(j !== k)); });
    Array.prototype.forEach.call(dots.children, function (d, j) { d.classList.toggle('is-active', j === k); d.setAttribute('aria-current', String(j === k)); });
    btnPrevImg.disabled = k === 0;
    btnNextImg.disabled = k === n - 1;
    lbImgCount.textContent = (k + 1) + ' / ' + n;
    stopMedia();
    updateStageColors();
  }

  function updateStageColors() {
    var cur = flat[projIndex];
    if (cur && cur.bg) return setStageColors(cur.bg); // colours picked by hand in the admin
    var s = track.children[slideIndex];
    if (!s) return setStageColors(null);
    var loaded = Array.prototype.filter.call(s.querySelectorAll('img'), function (im) { return im.complete && im.naturalWidth > 0 && !im.closest('.lb__yt'); });
    if (!loaded.length) return setStageColors(null);
    var key = loaded.length;
    if (s._palKey !== key) {
      s._palKey = key;
      try { s._pal = paletteOf(loaded); } catch (e) { s._pal = null; } // blocked by the image host: use the default
    }
    setStageColors(s._pal);
  }

  // Turning the phone (or resizing the window) switches between 1-per-slide and the admin layout. Keep the same image on screen.
  function onLayoutChange() {
    if (!dialog.hasAttribute('open') || !flat[projIndex]) return;
    var imageIdx = imageIndexOf(groups, slideIndex);
    loadProject(projIndex, imageIdx);
  }
  if (mobileMQ.addEventListener) mobileMQ.addEventListener('change', onLayoutChange);
  else if (mobileMQ.addListener) mobileMQ.addListener(onLayoutChange);

  function changeProject(delta) {
    if (!flat.length) return;
    loadProject((projIndex + delta + flat.length) % flat.length);
    stage.classList.remove('is-swap');
    void stage.offsetWidth;
    stage.classList.add('is-swap');
  }

  gallery.addEventListener('click', function (e) {
    var b = e.target.closest('.pf-card__open');
    if (!b) return;
    opener = b;
    loadProject(parseInt(b.getAttribute('data-index'), 10));
    if (typeof dialog.showModal === 'function') dialog.showModal(); else dialog.setAttribute('open', '');
    document.body.style.overflow = 'hidden';
  });

  function closeDialog() {
    if (typeof dialog.close === 'function') { dialog.close(); return; }
    dialog.removeAttribute('open');
    dialog.dispatchEvent(new Event('close'));
  }
  dialog.addEventListener('close', function () {
    stopMedia();
    document.body.style.overflow = '';
    if (opener && document.body.contains(opener)) opener.focus();
  });
  dialog.addEventListener('click', function (e) { if (e.target === dialog) closeDialog(); });
  document.getElementById('lightbox-close').addEventListener('click', closeDialog);
  btnPrevImg.addEventListener('click', function () { goTo(slideIndex - 1); });
  btnNextImg.addEventListener('click', function () { goTo(slideIndex + 1); });
  document.getElementById('lightbox-prev').addEventListener('click', function () { changeProject(-1); });
  document.getElementById('lightbox-next').addEventListener('click', function () { changeProject(1); });

  // Arrow keys move through the images. If the project has only one image, they move between projects.
  dialog.addEventListener('keydown', function (e) {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    if (e.target && e.target.tagName === 'VIDEO') return; // arrows seek inside the video
    var dir = e.key === 'ArrowLeft' ? -1 : 1;
    if (groups.length > 1) goTo(slideIndex + dir); else changeProject(dir);
  });

  // Swipe on touch screens.
  var startX = null;
  stage.addEventListener('pointerdown', function (e) { if (!e.target.closest('button, video')) startX = e.clientX; });
  stage.addEventListener('pointerup', function (e) {
    if (startX === null) return;
    var dx = e.clientX - startX;
    startX = null;
    if (Math.abs(dx) > 45) goTo(slideIndex + (dx < 0 ? 1 : -1));
  });
  stage.addEventListener('pointercancel', function () { startX = null; });

  // ---------- start ----------
  render();
  movePill(true);
  }
  return { init: init };
})();
