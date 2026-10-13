// Builds every page from the site content (saved by the admin panel, or the default in content-default.js).
(function () {
  'use strict';

  // ---------- helpers ----------
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function href(u) {
    u = String(u == null ? '' : u).trim();
    return /^(javascript|data|vbscript):/i.test(u) ? '#' : u;
  }
  function src(u) {
    u = String(u == null ? '' : u).trim();
    return /^(javascript|vbscript):/i.test(u) || (/^data:/i.test(u) && !/^data:image\//i.test(u)) ? '' : u;
  }
  function isExternal(u) {
    return /^https?:\/\//i.test(u || '') && u.indexOf(location.origin) !== 0;
  }
  function ext(u) { return isExternal(u) ? ' target="_blank" rel="noopener noreferrer"' : ''; }
  function arr(a) { return Array.isArray(a) ? a : []; }
  function paras(text) {
    return String(text || '').split(/\n{2,}/).map(function (p) { return p.trim(); }).filter(Boolean)
      .map(function (p) { return '<p>' + esc(p).replace(/\n/g, '<br>') + '</p>'; }).join('');
  }
  function btns(list) {
    var h = arr(list).filter(function (b) { return b && b.label; }).map(function (b) {
      return '<a class="btn btn--' + (b.style === 'ghost' ? 'ghost' : 'primary') + '" href="' + esc(href(b.href)) + '"' + ext(b.href) + '>' + esc(b.label) + '</a>';
    }).join('');
    return h ? '<div class="hero__actions">' + h + '</div>' : '';
  }
  function head(eyebrow, title, intro, titleId) {
    if (!eyebrow && !title && !intro) return '';
    return '<div class="section-head">' + (eyebrow ? '<p class="eyebrow">' + esc(eyebrow) + '</p>' : '') +
      (title ? '<h2 id="' + titleId + '">' + esc(title) + '</h2>' : '') + (intro ? '<p>' + esc(intro) + '</p>' : '') + '</div>';
  }
  function tags(list, label) {
    list = arr(list).filter(Boolean);
    return list.length ? '<ul class="tags" aria-label="' + esc(label) + '">' + list.map(function (t) { return '<li>' + esc(t) + '</li>'; }).join('') + '</ul>' : '';
  }

  // ---------- sections ----------
  var R = {};

  R.hero = function (s, tid) {
    var eyebrow = s.eyebrow ? '<p class="eyebrow">' + esc(s.eyebrow) + '</p>' : '';
    var intro = s.intro ? '<p class="hero__intro">' + esc(s.intro) + '</p>' : '';
    var caption = (s.captionName || s.captionRole) ? '<figcaption>' + (s.captionName ? '<strong>' + esc(s.captionName) + '</strong>' : '') + (s.captionRole ? '<span>' + esc(s.captionRole) + '</span>' : '') + '</figcaption>' : '';
    var imgTag = s.image ? '<img src="' + esc(src(s.image)) + '" alt="' + esc(s.imageAlt) + '" width="1000" height="1000" fetchpriority="high" /><span class="portrait__light" aria-hidden="true"></span>' : '';
    if (s.layout === 'home') {
      var fig = s.image ? '<figure class="portrait"><div class="portrait__frame">' + imgTag + '</div>' + caption + '</figure>' : '';
      return '<section class="hero" aria-labelledby="' + tid + '"><div class="container' + (s.image ? ' hero__grid' : '') + '"><div class="hero__copy">' + eyebrow +
        '<h1 id="' + tid + '">' + esc(s.title) + '</h1>' + intro + btns(s.buttons) + '</div>' + fig + '</div></section>';
    }
    var orbs = '<span class="pf-orb pf-orb--a" aria-hidden="true"></span><span class="pf-orb pf-orb--b" aria-hidden="true"></span>';
    var line = '<span class="pf-hero-line" aria-hidden="true"></span>';
    var h1 = '<h1 id="' + tid + '" data-split>' + esc(s.title) + '</h1>';
    if (s.image) {
      var chips = arr(s.chips).filter(Boolean).slice(0, 3).map(function (c, i) {
        return '<span class="chip-float chip-float--' + 'abc'[i] + '" aria-hidden="true">' + esc(c) + '</span>';
      }).join('');
      return '<section class="hero page-hero about-hero" aria-labelledby="' + tid + '">' + orbs + '<div class="container hero__grid">' +
        '<figure class="portrait about-portrait"><div class="about-portrait__frame">' + imgTag + '</div>' + chips + caption + '</figure>' +
        '<div class="hero__copy">' + eyebrow + h1 + line + intro + btns(s.buttons) + '</div></div></section>';
    }
    return '<section class="hero page-hero" aria-labelledby="' + tid + '">' + orbs + '<div class="container">' + eyebrow + h1 + line + intro + btns(s.buttons) + '</div></section>';
  };

  R.story = function (s, tid) {
    var ms = arr(s.milestones).filter(function (m) { return m && (m.label || m.text); });
    return '<section class="section" aria-labelledby="' + tid + '"><div class="container story">' + head(s.eyebrow, s.title, '', tid) +
      '<div class="story__body">' + (s.lead ? '<p class="story__lead">' + esc(s.lead) + '</p>' : '') + paras(s.body) + '</div>' +
      (ms.length ? '<ol class="milestones" aria-label="Milestones">' + ms.map(function (m) { return '<li><span>' + esc(m.label) + '</span>' + esc(m.text) + '</li>'; }).join('') + '</ol>' : '') +
      '</div></section>';
  };

  R.timeline = function (s, tid) {
    var link = s.linkLabel ? '<a class="text-link" href="' + esc(href(s.linkHref)) + '"' + ext(s.linkHref) + '>' + esc(s.linkLabel) + '</a>' : '';
    var items = arr(s.items).map(function (it) {
      return '<li class="timeline__item">' + (it.period ? '<p class="timeline__period">' + esc(it.period) + '</p>' : '') +
        (it.title ? '<h3>' + esc(it.title) + '</h3>' : '') + (it.role ? '<p class="timeline__role">' + esc(it.role) + '</p>' : '') +
        (it.summary ? '<p class="timeline__summary">' + esc(it.summary) + '</p>' : '') + tags(it.tags, 'Responsibilities') + '</li>';
    }).join('');
    return '<section class="section section--glow" aria-labelledby="' + tid + '"><div class="container experience"><div class="experience__side">' +
      head(s.eyebrow, s.title, s.intro, tid) + link + '</div><ol class="timeline">' + items + '</ol></div></section>';
  };

  R.workgrid = function (s, tid) {
    var size = { wide: 'span-wide', narrow: 'span-narrow', third: 'span-third' };
    var cards = arr(s.cards).map(function (c) {
      return '<article class="project ' + (size[c.size] || 'span-third') + '">' +
        (c.image ? '<img src="' + esc(src(c.image)) + '" alt="' + esc(c.alt) + '" loading="lazy" width="1200" height="800" />' : '') +
        '<div class="project__body"><h3>' + (c.href ? '<a class="project__link" href="' + esc(href(c.href)) + '"' + ext(c.href) + '>' + esc(c.title) + '</a>' : esc(c.title)) + '</h3>' +
        (c.text ? '<p>' + esc(c.text) + '</p>' : '') + '</div>' + (c.badge ? '<span class="project__badge">Placeholder</span>' : '') + '</article>';
    }).join('');
    var action = s.actionLabel ? '<div class="section-action"><a class="btn btn--primary" href="' + esc(href(s.actionHref)) + '"' + ext(s.actionHref) + '>' + esc(s.actionLabel) + '</a></div>' : '';
    return '<section class="section" aria-labelledby="' + tid + '"><div class="container">' + head(s.eyebrow, s.title, s.intro, tid) +
      '<div class="work-grid">' + cards + '</div>' + action + '</div></section>';
  };

  R.cards = function (s, tid) {
    function card(c) {
      var primary = c.style === 'primary';
      var bullets = arr(c.bullets).filter(function (b) { return b && b.title; });
      return '<div class="service service--' + (primary ? 'primary' : 'secondary') + '">' + (c.title ? '<h3>' + esc(c.title) + '</h3>' : '') +
        (c.text ? '<p>' + esc(c.text) + '</p>' : '') +
        (bullets.length ? '<ul class="service__items">' + bullets.map(function (b) { return '<li><strong>' + esc(b.title) + '</strong>' + (b.text ? '<span>' + esc(b.text) + '</span>' : '') + '</li>'; }).join('') + '</ul>' : '') +
        tags(c.tags, c.title || 'Tags') + '</div>';
    }
    var list = arr(s.cards), out = '', i = 0;
    while (i < list.length) {
      if (list[i].style === 'primary') { out += card(list[i]); i++; continue; }
      var run = [];
      while (i < list.length && list[i].style !== 'primary') { run.push(list[i]); i++; }
      out += run.length > 1 ? '<div class="skills-side">' + run.map(card).join('') + '</div>' : card(run[0]);
    }
    return '<section class="section" aria-labelledby="' + tid + '"><div class="container">' + head(s.eyebrow, s.title, s.intro, tid) + '<div class="services">' + out + '</div></div></section>';
  };

  R.steps = function (s, tid) {
    var items = arr(s.items).map(function (it, i) {
      return '<li class="approach__item"><span class="approach__num" aria-hidden="true">' + (i < 9 ? '0' : '') + (i + 1) + '</span><h3>' + esc(it.title) + '</h3><p>' + esc(it.text) + '</p></li>';
    }).join('');
    return '<section class="section" aria-labelledby="' + tid + '"><div class="container">' + head(s.eyebrow, s.title, s.intro, tid) + '<ol class="approach">' + items + '</ol></div></section>';
  };

  R.cta = function (s, tid) {
    return '<section class="cta" aria-labelledby="' + tid + '"><div class="container cta__inner"><h2 id="' + tid + '">' + esc(s.title) + '</h2>' +
      (s.text ? '<p>' + esc(s.text) + '</p>' : '') +
      (s.buttonLabel ? '<a class="btn btn--primary" href="' + esc(href(s.buttonHref)) + '"' + ext(s.buttonHref) + '>' + esc(s.buttonLabel) + '</a>' : '') + '</div></section>';
  };

  R.gallery = function () {
    var arrow = function (d) { return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="' + d + '"/></svg>'; };
    return '<section class="section gallery" aria-labelledby="gallery-title"><h2 id="gallery-title" class="visually-hidden">Project gallery</h2>' +
      '<div class="pf-bar"><div class="container pf-bar__inner"><div class="filters" id="filters" role="group" aria-label="Filter projects by category"></div></div></div>' +
      '<div class="container"><p class="gallery-count" id="gallery-count" aria-live="polite"></p><div class="pf-gallery" id="gallery"></div></div></section>' +
      '<dialog class="lightbox" id="lightbox" aria-labelledby="lightbox-title"><div class="lb__stage" id="lb-stage" role="group" aria-roledescription="carousel" aria-label="Project images">' +
      '<img class="lb__bg" id="lb-bg" src="" alt="" aria-hidden="true" /><div class="lb__track" id="lb-track"></div><span class="lb__counter" id="lb-img-count" aria-live="polite"></span>' +
      '<button type="button" class="lb__arrow lb__arrow--prev" id="lb-prev-img" aria-label="Previous slide">' + arrow('M15 5l-7 7 7 7') + '</button>' +
      '<button type="button" class="lb__arrow lb__arrow--next" id="lb-next-img" aria-label="Next slide">' + arrow('M9 5l7 7-7 7') + '</button>' +
      '<div class="lb__dots" id="lb-dots"></div><button type="button" class="btn btn--ghost lightbox__close" id="lightbox-close">Close</button></div>' +
      '<div class="lightbox__bar"><div><p class="lightbox__cat" id="lightbox-cat"></p><h2 id="lightbox-title"></h2><span class="project__badge lightbox__badge" id="lightbox-badge">Placeholder</span></div>' +
      '<div class="lightbox__nav"><span id="lightbox-count" class="lightbox__count"></span><button type="button" class="btn btn--ghost" id="lightbox-prev" aria-label="Previous project">Previous project</button>' +
      '<button type="button" class="btn btn--ghost" id="lightbox-next" aria-label="Next project">Next project</button></div></div></dialog>';
  };

  R.contactform = function (s, tid) {
    var opts = arr(s.projectTypes).map(function (o) { return '<option>' + esc(o) + '</option>'; }).join('');
    var field = function (id, label, input, extra) {
      return '<div class="field"><label for="' + id + '">' + label + ' <span aria-hidden="true">*</span></label>' + input + '<p class="field__error" id="' + id + '-err" aria-live="polite"></p></div>';
    };
    var form = '<form class="form" id="contact-form-el" novalidate><div class="form__row">' +
      field('name', 'Full Name', '<input id="name" name="name" type="text" autocomplete="name" required aria-describedby="name-err" />') +
      field('email', 'Email Address', '<input id="email" name="email" type="email" autocomplete="email" inputmode="email" required aria-describedby="email-err" />') +
      '</div><div class="form__row">' +
      field('subject', 'Subject', '<input id="subject" name="subject" type="text" required aria-describedby="subject-err" />') +
      field('project-type', 'Project Type', '<select id="project-type" name="project_type" required aria-describedby="project-type-err"><option value="" selected disabled>Select a project type</option>' + opts + '</select>') +
      '</div>' + field('message', 'Message', '<textarea id="message" name="message" rows="7" required aria-describedby="message-err"></textarea>') +
      '<div class="field field--trap" aria-hidden="true"><label for="company">Leave this field empty</label><input id="company" name="company" type="text" tabindex="-1" autocomplete="off" /></div>' +
      '<div class="form__actions"><button type="submit" class="btn btn--primary" id="send-btn">' + esc(s.submitLabel || 'Send Message') + '</button><p class="form__note">Fields marked * are required.</p></div>' +
      '<p class="form__status" id="form-status" role="status" aria-live="polite" tabindex="-1"></p></form>';
    var li = '<svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor" aria-hidden="true" focusable="false"><path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.064 2.064 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/></svg>';
    var aside = arr(s.aside).map(function (c) {
      var body = '';
      if (c.kind === 'linkedin') body = '<a class="social-icon" href="' + esc(href(c.href)) + '" target="_blank" rel="noopener noreferrer" aria-label="Visit my LinkedIn profile (opens in a new tab)">' + li + '</a>';
      else if (c.kind === 'links') body = '<ul class="guide">' + arr(c.items).map(function (t) { return '<li>' + esc(t) + '</li>'; }).join('') + '</ul>';
      else body = '<ul class="guide">' + arr(c.items).map(function (t) { return '<li>' + esc(t) + '</li>'; }).join('') + '</ul>';
      return '<div class="aside-card"><h3>' + esc(c.title) + '</h3>' + body + '</div>';
    }).join('');
    return '<section class="section contact" aria-labelledby="' + tid + '"><div class="container contact__grid"><div class="contact__main"><h2 id="' + tid + '" class="visually-hidden">Contact form</h2>' + form +
      '</div><aside class="contact__aside" aria-label="Contact details and project guidance">' + aside + '</aside></div></section>';
  };

  R.html = function (s) { return String(s.code || ''); };

  // ---------- header / footer ----------
  function pageKey() {
    var file = location.pathname.split('/').pop() || 'index.html';
    var p = /[?&]p=([^&#]+)/.exec(location.search);
    return file === 'page.html' && p ? 'page.html?p=' + decodeURIComponent(p[1]) : file;
  }
  function renderHeader(site) {
    var here = pageKey();
    var links = arr(site.nav).map(function (n) {
      var h = String(n.href || '').split('#')[0];
      var active = h === here || (h === '' && false);
      return '<li><a href="' + esc(href(n.href)) + '"' + ext(n.href) + (active ? ' class="active" aria-current="page"' : '') + '>' + esc(n.label) + '</a></li>';
    }).join('');
    var cta = site.navCta && site.navCta.label ? '<a class="btn btn--primary" href="' + esc(href(site.navCta.href)) + '">' + esc(site.navCta.label) + '</a>' : '';
    return '<div class="container nav__inner"><a href="index.html" class="nav__logo" aria-label="' + esc(site.name) + ', home">' + esc(site.logoText || site.name) + '</a>' +
      '<nav id="primary-nav" class="nav__links" aria-label="Primary"><ul>' + links + '</ul>' + (cta ? '<div class="nav__cta-mobile">' + cta + '</div>' : '') + '</nav>' +
      (cta ? '<div class="nav__cta">' + cta + '</div>' : '') +
      '<button type="button" class="nav__toggle" aria-expanded="false" aria-controls="primary-nav" aria-label="Open menu"><span aria-hidden="true"></span><span aria-hidden="true"></span></button></div>';
  }
  function renderFooter(site) {
    var nav = arr(site.nav).map(function (n) { return '<li><a href="' + esc(href(n.href)) + '"' + ext(n.href) + '>' + esc(n.label) + '</a></li>'; }).join('');
    var contacts = arr(site.footerContacts).map(function (c) {
      return '<li><span>' + esc(c.label) + '</span><a href="' + esc(href(c.href)) + '"' + ext(c.href) + '>' + esc(c.text) + '</a></li>';
    }).join('');
    var soc = arr(site.socials).filter(function (s) { return s && s.label; });
    return '<div class="container footer__grid"><div><p class="footer__name">' + esc(site.name) + '</p><p class="footer__role">' + esc(site.role) + '</p></div>' +
      '<nav aria-label="Footer"><ul class="footer__list">' + nav + '</ul></nav>' +
      (contacts ? '<div class="footer__contact"><p class="footer__heading">Contact</p><ul>' + contacts + '</ul></div>' : '') +
      (soc.length ? '<ul class="footer__list" aria-label="Social links">' + soc.map(function (s) { return '<li><a href="' + esc(href(s.href)) + '" target="_blank" rel="noopener noreferrer">' + esc(s.label) + '</a></li>'; }).join('') + '</ul>' : '') +
      '</div><div class="container footer__legal"><p>&copy; <span id="year">' + new Date().getFullYear() + '</span> ' + esc(site.legal) + '</p></div>';
  }

  // ---------- page ----------
  function currentSlug() {
    var b = document.body.getAttribute('data-page');
    if (b !== 'custom') return b;
    var m = /[?&]p=([^&#]+)/.exec(location.search);
    return m ? decodeURIComponent(m[1]) : '';
  }

  function render(content, isPreview) {
    var site = content.site || {};
    var slug = currentSlug();
    var page = content.pages && content.pages[slug];
    document.getElementById('site-header').innerHTML = renderHeader(site);
    document.getElementById('site-footer').innerHTML = renderFooter(site);

    var main = document.getElementById('main');
    var hasGallery = false, hasForm = null;
    if (!page) {
      document.title = 'Page not found | ' + (site.name || '');
      main.innerHTML = '<section class="hero page-hero"><div class="container"><h1>Page not found</h1><p class="hero__intro">This page does not exist.</p><div class="hero__actions"><a class="btn btn--primary" href="index.html">Back to home</a></div></div></section>';
    } else {
      document.title = page.title || site.name || document.title;
      var md = document.querySelector('meta[name="description"]');
      if (md && page.description) md.setAttribute('content', page.description);
      var out = '';
      arr(page.sections).forEach(function (s) {
        if (!s || s.hidden || !R[s.type]) return;
        var tid = 's-' + String(s.id || Math.random().toString(36).slice(2, 8)).replace(/[^a-z0-9_-]/gi, '') + '-title';
        var html;
        try { html = R[s.type](s, tid); } catch (e) { console.error('Section failed to render', s, e); return; }
        if (s.type === 'gallery') hasGallery = true;
        if (s.type === 'contactform') hasForm = s;
        if (s.anchor && s.type !== 'html') {
          // put the link target on the section wrapper
          html = html.replace(/^<(section|div)/, '<$1 id="' + esc(String(s.anchor).replace(/[^a-z0-9_-]/gi, '')) + '"');
        }
        out += '\n' + html;
      });
      main.innerHTML = out;
    }

    if (window.SiteUI) window.SiteUI.init();
    if (hasGallery && window.PortfolioPage) window.PortfolioPage.init(content.portfolio || { categories: [], projects: [] });
    if (hasForm && window.ContactForm) window.ContactForm.init(hasForm.endpoint || '');

    if (isPreview) {
      var bar = document.createElement('div');
      bar.setAttribute('style', 'position:fixed;left:50%;bottom:16px;transform:translateX(-50%);z-index:9999;background:#3b82ff;color:#fff;padding:.55rem 1rem;border-radius:999px;font:600 13px system-ui,sans-serif;box-shadow:0 8px 30px rgba(0,0,0,.5)');
      bar.textContent = 'Preview: these changes are not saved yet';
      document.body.appendChild(bar);
    }
    if (location.hash && location.hash.length > 1) {
      var t = null;
      try { t = document.getElementById(decodeURIComponent(location.hash.slice(1))); } catch (e) {}
      if (t) t.scrollIntoView();
    }
  }

  function valid(c) { return c && typeof c === 'object' && c.site && c.pages; }

  function load() {
    if (/[?&]preview=1/.test(location.search)) {
      try {
        var d = JSON.parse(localStorage.getItem('siteDraft') || 'null');
        if (valid(d)) return Promise.resolve({ content: d, preview: true });
      } catch (e) {}
    }
    if (location.protocol === 'file:' || typeof fetch !== 'function') return Promise.resolve({});
    var timer = new Promise(function (res) { setTimeout(function () { res({}); }, 4000); });
    var req = fetch('/api/content', { credentials: 'same-origin' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) { return j && valid(j.content) ? { content: j.content } : {}; })
      .catch(function () { return {}; });
    return Promise.race([req, timer]);
  }

  load().then(function (r) {
    render(r.content || window.SITE_DEFAULT, !!r.preview);
  });
})();
