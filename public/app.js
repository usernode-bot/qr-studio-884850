/*
 * QR Studio's screen logic. Runs entirely in the browser: payloads are
 * encoded by public/qr.js on this device and never sent anywhere.
 */
'use strict';

(function () {
  var MAX_BYTES = (window.QR && window.QR.MAX_BYTES) || 2331;

  var form = document.getElementById('qr-form');
  var canvas = document.getElementById('qr-canvas');
  var empty = document.getElementById('qr-empty');
  var paper = canvas ? canvas.parentElement : null;
  var frame = document.querySelector('.qr-frame');
  var caption = document.getElementById('qr-caption');
  var note = document.getElementById('qr-note');
  var downloadBtn = document.getElementById('download');
  var generateBtn = document.getElementById('generate');

  var fields = {
    link: document.getElementById('link-input'),
    text: document.getElementById('text-input'),
    'contact-name': document.getElementById('contact-name'),
    'contact-phone': document.getElementById('contact-phone'),
    'contact-email': document.getElementById('contact-email'),
  };
  var errors = {
    link: document.getElementById('link-error'),
    text: document.getElementById('text-error'),
    'contact-name': document.getElementById('contact-name-error'),
    'contact-phone': document.getElementById('contact-phone-error'),
    'contact-email': document.getElementById('contact-email-error'),
  };
  var fieldsets = {};
  document.querySelectorAll('fieldset[data-mode]').forEach(function (fs) {
    fieldsets[fs.dataset.mode] = fs;
  });

  var mode = 'link';
  var currentCode = null;   // the rendered matrix
  var currentName = null;   // download file name without extension
  var currentBytes = null;  // what the current code encodes

  // ── Helpers ───────────────────────────────────────────────────────────────

  function showError(key, message) {
    errors[key].textContent = message;
    errors[key].hidden = false;
    fields[key].setAttribute('aria-invalid', 'true');
  }
  function clearErrors() {
    Object.keys(errors).forEach(function (key) {
      errors[key].hidden = true;
      errors[key].textContent = '';
      fields[key].removeAttribute('aria-invalid');
    });
  }

  function slug(text) {
    return text.toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40);
  }

  // The token values ("R G B" triples) as CSS colours for canvas drawing.
  function tokenColor(name, fallback) {
    var raw = getComputedStyle(document.documentElement).getPropertyValue('--' + name).trim();
    return raw ? 'rgb(' + raw.split(/\s+/).join(', ') + ')' : fallback;
  }

  function escapeVCard(value) {
    return value.replace(/\\/g, '\\\\').replace(/,/g, '\\,').replace(/;/g, '\\;')
      .replace(/\r?\n/g, '\\n');
  }

  function contactVCard(name, phone, email) {
    var parts = name.trim().split(/\s+/);
    var surname = parts.length > 1 ? parts[parts.length - 1] : '';
    var given = parts.length > 1 ? parts.slice(0, -1).join(' ') : parts[0];
    var lines = ['BEGIN:VCARD', 'VERSION:3.0',
      'N:' + escapeVCard(surname) + ';' + escapeVCard(given) + ';;;',
      'FN:' + escapeVCard(name.trim())];
    if (phone) lines.push('TEL;TYPE=CELL:' + escapeVCard(phone.trim()));
    if (email) lines.push('EMAIL:' + escapeVCard(email.trim()));
    lines.push('END:VCARD');
    return lines.join('\r\n');
  }

  // "example.com/x" -> "https://example.com/x". Anything with a scheme is
  // left alone; only http(s) makes a sensible QR link.
  function normalizeLink(raw) {
    var value = raw.trim();
    if (!/^[a-z][a-z0-9+.-]*:/i.test(value)) value = 'https://' + value;
    var url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new Error('scheme');
    }
    return url.href;
  }

  function fileBaseName(url) {
    var host = url.hostname.replace(/^www\./, '');
    return 'qr-' + (slug(host) || 'link');
  }

  // ── Validation: returns { bytes, name } or shows inline errors ───────────

  function buildPayload() {
    clearErrors();
    if (mode === 'link') {
      var raw = fields.link.value.trim();
      if (!raw) { showError('link', 'Enter a link to make a code.'); return null; }
      var href;
      try {
        href = normalizeLink(raw);
      } catch (err) {
        showError('link', "That doesn't look like a link. Try something like example.com/menu.");
        return null;
      }
      return { text: href, name: fileBaseName(new URL(href)) };
    }
    if (mode === 'text') {
      var text = fields.text.value;
      if (!text.trim()) { showError('text', 'Enter some text to make a code.'); return null; }
      var bytes = new TextEncoder().encode(text);
      if (bytes.length > MAX_BYTES) {
        showError('text', "That's too long for one code. Trim it by " +
          (bytes.length - MAX_BYTES).toLocaleString() + ' characters.');
        return null;
      }
      var base = slug(text.trim().split(/\s+/).slice(0, 3).join(' '));
      return { text: text, name: 'qr-' + (base || 'text') };
    }
    // contact
    var name = fields['contact-name'].value.trim();
    var phone = fields['contact-phone'].value.trim();
    var email = fields['contact-email'].value.trim();
    if (!name) { showError('contact-name', 'Enter a name for this contact.'); return null; }
    if (!phone && !email) {
      showError('contact-phone', 'Add a phone number, an email, or both.');
      return null;
    }
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      showError('contact-email', "That email doesn't look right.");
      return null;
    }
    var card = contactVCard(name, phone, email);
    if (new TextEncoder().encode(card).length > MAX_BYTES) {
      showError('contact-name', "That's too long for one code. Shorten the details.");
      return null;
    }
    return { text: card, name: 'qr-' + slug(name) };
  }

  // ── Rendering ─────────────────────────────────────────────────────────────

  function drawMatrix(result) {
    var quiet = 4;
    var total = result.size + quiet * 2;
    var cssSize = paper.clientWidth || 200;
    var dpr = window.devicePixelRatio || 1;
    var px = Math.max(1, Math.floor((cssSize * dpr) / total));
    canvas.width = total * px;
    canvas.height = total * px;
    canvas.style.width = cssSize + 'px';
    canvas.style.height = cssSize + 'px';
    var ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = tokenColor('qr-paper', '#ffffff');
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = tokenColor('qr-ink', '#000000');
    for (var y = 0; y < result.size; y++) {
      for (var x = 0; x < result.size; x++) {
        if (result.modules[y][x]) {
          ctx.fillRect((x + quiet) * px, (y + quiet) * px, px, px);
        }
      }
    }
  }

  function render(result, payload) {
    currentCode = result;
    currentName = payload.name;
    currentBytes = payload.text;
    drawMatrix(result);
    canvas.hidden = false;
    empty.hidden = true;
    var label = mode === 'link' ? 'QR code linking to ' + payload.text
      : mode === 'text' ? 'QR code holding the entered text'
      : 'QR code for this contact card';
    canvas.setAttribute('aria-label', label);
    frame.classList.remove('is-stale');
    note.hidden = true;
    note.textContent = '';
    var version = result.version;
    var info = 'Version ' + version + ' \u00B7 ' + result.size + ' \u00D7 ' + result.size +
      ' modules \u00B7 ready to scan';
    caption.textContent = info;
    downloadBtn.hidden = false;
  }

  function generate() {
    var payload = buildPayload();
    if (!payload) {
      currentCode = null;
      return;
    }
    var bytes = new TextEncoder().encode(payload.text);
    var result;
    try {
      result = window.QR.encode(bytes);
    } catch (err) {
      var over = err && typeof err.overBy === 'number' ? err.overBy : 0;
      showError(mode === 'link' ? 'link' : mode === 'text' ? 'text' : 'contact-name',
        "That's too long for one code." + (over ? ' Trim it by ' + over.toLocaleString() + ' characters.' : ''));
      return;
    }
    render(result, payload);
    document.getElementById('preview').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  // ── Mode switching ────────────────────────────────────────────────────────

  function setMode(next) {
    mode = next;
    Object.keys(fieldsets).forEach(function (key) {
      fieldsets[key].hidden = key !== next;
    });
    document.querySelectorAll('.seg').forEach(function (label) {
      label.classList.toggle('is-active', label.querySelector('input').value === next);
    });
  }
  document.querySelectorAll('input[name="mode"]').forEach(function (radio) {
    radio.addEventListener('change', function () { setMode(radio.value); });
  });

  // ── Stale state: any edit after a generate dims the old code ─────────────

  Object.keys(fields).forEach(function (key) {
    fields[key].addEventListener('input', function () {
      if (currentCode) {
        frame.classList.add('is-stale');
        note.textContent = 'You changed the details. Tap Generate to update this code.';
        note.hidden = false;
      }
    });
  });

  // Text counter (bytes are what the encoder cares about)
  var counter = document.getElementById('text-counter');
  function updateCounter() {
    var bytes = new TextEncoder().encode(fields.text.value).length;
    counter.textContent = bytes.toLocaleString() + ' / 2,000 characters';
    counter.classList.toggle('text-danger', bytes > 2000);
  }
  fields.text.addEventListener('input', updateCounter);

  form.addEventListener('submit', function (event) {
    event.preventDefault();
    generate();
  });

  // ── Download ──────────────────────────────────────────────────────────────

  downloadBtn.addEventListener('click', function () {
    if (!currentCode) return;
    var quiet = 4;
    var total = currentCode.size + quiet * 2;
    var scale = Math.max(1, Math.floor(1024 / total));
    var out = document.createElement('canvas');
    out.width = total * scale;
    out.height = total * scale;
    var ctx = out.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, out.width, out.height);
    ctx.fillStyle = '#000000';
    for (var y = 0; y < currentCode.size; y++) {
      for (var x = 0; x < currentCode.size; x++) {
        if (currentCode.modules[y][x]) {
          ctx.fillRect((x + quiet) * scale, (y + quiet) * scale, scale, scale);
        }
      }
    }
    var name = (currentName || 'qr-code') + '.png';
    try {
      out.toBlob(function (blob) {
        if (!blob) {
          caption.textContent = 'The download failed. Try again.';
          return;
        }
        var url = URL.createObjectURL(blob);
        var anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = name;
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
        if (window.unNative && typeof window.unNative.toast === 'function') {
          window.unNative.toast('Downloaded');
        }
      }, 'image/png');
    } catch (err) {
      caption.textContent = 'The download failed. Try again.';
    }
  });

  // ── Staging demo (?demo=1 fills the screen with sample content) ──────────

  function applyDemo(demo) {
    setMode(demo.mode);
    var radio = document.querySelector('input[name="mode"][value="' + demo.mode + '"]');
    if (radio) radio.checked = true;
    if (demo.mode === 'link') fields.link.value = demo.link;
    if (demo.mode === 'text') { fields.text.value = demo.text; updateCounter(); }
    if (demo.mode === 'contact') {
      fields['contact-name'].value = demo.contact.name;
      fields['contact-phone'].value = demo.contact.phone;
      fields['contact-email'].value = demo.contact.email;
    }
    var noteEl = document.getElementById('demo-note');
    noteEl.textContent = 'Staging demo \u2014 this screen is filled with sample content.';
    noteEl.hidden = false;
    generate();
  }

  if (new URLSearchParams(location.search).get('demo') === '1') {
    empty.innerHTML = '<div class="skeleton h-20 w-20"></div>';
    var headers = {};
    var token = new URLSearchParams(location.search).get('token');
    if (token) headers['x-usernode-token'] = token;
    fetch('/api/demo?demo=1', { headers: headers })
      .then(function (res) { return res.json(); })
      .then(function (body) {
        empty.innerHTML = '<p>Your code appears here</p>';
        if (body && body.demo) applyDemo(body.demo);
      })
      .catch(function () {
        empty.innerHTML = '<p>Your code appears here</p>';
      });
  }
})();