# QR STUDIO — notes for Claude Code

This app runs on **Homeroom**. If you're Claude Code
editing this repo, read the platform conventions before making
changes:

**Platform conventions (authoritative, always current):**
https://app.onhomeroom.com/claude.md

Fetch that URL at the start of each session — it's the single source
of truth for platform-wide behavior (auth model, `USERNODE_ENV`,
public/private tables, "don't `git push`", etc.). The hosted copy is
updated in place when platform rules change, so fetching it gives you
today's rules, not a stale snapshot.

When running inside Homeroom's dev-chat, those same conventions are
already injected into your system prompt, so the fetch is a no-op in
that path — but it's the right reflex when someone runs Claude Code
against this repo locally or from another harness.

## Connector permission prompts

This repo ships `.claude/settings.json`, which allows the **read-only**
Homeroom connector calls (`mcp__homeroom__get_*`,
`…__list_*`, `…__whoami`) so they stop prompting one at a time. Everything
that acts — filing a request, opening or advancing a proposal — still asks.
Claude Code applies those rules only after you accept the
workspace trust dialog, which lists them for review. See `.claude/README.md`
for the whole story, including what to do if you are still being prompted
(usually: your connector is registered under a different name than the rules
assume).

## Check that this checkout is current

You may be working in a fork of this app whose `main` is behind the app's
canonical repository, and nothing in the checkout says so: `git fetch origin`
compares the fork with itself. This matters before you **read** code to answer
a question about how the app behaves now, not only before you edit it.

The canonical repository is named in `.claude/homeroom-canonical-repo`. Check against
it, not against `origin`:

```sh
git fetch "$(cat .claude/homeroom-canonical-repo)" main
git merge-base --is-ancestor FETCH_HEAD HEAD && echo current || echo behind
```

`behind` means this checkout does not contain the canonical `main`. To answer
a question, read the canonical code instead (`git show FETCH_HEAD:<path>`,
`git grep <pattern> FETCH_HEAD`). To change code, start from the exact base
commit your Homeroom work order gives, and never merge or rebase onto the
canonical `main` yourself: which commit a change is diffed against decides
what the group votes on. With the Homeroom connector, `get_checkout_status`
answers the same question.

A session-start hook (`.claude/hooks/homeroom-freshness.sh`, see `.claude/README.md`) runs
this check for you and tells you when you are behind. It is silent offline, so
its silence is not proof the checkout is current. Inside Homeroom's dev-chat
the platform fixes the base commit, and none of this applies.

## Starter template

The starter template screen has been replaced: the first real version is
QR Studio itself (see About). What still holds from the template:

- Keep the `usernode-dev-console@1` forwarder `<script>`, the bridge
  `<script>` and the theme `<script>` in `public/index.html` — they are
  platform infrastructure, not template content.
- The screen has a light and a dark look and follows the viewer's Homeroom
  theme, switching live when they change it. Give everything both looks
  (the design kit's colour tokens carry both), unless one fixed look is
  the point of this app; then say so under "## Design" below. Unless a
  request asks for one, add no theme picker: the viewer's Homeroom
  setting is the control. "The platform's light/dark theme inside the app
  frame" in the platform conventions has the details.

If a rule below this line conflicts with the hosted conventions, the
hosted conventions win. This file is **app-specific** — write down
things about *this* app that belong in the repo: product intent,
data-model quirks, style preferences, opt-in policies (e.g. which
tables you've marked private), etc.

---

## About QR STUDIO

Make QR codes from links, text or contacts. One screen: pick what the code
is for (a link completed to `https://` for you, any text, or a small
contact card encoded as vCard 3.0), tap Generate, and a scannable code
appears in a scanner-style frame; Download PNG saves it. The whole point
is privacy: encoding happens on the device in `public/qr.js` and nothing
typed is stored — the app has no database tables at all.

## Design

This app's look. Every later change follows it, and updates it when a
request changes the look on purpose.

- **Palette:** a near-white green-grey world (`ground` 244 245 243 /
  14 16 15) with a single ink accent — `accent` equals `fg`, so the only
  strong colour on screen is the scanner green (`scan` 21 128 61 /
  74 222 128) of the corner brackets and focus ring. Neutrals: surface,
  raised, muted, line all carry a slight green cast.
- **Signature element:** the scanner frame — a 264px square with four
  green corner brackets, like a barcode scanner's viewport. The QR square
  inside is white with a 4px radius.
- **Type scale:** `text-title`, `text-heading`, `text-body`, `text-small`
  (change their sizes in `tailwind.config.js` if you must, not their
  number). The title is weight 750 with -0.02em letter spacing, system
  sans throughout.

The kit is in `styles/tailwind-input.css`: colour tokens with a light and
a dark value (named in `tailwind.config.js`), and a few components
(`btn-primary`, `btn-secondary`, `field`, `list` and `list-row`,
`card`, `section-label`, `skeleton`, `state-empty`, `state-error`).
Re-theme by changing the token values there, keeping every text pair at
4.5:1 or more in both looks.

- Colour comes only from the tokens (`bg-ground`, `bg-surface`,
  `text-fg`, `text-muted`, `border-line`, `bg-accent` with
  `text-on-accent`, ...): never a raw hex value or a stock palette class.
- Tap targets are at least 44 px; the buttons and fields already are.
- A field's label says what it is; its placeholder, if any, is an example
  that says so ("e.g. 5.0"), never a bare value that could pass for one
  already entered.
- Every screen that loads data has honest loading, empty and error states.
  Never show the empty state while loading or after a failure; an error says
  what failed, what still works, and offers Retry.
- Seed obviously fake staging demo data so the populated screen can be seen
  ("Staging mock data" in the platform conventions).
- No cards in cards, no uppercase eyebrows, no emoji as icons.

## App-specific conventions

- No database tables. Nothing a person types is stored or sent anywhere;
  don't add persistence without a request that clearly wants it, and say
  so to the requester when it would change the privacy story.
- The QR encoder lives in `public/qr.js` on purpose — don't add a QR npm
  package or a server-side encoding route. It is covered by
  `test/qr.test.js`.
- The QR itself is always `qr-ink` on `qr-paper` (black on white) in both
  looks, so cameras can always scan it; only the page around it re-themes.
- PNG downloads are drawn on an offscreen canvas at up to 1024px; keep
  the four-module quiet zone in them.
- Run `npm run build` after touching `styles/tailwind-input.css`,
  `public/index.html` or `public/*.js` — the served stylesheet is
  precompiled from them.
