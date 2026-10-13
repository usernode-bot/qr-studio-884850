'use strict';

// Draws QR Studio's brand images: the app icon and the two featured
// illustrations for the Homeroom directory. Run `node brand/render.js`
// from the repo root to regenerate the three PNGs.
//
// The mark is one bold glyph: a QR finder square (the square-in-a-square in
// every QR code's corner) crossed by a paintbrush stroke. It follows the
// Homeroom brand framework's icon tiles: one mark on a tile, flat, no
// text, in a brand pairing — Black + Yellow here, with Cream for the
// finder. Only colours from the palette below are used; smooth edges are
// linear blends of the two palette colours that meet, so no other hue
// appears anywhere.
//
// No image library is available here, so the renderer is hand-rolled:
// every shape is rasterised with 4x4 supersampling and the result is
// written as an RGB PNG (colour type 2, filter 0 per row) with
// zlib.deflateSync and a hand-rolled CRC32.

const zlib = require('zlib');
const fs = require('fs');
const path = require('path');

// ---- Homeroom brand palette ------------------------------------------------
const BLACK = [0, 0, 0];
const CREAM = [255, 254, 234]; // #FFFEEA
const YELLOW = [255, 238, 111]; // #FFEE6F

// ---- PNG writing -----------------------------------------------------------

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

