// Contact form: validation, status feedback, duplicate-submit protection.
//
// DELIVERY IS NOT CONFIGURED YET. Messages are only sent if you paste a real
// form-service URL in the admin panel (for example a Formspree or Web3Forms endpoint).
// While the URL is empty the form validates, then clearly tells the visitor
// that the message was NOT sent. Nothing is stored in the browser.
// The form-service URL is set in the admin panel (Contact page > Contact form > "Form service URL").
window.ContactForm = (function () {
  function init(FORM_ENDPOINT) {
  var form = document.getElementById('contact-form-el');
  if (!form) return;
  var btn = document.getElementById('send-btn');
  var status = document.getElementById('form-status');
  var busy = false;

  function errEl(f) { return document.getElementById(f.id + '-err'); }
  function setError(f, msg) {
    var e = errEl(f);
    e.textContent = msg || '';
    if (msg) f.setAttribute('aria-invalid', 'true'); else f.removeAttribute('aria-invalid');
  }
  var messages = {
    name: 'Please enter your full name.',
    email: 'Please enter your email address.',
    subject: 'Please enter a subject.',
    project_type: 'Please select a project type.',
    message: 'Please enter a message.'
  };
  function check(f) {
    var v = f.value.trim();
    if (!v) { setError(f, messages[f.name]); return false; }
    if (f.type === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v)) { setError(f, 'Please enter a valid email address, like name@example.com.'); return false; }
    setError(f, '');
    return true;
  }
  var fields = Array.prototype.slice.call(form.querySelectorAll('input[required], select[required], textarea[required]'));
  fields.forEach(function (f) {
    f.addEventListener('blur', function () { if (f.value || f.getAttribute('aria-invalid')) check(f); });
    f.addEventListener('input', function () { if (f.getAttribute('aria-invalid')) check(f); });
  });

  function show(kind, msg) {
    status.className = 'form__status is-' + kind;
    status.textContent = msg;
    status.focus({ preventScroll: false });
  }

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    if (busy) return;
    status.className = 'form__status'; status.textContent = '';
    var firstBad = null;
    fields.forEach(function (f) { if (!check(f) && !firstBad) firstBad = f; });
    if (firstBad) { firstBad.focus(); show('error', 'Please fix the highlighted fields and try again.'); return; }

    // Spam trap: real visitors never fill this in. Pretend nothing happened.
    if (form.elements.company.value) return;

    if (!FORM_ENDPOINT) {
      show('info', 'Your message was not sent. This form is not connected to an email service yet. Please contact me directly through the email address in the footer or on LinkedIn.');
      return;
    }

    busy = true; btn.disabled = true; btn.setAttribute('aria-busy', 'true'); btn.textContent = 'Sending...';
    var data = {};
    fields.forEach(function (f) { data[f.name] = f.value.trim(); });
    fetch(FORM_ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' }, body: JSON.stringify(data) })
      .then(function (r) { if (!r.ok) throw new Error('bad status'); form.reset(); show('success', 'Thank you. Your message has been sent. I will get back to you soon.'); })
      .catch(function () { show('error', 'Something went wrong and your message was not sent. Please try again in a moment or contact me directly.'); })
      .then(function () { busy = false; btn.disabled = false; btn.removeAttribute('aria-busy'); btn.textContent = 'Send Message'; });
  });
  }
  return { init: init };
})();
