'use strict';

// The app icon and featured artwork live in brand/ and are pointed at by
// dapp.json. Nothing in the app's runtime reads these files, but the
// platform reads the icon at deploy time and rejects (falls back to the
// emoji) anything that is not a valid PNG under 256 KB, so these tests pin
// the format, the dimensions and the size, and the dapp.json pointer.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

// A PNG file starts with this 8-byte signature; the IHDR chunk that follows
// carries the width and height as 4-byte big-endian integers.
function pngSize(file) {
  const buf = fs.readFileSync(file);
  assert.ok(buf.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])), `${file} is a PNG`);
  assert.equal(buf.readUInt32BE(12), 0x49484452, `${file} IHDR present`);
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

test('dapp.json points the icon at the image and keeps the emoji fallback', () => {
  const dapp = JSON.parse(fs.readFileSync(path.join(ROOT, 'dapp.json'), 'utf8'));
  assert.equal(dapp.icon.image, 'brand/icon.png');
  assert.equal(dapp.icon.emoji, '🔳');
  assert.ok(fs.existsSync(path.join(ROOT, dapp.icon.image)), 'icon file exists');
});

test('icon is a 1024x1024 PNG within the platform size limit', () => {
  const file = path.join(ROOT, 'brand/icon.png');
  assert.equal(pngSize(file).width, 1024);
  assert.equal(pngSize(file).height, 1024);
  const kb = fs.statSync(file).size / 1024;
  assert.ok(kb <= 256, `icon is ${kb.toFixed(1)} KB, limit 256`);
});

test('featured artwork exists in both looks at 1600x900', () => {
  for (const name of ['featured-light.png', 'featured-dark.png']) {
    const size = pngSize(path.join(ROOT, 'brand', name));
    assert.equal(size.width, 1600, `${name} width`);
    assert.equal(size.height, 900, `${name} height`);
  }
});
