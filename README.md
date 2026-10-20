# QR Studio

Make QR codes from links, text or contacts, right in the browser. Type or
paste, and a scannable code appears in a scanner-style frame as soon as you
stop typing; **Download PNG** saves it as an image.

## How it works

- **One screen, three modes.** A Link / Text / Contact switch picks what
  the code is for: a web address (typed without `https://` is completed
  for you), any text, or a contact card (name plus phone and/or email,
  encoded as a vCard so a phone's camera offers to save the person).
- **Everything happens on the device.** The QR encoder is this app's own
  code in `public/qr.js` — no package, no API call, no database. Nothing
  you type is stored or sent anywhere; the app has no tables at all.
- **Always scannable.** The code is drawn black on white with a four-module
  quiet zone in both the light and the dark look, so a camera always reads
  it. Error-correction level M, versions 1–40, up to 2,331 bytes per code.

## Files worth knowing

- `public/qr.js` — the QR Code (Model 2) encoder, self-contained.
- `public/app.js` — the screen: mode switching, validation, canvas
  drawing, PNG download.
- `server.js` — the platform shell plus `GET /api/demo`, which only on
  staging (with `?demo=1`) returns sample content so the populated screen
  can be seen.

## Developing

```sh
npm ci --include=dev
npm run build   # compiles styles/tailwind-input.css to public/tailwind.css
npm test        # unit tests for the QR encoder
node server.js  # run locally
```

To change this app, ask Homeroom bot: open the app on Homeroom, tap the
Homeroom icon in the header, then **Suggest an improvement**, and describe
the change in plain English. Claude Code can also be run against this repo
directly; start with `CLAUDE.md`, which carries the app-specific notes and
points at the platform rules.