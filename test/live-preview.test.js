'use strict';

// The code draws itself live as you type: the Generate button is gone and
// unfinished input shows a small muted hint instead of a red field error.
// These checks pin the markup and logic behind that, the same way
// brand.test.js pins the brand assets: by reading the files, since the
// behaviour itself lives in browser code.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

const html = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
const app = fs.readFileSync(path.join(ROOT, 'public', 'app.js'), 'utf8');
const css = fs.readFileSync(path.join(ROOT, 'styles', 'tailwind-input.css'), 'utf8');

test('index.html has no Generate button and no red field errors for typed input', () => {
  assert.ok(!html.includes('id="generate"'), 'no #generate button');
  assert.ok(!/tap generate/i.test(html), 'no "tap Generate" copy');
  for (const id of ['link-error', 'text-error', 'contact-name-error',
    'contact-phone-error', 'contact-email-error', 'image-link-error']) {
    assert.ok(!html.includes('id="' + id + '"'), 'no #' + id + ' element');
  }
  // The picture's file error stays red: it comes from a chosen file.
  assert.ok(html.includes('id="image-file-error"'), '#image-file-error kept');
});

test('index.html says the code appears as you type', () => {
  assert.ok(html.includes('Fill in the details above and the code appears here.'),
    'empty-state copy updated');
});

test('app.js updates live with a 300 ms debounce and no stale-code logic', () => {
  assert.ok(!/tap generate/i.test(app), 'no "Tap Generate" note');
  assert.ok(!app.includes('is-stale'), 'no stale-code dimming');
  assert.ok(app.includes('setTimeout(updateNow, 300)'), '300 ms debounce');
  assert.ok(app.includes('form.addEventListener(\'submit\''), 'form kept for Enter');
});

test('the stylesheet no longer dims a stale frame', () => {
  assert.ok(!css.includes('is-stale'), 'no .is-stale rules left');
});
test('history is kept on the device and saved from the download, copy and share actions', () => {
  assert.ok(html.includes('id="history-list"') && html.includes('id="history-clear"'), 'history markup');
  assert.ok(app.includes('localStorage'), 'stored in the browser');
  assert.ok(!/fetch\([^)]*history/i.test(app), 'history is never sent anywhere');
  const saves = app.match(/saveToHistory\(\);/g) || [];
  assert.ok(saves.length >= 4, 'PNG, SVG, copy and share all save');
  assert.ok(!html.includes('Nothing you type or choose is saved'), 'footer no longer says nothing is saved');
});
