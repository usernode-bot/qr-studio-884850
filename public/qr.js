/*
 * QR Studio's own QR Code encoder (Model 2, versions 1-40).
 *
 * Byte mode only, error-correction level M, smallest version that fits, and
 * the best of the eight standard masks by penalty score. Self-contained on
 * purpose: no data leaves the device, so the encoder lives in this file
 * rather than in an npm package (see CLAUDE.md, App-specific conventions).
 *
 * Exports:
 *   QR.encode(bytes: Uint8Array) -> { size, modules, version, mask }
 *     modules[y][x] is true for a dark module, top-left origin.
 *   QR.MAX_BYTES = 2331 — the most bytes one code can hold (version 40, M).
 *     encode() throws RangeError with .overBy when bytes.length exceeds it.
 *
 * The tables below are the ISO/IEC 18004 ones (same values as every
 * mainstream implementation); verified by test/qr.test.js.
 */
'use strict';

(function (root) {
  // ECC codewords per block, error-correction level M, versions 1-40.
  var ECC_PER_BLOCK_M = [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26,
    26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28];
  // Number of error-correction blocks, level M, versions 1-40.
  var NUM_BLOCKS_M = [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16,
    17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49];
  var MIN_VERSION = 1;
  var MAX_VERSION = 40;
  // Level M's format-info field value (L=1, M=0, Q=3, H=2).
  var FORMAT_BITS_M = 0;

  // Total data + ECC modules in the raw grid, minus function patterns.
  function getNumRawDataModules(ver) {
    var result = (16 * ver + 128) * ver + 64;
    if (ver >= 2) {
      var numAlign = Math.floor(ver / 7) + 2;
      result -= (25 * numAlign - 10) * numAlign - 55;
      if (ver >= 7) result -= 36;
    }
    return result;
  }

  // Data codewords (remainder bits discarded) for a version at level M.
  function getNumDataCodewords(ver) {
    return Math.floor(getNumRawDataModules(ver) / 8) - ECC_PER_BLOCK_M[ver] * NUM_BLOCKS_M[ver];
  }

  // Alignment pattern centre coordinates for a version.
  function alignmentPositions(ver, size) {
    if (ver === 1) return [];
    var numAlign = Math.floor(ver / 7) + 2;
    var step = Math.floor((ver * 8 + numAlign * 3 + 5) / (numAlign * 4 - 4)) * 2;
    var result = [6];
    for (var pos = size - 7; result.length < numAlign; pos -= step)
      result.splice(1, 0, pos);
    return result;
  }

  // ── Reed-Solomon over GF(2^8 / 0x11D) ─────────────────────────────────────

  // Generator polynomial of the given degree, coefficients highest→lowest
  // power, leading term dropped (always 1).
  function rsDivisor(degree) {
    var result = [];
    for (var i = 0; i < degree - 1; i++) result.push(0);
    result.push(1);
    var root = 1;
    for (var j = 0; j < degree; j++) {
      for (var k = 0; k < result.length; k++) {
        result[k] = rsMultiply(result[k], root);
        if (k + 1 < result.length) result[k] ^= result[k + 1];
      }
      root = rsMultiply(root, 0x02);
    }
    return result;
  }

  // Remainder of data upon division by the divisor polynomial.
  function rsRemainder(data, divisor) {
    var result = divisor.map(function () { return 0; });
    for (var d = 0; d < data.length; d++) {
      var factor = data[d] ^ result.shift();
      result.push(0);
      for (var i = 0; i < divisor.length; i++)
        result[i] ^= rsMultiply(divisor[i], factor);
    }
    return result;
  }

  function rsMultiply(x, y) {
    var z = 0;
    for (var i = 7; i >= 0; i--) {
      z = (z << 1) ^ ((z >>> 7) * 0x11D);
      z ^= ((y >>> i) & 1) * x;
    }
    return z & 0xFF;
  }

  // ── Bit buffer ────────────────────────────────────────────────────────────

  function BitBuffer() { this.bits = []; }
  BitBuffer.prototype.append = function (val, len) {
    for (var i = len - 1; i >= 0; i--) this.bits.push(((val >>> i) & 1) !== 0);
  };

  // ── Encoding ──────────────────────────────────────────────────────────────

  function encode(bytes) {
    if (!(bytes instanceof Uint8Array)) bytes = new Uint8Array(bytes);
    if (bytes.length > MAX_BYTES) {
      var err = new RangeError('Data too long for one QR code');
      err.overBy = bytes.length - MAX_BYTES;
      throw err;
    }

    // Smallest version whose capacity fits: mode (4 bits) + character count
    // (8 bits for v1-9, 16 bits for v10+) + the bytes + the terminator.
    var dataUsedBits = 4 + (bytes.length <= 2488 ? 8 : 16) + bytes.length * 8;
    var version = -1;
    for (var v = MIN_VERSION; v <= MAX_VERSION; v++) {
      var cciBits = v < 10 ? 8 : 16;
      var used = 4 + cciBits + bytes.length * 8;
      if (used <= getNumDataCodewords(v) * 8) { version = v; dataUsedBits = used; break; }
    }
    if (version === -1) {
      var err2 = new RangeError('Data too long for one QR code');
      err2.overBy = bytes.length - MAX_BYTES;
      throw err2;
    }

    var bb = new BitBuffer();
    bb.append(4, 4);                      // Byte mode
    bb.append(bytes.length, version < 10 ? 8 : 16);
    for (var b = 0; b < bytes.length; b++) bb.append(bytes[b], 8);

    var dataCapacityBits = getNumDataCodewords(version) * 8;
    bb.append(0, Math.min(4, dataCapacityBits - bb.bits.length));  // Terminator
    bb.append(0, (8 - bb.bits.length % 8) % 8);                    // Pad to a byte
    for (var pad = 0xEC; bb.bits.length < dataCapacityBits; pad ^= 0xEC ^ 0x11)
      bb.append(pad, 8);                                            // 0xEC / 0x11
    var dataCodewords = [];
    for (var w = 0; w < bb.bits.length / 8; w++) {
      var byte = 0;
      for (var bit = 0; bit < 8; bit++) byte = (byte << 1) | (bb.bits[w * 8 + bit] ? 1 : 0);
      dataCodewords.push(byte);
    }

    var qr = new QrMatrix(version, dataCodewords);
    return qr;
  }

  // ── Matrix assembly ───────────────────────────────────────────────────────

  function QrMatrix(version, dataCodewords) {
    this.version = version;
    this.mask = -1;
    var size = this.size = version * 4 + 17;
    this.modules = [];
    this.isFunction = [];
    for (var i = 0; i < size; i++) {
      this.modules.push(new Array(size).fill(false));
      this.isFunction.push(new Array(size).fill(false));
    }

    this.drawFunctionPatterns();
    var allCodewords = this.addEccAndInterleave(dataCodewords);
    this.drawCodewords(allCodewords);

    // Try all eight masks, keep the lowest penalty score.
    var minPenalty = Infinity;
    var bestMask = 0;
    for (var m = 0; m < 8; m++) {
      this.applyMask(m);
      this.drawFormatBits(m);
      var penalty = this.getPenaltyScore();
      if (penalty < minPenalty) { minPenalty = penalty; bestMask = m; }
      this.applyMask(m);  // XOR undoes it
    }
    this.mask = bestMask;
    this.applyMask(bestMask);
    this.drawFormatBits(bestMask);
    this.isFunction = null;
  }

  QrMatrix.prototype.setFunctionModule = function (x, y, isDark) {
    this.modules[y][x] = isDark;
    this.isFunction[y][x] = true;
  };

  QrMatrix.prototype.drawFunctionPatterns = function () {
    var size = this.size;
    // Timing patterns
    for (var i = 0; i < size; i++) {
      this.setFunctionModule(6, i, i % 2 === 0);
      this.setFunctionModule(i, 6, i % 2 === 0);
    }
    // Three finder patterns (with separators)
    this.drawFinderPattern(3, 3);
    this.drawFinderPattern(size - 4, 3);
    this.drawFinderPattern(3, size - 4);
    // Alignment patterns
    var positions = alignmentPositions(this.version, size);
    var n = positions.length;
    for (var a = 0; a < n; a++) {
      for (var b = 0; b < n; b++) {
        if (!(a === 0 && b === 0 || a === 0 && b === n - 1 || a === n - 1 && b === 0))
          this.drawAlignmentPattern(positions[a], positions[b]);
      }
    }
    this.drawFormatBits(0);  // Dummy mask; overwritten once the mask is chosen
    this.drawVersion();
  };

  QrMatrix.prototype.drawFinderPattern = function (x, y) {
    for (var dy = -4; dy <= 4; dy++) {
      for (var dx = -4; dx <= 4; dx++) {
        var dist = Math.max(Math.abs(dx), Math.abs(dy));
        var xx = x + dx, yy = y + dy;
        if (0 <= xx && xx < this.size && 0 <= yy && yy < this.size)
          this.setFunctionModule(xx, yy, dist !== 2 && dist !== 4);
      }
    }
  };

  QrMatrix.prototype.drawAlignmentPattern = function (x, y) {
    for (var dy = -2; dy <= 2; dy++) {
      for (var dx = -2; dx <= 2; dx++)
        this.setFunctionModule(x + dx, y + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    }
  };

  QrMatrix.prototype.drawFormatBits = function (mask) {
    var data = FORMAT_BITS_M << 3 | mask;
    var rem = data;
    for (var i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    var bits = (data << 10 | rem) ^ 0x5412;
    var size = this.size;
    var set = this.setFunctionModule.bind(this);
    for (var j = 0; j <= 5; j++) set(8, j, getBit(bits, j));
    set(8, 7, getBit(bits, 6));
    set(8, 8, getBit(bits, 7));
    set(7, 8, getBit(bits, 8));
    for (var k = 9; k < 15; k++) set(14 - k, 8, getBit(bits, k));
    for (var p = 0; p < 8; p++) set(size - 1 - p, 8, getBit(bits, p));
    for (var q = 8; q < 15; q++) set(8, size - 15 + q, getBit(bits, q));
    set(8, size - 8, true);  // The always-dark module
  };

  QrMatrix.prototype.drawVersion = function () {
    if (this.version < 7) return;
    var rem = this.version;
    for (var i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1F25);
    var bits = this.version << 12 | rem;
    for (var j = 0; j < 18; j++) {
      var color = getBit(bits, j);
      var a = this.size - 11 + j % 3;
      var b = Math.floor(j / 3);
      this.setFunctionModule(a, b, color);
      this.setFunctionModule(b, a, color);
    }
  };

  QrMatrix.prototype.addEccAndInterleave = function (data) {
    var ver = this.version;
    var blockEccLen = ECC_PER_BLOCK_M[ver];
    var numBlocks = NUM_BLOCKS_M[ver];
    var rawCodewords = Math.floor(getNumRawDataModules(ver) / 8);
    var numShortBlocks = numBlocks - rawCodewords % numBlocks;
    var shortBlockLen = Math.floor(rawCodewords / numBlocks);

    var blocks = [];
    var divisor = rsDivisor(blockEccLen);
    for (var i = 0, k = 0; i < numBlocks; i++) {
      var dat = data.slice(k, k + shortBlockLen - blockEccLen + (i < numShortBlocks ? 0 : 1));
      k += dat.length;
      var ecc = rsRemainder(dat, divisor);
      if (i < numShortBlocks) dat.push(0);  // Padding byte in short blocks
      blocks.push(dat.concat(ecc));
    }
    var result = [];
    for (var j = 0; j < blocks[0].length; j++) {
      for (var b = 0; b < numBlocks; b++) {
        if (j !== shortBlockLen - blockEccLen || b >= numShortBlocks)
          result.push(blocks[b][j]);
      }
    }
    return result;
  };

  QrMatrix.prototype.drawCodewords = function (data) {
    var i = 0;
    var size = this.size;
    for (var right = size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (var vert = 0; vert < size; vert++) {
        for (var j = 0; j < 2; j++) {
          var x = right - j;
          var upward = ((right + 1) & 2) === 0;
          var y = upward ? size - 1 - vert : vert;
          if (!this.isFunction[y][x] && i < data.length * 8) {
            this.modules[y][x] = getBit(data[i >>> 3], 7 - (i & 7));
            i++;
          }
        }
      }
    }
  };

  QrMatrix.prototype.applyMask = function (mask) {
    for (var y = 0; y < this.size; y++) {
      for (var x = 0; x < this.size; x++) {
        var invert;
        switch (mask) {
          case 0: invert = (x + y) % 2 === 0; break;
          case 1: invert = y % 2 === 0; break;
          case 2: invert = x % 3 === 0; break;
          case 3: invert = (x + y) % 3 === 0; break;
          case 4: invert = (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0; break;
          case 5: invert = x * y % 2 + x * y % 3 === 0; break;
          case 6: invert = (x * y % 2 + x * y % 3) % 2 === 0; break;
          case 7: invert = ((x + y) % 2 + x * y % 3) % 2 === 0; break;
        }
        if (!this.isFunction[y][x]) this.modules[y][x] ^= invert;
      }
    }
  };

  // Penalty score (rules N1-N4) used to pick the mask.
  QrMatrix.prototype.getPenaltyScore = function () {
    var result = 0;
    var size = this.size;

    function finderPenaltyCountPatterns(runHistory) {
      var n = runHistory[1];
      var core = n > 0 && runHistory[2] === n && runHistory[3] === n * 3 && runHistory[4] === n && runHistory[5] === n;
      return (core && runHistory[0] >= n * 4 && runHistory[6] >= n ? 1 : 0)
        + (core && runHistory[6] >= n * 4 && runHistory[0] >= n ? 1 : 0);
    }
    function finderPenaltyAddHistory(runLength, runHistory) {
      if (runHistory[0] === 0) runLength += size;
      runHistory.pop();
      runHistory.unshift(runLength);
    }
    function finderPenaltyTerminateAndCount(currentRunColor, currentRunLength, runHistory) {
      if (currentRunColor) {
        finderPenaltyAddHistory(currentRunLength, runHistory);
        currentRunLength = 0;
      }
      currentRunLength += size;
      finderPenaltyAddHistory(currentRunLength, runHistory);
      return finderPenaltyCountPatterns(runHistory);
    }

    // Same-colour runs in rows, and finder-like patterns
    for (var y = 0; y < size; y++) {
      var runColor = false, runX = 0;
      var runHistory = [0, 0, 0, 0, 0, 0, 0];
      for (var x = 0; x < size; x++) {
        if (this.modules[y][x] === runColor) {
          runX++;
          if (runX === 5) result += 3;
          else if (runX > 5) result++;
        } else {
          finderPenaltyAddHistory(runX, runHistory);
          if (!runColor) result += finderPenaltyCountPatterns(runHistory) * 40;
          runColor = this.modules[y][x];
          runX = 1;
        }
      }
      result += finderPenaltyTerminateAndCount(runColor, runX, runHistory) * 40;
    }
    // Same in columns
    for (var c = 0; c < size; c++) {
      var colColor = false, runY = 0;
      var colHistory = [0, 0, 0, 0, 0, 0, 0];
      for (var r = 0; r < size; r++) {
        if (this.modules[r][c] === colColor) {
          runY++;
          if (runY === 5) result += 3;
          else if (runY > 5) result++;
        } else {
          finderPenaltyAddHistory(runY, colHistory);
          if (!colColor) result += finderPenaltyCountPatterns(colHistory) * 40;
          colColor = this.modules[r][c];
          runY = 1;
        }
      }
      result += finderPenaltyTerminateAndCount(colColor, runY, colHistory) * 40;
    }
    // 2x2 blocks of the same colour
    for (var yy = 0; yy < size - 1; yy++) {
      for (var xx = 0; xx < size - 1; xx++) {
        var color = this.modules[yy][xx];
        if (color === this.modules[yy][xx + 1] && color === this.modules[yy + 1][xx] &&
          color === this.modules[yy + 1][xx + 1]) result += 3;
      }
    }
    // Balance of dark and light
    var dark = 0;
    for (var row = 0; row < size; row++)
      for (var col = 0; col < size; col++) if (this.modules[row][col]) dark++;
    var total = size * size;
    var k = Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1;
    result += k * 10;
    return result;
  };

  function getBit(x, i) { return ((x >>> i) & 1) !== 0; }

  // The most bytes one code can hold (version 40, level M): 2334 data
  // codewords, minus the 16-bit character count and the 4-bit mode, floored.
  var MAX_BYTES = 2331;

  var QR = { encode: encode, MAX_BYTES: MAX_BYTES };
  if (typeof module !== 'undefined' && module.exports) module.exports = QR;
  else root.QR = QR;
})(typeof self !== 'undefined' ? self : this);