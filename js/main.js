// Mobile menu, header shadow on scroll, scroll-reveal animations, footer year.
// Called by site.js after the page has been built.
window.SiteUI = (function () {
  var bound = false;
  var navState = { links: null, toggle: null };

  function init() {
  var toggle = document.querySelector('.nav__toggle');
  var links = document.getElementById('primary-nav');
  navState.links = links; navState.toggle = toggle;
  function setOpen(open) {
    links.classList.toggle('is-open', open);
    toggle.setAttribute('aria-expanded', String(open));
    toggle.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
  }
  toggle.addEventListener('click', function () {
    setOpen(!links.classList.contains('is-open'));
  });
  if (!bound) {
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && navState.links && navState.toggle) {
        navState.links.classList.remove('is-open');
        navState.toggle.setAttribute('aria-expanded', 'false');
        navState.toggle.setAttribute('aria-label', 'Open menu');
      }
    });
  }

  var year = document.getElementById('year');
  if (year) year.textContent = new Date().getFullYear();

  // Letter-by-letter heading (same effect as the Portfolio page) for h1[data-split].
  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var sh = document.querySelector('h1[data-split]');
  if (sh && !reduceMotion) {
    var txt = sh.textContent, n = 0;
    sh.setAttribute('aria-label', txt);
    sh.textContent = '';
    txt.split(' ').forEach(function (word, wi, arr) {
      var w = document.createElement('span');
      w.className = 'pf-word';
      w.setAttribute('aria-hidden', 'true');
      word.split('').forEach(function (ch) {
        var s = document.createElement('span');
        s.className = 'pf-letter'; s.textContent = ch; s.style.setProperty('--k', n++);
        w.appendChild(s);
      });
      sh.appendChild(w);
      if (wi < arr.length - 1) sh.appendChild(document.createTextNode(' '));
    });
  }

  var nav = document.querySelector('.nav');
  function onScroll() { nav.classList.toggle('is-scrolled', window.scrollY > 8); }
  if (!bound) window.addEventListener('scroll', function () { var n = document.querySelector('.nav'); if (n) n.classList.toggle('is-scrolled', window.scrollY > 8); }, { passive: true });
  bound = true;
  onScroll();

  // Scroll reveal. Skipped when the visitor prefers reduced motion.
  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduce || !('IntersectionObserver' in window)) return;

  var groups = ['.section-head', '.experience__side .text-link', '.timeline__item', '.project', '.work-secondary__label',
    '.section-action', '.service', '.story__body > *', '.milestones li', '.approach__item', '.form', '.aside-card', '.cta__inner > *', '.footer__grid > *', '.footer__legal'];
  var items = [];
  groups.forEach(function (sel) {
    document.querySelectorAll(sel).forEach(function (el) { items.push(el); });
  });
  items.forEach(function (el) {
    var siblings = Array.prototype.filter.call(el.parentNode.children, function (c) { return c.className === el.className; });
    var i = Math.max(0, siblings.indexOf(el));
    el.style.setProperty('--d', Math.min(i, 4) * 110 + 'ms');
    el.classList.add('reveal');
  });
  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (entry) {
      if (!entry.isIntersecting) return;
      var el = entry.target;
      el.classList.add('is-visible');
      io.unobserve(el);
      // Clean up afterwards so hover effects on the element work normally.
      setTimeout(function () {
        el.classList.remove('reveal', 'is-visible');
        el.style.removeProperty('--d');
      }, 1500);
    });
  }, { threshold: 0.12, rootMargin: '0px 0px -3% 0px' });
  items.forEach(function (el) { io.observe(el); });
  }
  return { init: init };
})();
