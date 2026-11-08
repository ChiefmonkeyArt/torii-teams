# ADR 0014: Shisa logo and favicon

Date: 2026-11-08. Status: **Accepted** (owner, 2026-11-08: "Paint a simpler
favicon and fix the torii in the logo", then "Write the ADR for the logo and
favicon and build torii.15"). Target: `0.6.1-torii.15`. Amends ADR 0005 (the
release white-label step) and closes item 5 of ADR 0013. Keeps ADR 0003 (no
upstream services: every icon is bundled).

## Context

Since ADR 0005 the release step (`scripts/torii-brand.mjs`) replaces Cordn's
icons with a plain white "T" on dark grey, generated at build time. ADR 0013
gave Teams one painted shisa look but left the logo and favicon open. The
owner reviewed two sets: flat neon heads under a torii (wrong crossbars, old
style) and the painted pair under a torii at dawn (right style, too busy at
16 px). They chose the painted style with a simpler favicon and a corrected
torii.

## Decision

1. **Favicon and install icons: the two painted heads.** AI on the left with
   its mouth closed, human on the right laughing, large on a plain dark tile
   (`#0d0a1d`), no torii, sky or headphones. Files live in
   `scripts/torii-brand/` and the release step copies them over the upstream
   ones: `pwa/icon-192.png`, `pwa/icon-512.png`, `pwa/apple-touch-icon.png`,
   and `pwa/maskable-icon-512.png` (heads at 76% so they sit inside the
   maskable safe circle). PNGs are 256-colour.
2. **`/favicon.svg` stays the path.** It becomes an SVG holding a 48 px PNG in
   a rounded clip (about 4 KB), so the tab icon, the unread-title code and the
   notification icon all keep pointing at `/favicon.svg` with no code change.
   Sharp up to 24 px on a 2x screen.
3. **Logo: the painted pair in front of a correct torii.** Two straight
   pillars with dark bases, a curved top lintel with a straight beam under it,
   one short centre strut, and a lower tie beam through both pillars. Shown
   at 128 px above "Teams" on the plain sign-in card only (no invite, not
   inside Continuum): `src/lib/torii/ui/shisa-logo.webp`, 256 px, about 30 KB.
   An invite already shows the 3a pair (ADR 0013), and inside Continuum the
   frame has its own header, so neither gets the logo.
4. **Sidebar mark.** The "Teams" heading in the project list (standalone
   only) gets the favicon at 20 px beside it, reusing `/favicon.svg`, which
   the tab has already loaded.
5. **Install splash.** The manifest's `background_color` and `theme_color`
   become the icons' own `#0d0a1d` instead of `#111827`, so the splash and the
   icon match.
6. **Install icons are not precached.** `RELEASE_NOT_PRECACHED = ['/pwa/']`
   (beside `RELEASE_DROPPED_PREFIXES`): the files ship, but the service
   worker skips them, because the browser fetches them itself when someone
   adds Teams to a home screen. The release step fails if the service worker
   was built without that list.

## Consequences

- First visit: about +34 KB (logo 30 KB, favicon 4 KB). The 265 KB of install
  icons download only when someone installs Teams.
- No new requests, no new dependencies, no chat engine change. Upstream Cordn
  builds keep their own icons; only the Torii release step swaps them.
- iOS rounds the 180 px icon itself; Android uses the maskable one.
- Suite pins the new tag; Continuum is unaffected.
- The art is AI-generated. The Plebeian P versions stay out until Bitko has
  seen them.

## Tests

- `toriiBrand.test.ts`: the four install icons are the committed files at the
  right sizes; `favicon.svg` embeds the committed PNG, makes no outside
  request and stays under 5 KB; the manifest colours are `#0d0a1d`; the step
  fails when the service worker would precache `/pwa/`.
- `TeamSignIn.svelte.test.ts`: the plain sign-in shows the logo (decorative,
  empty alt) above "Teams"; no logo inside Continuum or with an invite.
- Checked in Chromium on a real release build: sign-in card, favicon at 16 to
  128 px on dark and light, no `/pwa/` in the service worker cache, no
  outside requests.