function writePng(file, width, height, rgb) {
  // Filter 0 on every row: for flat art this still compresses well.
  const stride = 1 + width * 3;
  const raw = Buffer.alloc(height * stride);
  for (let y = 0; y < height; y++) {
    raw[y * stride] = 0;
    rgb.copy(raw, y * stride + 1, y * width * 3, (y + 1) * width * 3);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type 2: truecolour, no alpha
  const png = Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
  fs.writeFileSync(file, png);
  return png.length;
}

// ---- Shapes ----------------------------------------------------------------
//
// A shape is { inside(x, y), bbox: [x0, y0, x1, y1] }. A layer entry may
// carry cut: true to subtract from that layer only.

function roundedRect(x0, y0, x1, y1, rad) {
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  const hw = (x1 - x0) / 2;
  const hh = (y1 - y0) / 2;
  const r = Math.min(rad, hw, hh);
  return {
    bbox: [x0, y0, x1, y1],
    inside(x, y) {
      // Signed distance of a rounded box; inside means d <= 0.
      const qx = Math.abs(x - cx) - (hw - r);
      const qy = Math.abs(y - cy) - (hh - r);
      const ax = Math.max(qx, 0);
      const ay = Math.max(qy, 0);
      return Math.hypot(ax, ay) + Math.min(Math.max(qx, qy), 0) - r <= 0;
    },
  };
}

// A brush stroke: a band along a spine from a to b, tapering from radius
// r0 to r1. Round cap at the start (the handle end), flat at the tip. A
// flat tip can be extended past b (extendEnd) at radius r1, which is how
// the outline is grown without rounding the tip off.
function makeStroke(a, b, r0, r1, extendEnd) {
  extendEnd = extendEnd || 0;
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len = Math.hypot(dx, dy);
  const ux = dx / len;
  const uy = dy / len;
  const rAt = (s) => r0 + (r1 - r0) * Math.min(s / len, 1);
  return {
    bbox: [
      Math.min(a[0], b[0]) - r0 - 1,
      Math.min(a[1], b[1]) - r0 - 1,
      Math.max(a[0], b[0]) + Math.max(r0, r1) + extendEnd + 1,
      Math.max(a[1], b[1]) + Math.max(r0, r1) + extendEnd + 1,
    ],
    inside(x, y) {
      const vx = x - a[0];
      const vy = y - a[1];
      const s = vx * ux + vy * uy;
      if (s <= 0) return vx * vx + vy * vy <= r0 * r0; // round handle cap
      if (s >= len + extendEnd) return false; // flat tip
      const h = Math.abs(ux * vy - uy * vx);
      return h <= rAt(s);
    },
    // The same stroke dilated by g: the outline that separates the brush
    // from whatever it crosses. The flat tip stays flat, pushed out by g.
    grown(g) {
      return makeStroke(a, b, r0 + g, r1 + g, extendEnd + g);
    },
  };
}

// Place a shape defined in mark coordinates into output coordinates:
// output p -> mark p via (p - o) / k.
function placed(shape, ox, oy, k) {
  return {
    bbox: [ox + shape.bbox[0] * k, oy + shape.bbox[1] * k, ox + shape.bbox[2] * k, oy + shape.bbox[3] * k],
    inside(x, y) {
      return shape.inside((x - ox) / k, (y - oy) / k);
    },
  };
}

// ---- Painting --------------------------------------------------------------

const SUB = 4; // 4x4 supersampling per pixel

function makeCanvas(w, h, ground) {
  const buf = Buffer.alloc(w * h * 3);
  for (let i = 0; i < w * h; i++) {
    buf[i * 3] = ground[0];
    buf[i * 3 + 1] = ground[1];
    buf[i * 3 + 2] = ground[2];
  }
  return { w, h, buf };
}

// Paint one layer: the union of its added shapes (minus its cuts) at
// `paint`, over what is already on the canvas. Coverage per pixel is the
// fraction of its 16 subsamples inside, so an edge pixel becomes a linear
// mix of the colour below and `paint` — never a new hue.
function paintLayer(cv, entries, paint) {
  let bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity;
  for (const e of entries) {
    if (e.cut) continue;
    bx0 = Math.min(bx0, e.bbox[0]);
    by0 = Math.min(by0, e.bbox[1]);
    bx1 = Math.max(bx1, e.bbox[2]);
    by1 = Math.max(by1, e.bbox[3]);
  }
  const px0 = Math.max(0, Math.floor(bx0));
  const py0 = Math.max(0, Math.floor(by0));
  const px1 = Math.min(cv.w - 1, Math.ceil(bx1));
  const py1 = Math.min(cv.h - 1, Math.ceil(by1));
  for (let py = py0; py <= py1; py++) {
    for (let px = px0; px <= px1; px++) {
      let hit = 0;
      for (let sy = 0; sy < SUB; sy++) {
        const y = py + (sy + 0.5) / SUB;
        for (let sx = 0; sx < SUB; sx++) {
          const x = px + (sx + 0.5) / SUB;
          let inPlus = false;
          let inCut = false;
          for (const e of entries) {
            const b = e.bbox;
            if (x < b[0] || x > b[2] || y < b[1] || y > b[3]) continue;
            if (e.inside(x, y)) {
              if (e.cut) inCut = true;
              else inPlus = true;
            }
          }
          if (inPlus && !inCut) hit++;
        }
      }
      if (hit === 0) continue;
      const cov = hit / (SUB * SUB);
      const i = (py * cv.w + px) * 3;
      cv.buf[i] = Math.round(cv.buf[i] + (paint[0] - cv.buf[i]) * cov);
      cv.buf[i + 1] = Math.round(cv.buf[i + 1] + (paint[1] - cv.buf[i + 1]) * cov);
      cv.buf[i + 2] = Math.round(cv.buf[i + 2] + (paint[2] - cv.buf[i + 2]) * cov);
    }
  }
}

// ---- The mark --------------------------------------------------------------

// Geometry lives on the icon's 1024 grid; the featured images reuse it
// through placed() at their own scale.
const finder = {
  // Ring: outer square 232..792 (560 wide, 7 modules of 80), ring 80 thick,
  // outer corner radius 56, inner 24.
  outer: roundedRect(232, 232, 792, 792, 56),
  hole: roundedRect(312, 312, 712, 712, 24),
  // Centre: 3 modules, 240 wide.
  centre: roundedRect(392, 392, 632, 632, 24),
};

// Brush across the finder's lower third, clear of the centre so the
// square-in-a-square still reads: ~14 degrees, tapering to 60%.
const ICON_BRUSH = { a: [150, 790], b: [900, 615], r0: 75, r1: 45 };

// The icon: black tile edge to edge, cream finder, yellow brush. The ring
// (outer minus hole) and the centre are separate layers so the cut makes
// the hole but cannot eat the centre.
function renderIcon() {
  const cv = makeCanvas(1024, 1024, BLACK);
  paintLayer(cv, [{ ...finder.outer }, { ...finder.hole, cut: true }], CREAM);
  paintLayer(cv, [{ ...finder.centre }], CREAM);
  const brush = makeStroke(ICON_BRUSH.a, ICON_BRUSH.b, ICON_BRUSH.r0, ICON_BRUSH.r1);
  paintLayer(cv, [{ ...brush.grown(24) }], BLACK);
  paintLayer(cv, [{ ...brush }], YELLOW);
  return cv;
}

// The featured artwork: the same mark with the finder 520 px wide, left of
// centre and vertically centred, the brush running on past the icon's
// tail, and six square modules trailing off the tip along the stroke's own
// direction, shrinking as the trail dries out — code being painted.
function renderFeatured(ground, mark) {
  const W = 1600;
  const H = 900;
  const cv = makeCanvas(W, H, ground);
  const k = 520 / 560; // mark's 560 px finder -> 520 px
  const ox = 200 - 232 * k;
  const oy = (H - 520) / 2 - 232 * k;

  paintLayer(cv, [
    { ...placed(finder.outer, ox, oy, k) },
    { ...placed(finder.hole, ox, oy, k), cut: true },
  ], mark);
  paintLayer(cv, [{ ...placed(finder.centre, ox, oy, k) }], mark);

  // The brush runs on past the icon's tail (tip cut flat at mark x 1136).
  const brush = makeStroke(ICON_BRUSH.a, [1136, 560], ICON_BRUSH.r0, ICON_BRUSH.r1);
  paintLayer(cv, [{ ...placed(brush.grown(20), ox, oy, k) }], BLACK);
  paintLayer(cv, [{ ...placed(brush, ox, oy, k) }], YELLOW);

  // The trail, in output coordinates, along the stroke's own slope.
  const ang = Math.atan2(ICON_BRUSH.b[1] - ICON_BRUSH.a[1], ICON_BRUSH.b[0] - ICON_BRUSH.a[0]);
  const tip = [ox + 1136 * k, oy + 560 * k];
  const sizes = [60, 56, 52, 48, 44, 40];
  const entries = [];
  for (let i = 0; i < sizes.length; i++) {
    const d = 66 + 70 * i;
    const cx = tip[0] + Math.cos(ang) * d;
    const cy = tip[1] + Math.sin(ang) * d;
    const s = sizes[i];
    entries.push(roundedRect(cx - s / 2, cy - s / 2, cx + s / 2, cy + s / 2, 8));
  }
  paintLayer(cv, entries, mark);

  return cv;
}

// ---- Write the three files -------------------------------------------------

const outDir = __dirname;
const icon = renderIcon();
const kb = writePng(path.join(outDir, 'icon.png'), 1024, 1024, icon.buf) / 1024;
console.log(`brand/icon.png  1024x1024  ${kb.toFixed(1)} KB`);

for (const [name, ground, mark] of [
  ['featured-light.png', CREAM, BLACK],
  ['featured-dark.png', BLACK, CREAM],
]) {
  const cv = renderFeatured(ground, mark);
  const n = writePng(path.join(outDir, name), 1600, 900, cv.buf) / 1024;
  console.log(`brand/${name}  1600x900  ${n.toFixed(1)} KB`);
}

// A 32 px proof of the icon, to eyeball legibility at home-screen tile
// size; written only when asked for (PROOF=1) and not committed.
if (process.env.PROOF) {
  const proof = makeCanvas(32, 32, BLACK);
  const k = 32 / 1024;
  paintLayer(proof, [
    { ...placed(finder.outer, 0, 0, k) },
    { ...placed(finder.hole, 0, 0, k), cut: true },
  ], CREAM);
  paintLayer(proof, [{ ...placed(finder.centre, 0, 0, k) }], CREAM);
  const brush = makeStroke(ICON_BRUSH.a, ICON_BRUSH.b, ICON_BRUSH.r0, ICON_BRUSH.r1);
  paintLayer(proof, [{ ...placed(brush.grown(24), 0, 0, k) }], BLACK);
  paintLayer(proof, [{ ...placed(brush, 0, 0, k) }], YELLOW);
  writePng(path.join(outDir, 'icon-32.png'), 32, 32, proof.buf);
  console.log('brand/icon-32.png  proof at tile size');
}
