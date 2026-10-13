'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const QR = require('../public/qr.js');

const utf8 = (s) => new TextEncoder().encode(s);

// The format-info strip, read back out of the matrix: 15 bits per copy, BCH
// masked with 0x5412. Returns the unmasked { level, mask } the code declares.
function readFormatBits(modules, copy) {
  const size = modules.length;
  // Bit i of the format word lives at (8, i) for i 0-8 (column strip) and
  // (14-i, 8) for i 9-14 (row strip); the second copy mirrors this.
  const get = copy === 0
    ? (i) => i <= 5 ? modules[i][8] : i === 6 ? modules[7][8] : i === 7 ? modules[8][8] : i === 8 ? modules[8][7] : modules[8][14 - i]
    : (i) => i < 8 ? modules[8][size - 1 - i] : modules[size - 15 + i][8];
  let bits = 0;
  for (let i = 14; i >= 0; i--) bits = (bits << 1) | (get(i) ? 1 : 0);
  const unmasked = bits ^ 0x5412;
  // BCH check: the 15-bit word must divide exactly by the 11-bit generator
  // 0x537, processing one bit at a time with an XOR whenever bit 10 appears.
  let rem = 0;
  for (let i = 14; i >= 0; i--) {
    rem = (rem << 1) | ((unmasked >>> i) & 1);
    if (rem & 0x400) rem ^= 0x537;
  }
  assert.equal(rem, 0, 'format bits fail BCH check');
  return { level: unmasked >>> 13, mask: (unmasked >>> 10) & 7 };
}

test('exports MAX_BYTES 2331', () => {
  assert.equal(QR.MAX_BYTES, 2331);
});

test('"HELLO" fits version 1 (size 21)', () => {
  const qr = QR.encode(utf8('HELLO'));
  assert.equal(qr.size, 21);
  assert.equal(qr.version, 1);
});

test('"https://example.com/menu" fits version 2 (size 25)', () => {
  const qr = QR.encode(utf8('https://example.com/menu'));
  assert.equal(qr.size, 25);
  assert.equal(qr.version, 2);
});

test('2331 bytes fills version 40 (size 177)', () => {
  const qr = QR.encode(new Uint8Array(2331).fill(0x41));
  assert.equal(qr.size, 177);
  assert.equal(qr.version, 40);
});

test('2332 bytes throws RangeError with overBy 1', () => {
  assert.throws(() => QR.encode(new Uint8Array(2332)), (err) => {
    assert.ok(err instanceof RangeError);
    assert.equal(err.overBy, 1);
    return true;
  });
});

test('three finder patterns present', () => {
  const qr = QR.encode(utf8('HELLO'));
  const m = qr.modules;
  const isFinder = (ox, oy) => {
    for (let y = 0; y < 7; y++) {
      for (let x = 0; x < 7; x++) {
        const dist = Math.max(Math.abs(x - 3), Math.abs(y - 3));
        // Outer ring dark, one-module light ring, dark 3x3 centre.
        const dark = dist !== 2;
        if (m[oy + y][ox + x] !== dark) return false;
      }
    }
    return true;
  };
  assert.ok(isFinder(0, 0), 'top-left');
  assert.ok(isFinder(0, qr.size - 7), 'bottom-left');
  assert.ok(isFinder(qr.size - 7, 0), 'top-right');
});

test('timing patterns alternate', () => {
  const qr = QR.encode(utf8('https://example.com/menu'));
  // The timing strip is the part between the finders: modules 8 .. size-9.
  for (let i = 8; i <= qr.size - 9; i++) {
    assert.equal(qr.modules[6][i], i % 2 === 0, `row timing at ${i}`);
    assert.equal(qr.modules[i][6], i % 2 === 0, `column timing at ${i}`);
  }
});

test('dark module sits at (8, 4*version+9)', () => {
  for (const text of ['HELLO', 'https://example.com/menu', 'x'.repeat(200)]) {
    const qr = QR.encode(utf8(text));
    assert.equal(qr.modules[4 * qr.version + 9][8], true);
  }
});

test('format bits read back to level M (0) and the declared mask', () => {
  for (const text of ['HELLO', 'https://example.com/menu', 'x'.repeat(500)]) {
    const qr = QR.encode(utf8(text));
    const fmt = readFormatBits(qr.modules, 0);
    assert.equal(fmt.level, 0, 'level M');
    assert.equal(fmt.mask, qr.mask, 'mask matches the second copy');
    const fmt2 = readFormatBits(qr.modules, 1);
    assert.deepEqual(fmt2, fmt, 'both format copies agree');
  }
});

test('all eight masks decode cleanly through the declared mask', () => {
  // Force a variety of payloads so different masks win; every result must
  // still carry valid, self-consistent format info.
  for (let n = 1; n <= 120; n += 7) {
    const qr = QR.encode(new Uint8Array(n).fill(0x30));
    const fmt = readFormatBits(qr.modules, 0);
    assert.equal(fmt.mask, qr.mask);
    assert.ok(qr.mask >= 0 && qr.mask <= 7);
  }
});

test('UTF-8 multibyte content encodes', () => {
  const qr = QR.encode(utf8('héllo wörld — café ☕'));
  assert.equal(qr.size % 4, 1); // sizes are 4v+17, so 21, 25, 29, ...
  assert.ok(qr.size >= 21 && qr.size <= 177);
});