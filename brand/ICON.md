# QR Studio brand images

Generated, not drawn by hand: `node brand/render.js` from the repo root
regenerates every PNG here. `test/brand.test.js` pins the files, their
dimensions and the pointer in `dapp.json`.

## The mark

A QR finder square — the square-in-a-square that sits in every QR code's
corner — crossed by a paintbrush stroke rising gently left to right. It
says what the app does (codes) and how it feels to use (a quick mark of
your own, nothing stored). One glyph, flat, no text, readable at home
screen tile size: the finder keeps its centre square clear of the brush so
the ring reads even at 32 px, and the brush is a single tapered band with
a round handle cap and a flat tip.

## Colours

Homeroom brand framework palette only:

- Black `#000000` — the icon tile; the featured-light mark
- Cream `#FFFEEA` — the finder on the icon; the featured-light ground
- Yellow `#FFEE6F` — the brush stroke

The icon is the Black + Yellow pairing with Cream for the finder. The
featured pair is the Cream + Black pairing, one image per look, with the
same yellow brush in both.

## Files

| File | Size | What |
| --- | --- | --- |
| `icon.png` | 1024x1024 | App tile, black ground; referenced by `icon.image` in `dapp.json`, with the 🔳 emoji kept as fallback |
| `featured-light.png` | 1600x900 | Directory artwork for the light look: cream ground, black mark, brush trailing six shrinking modules |
| `featured-dark.png` | 1600x900 | Same composition for the dark look: black ground, cream mark |

## Notes for the next change

- The renderer is hand-rolled (no image library in the sandbox): shapes
  are rasterised with 4x4 supersampling and written as RGB PNGs via
  `zlib.deflateSync` and a manual CRC32. Edge pixels are linear blends of
  the two palette colours that meet, so no stray hue appears.
- `PROOF=1 node brand/render.js` also writes `icon-32.png`, a tile-size
  proof for eyeballing legibility. It is not committed; delete it after
  looking.
- Geometry lives on the icon's 1024 grid in `render.js` (`finder`,
  `ICON_BRUSH`); the featured images reuse it through `placed()` at their
  own scale, so changing the mark changes all three files together.
- These images follow the Homeroom brand framework at the group's request
  rather than the default icon style.
