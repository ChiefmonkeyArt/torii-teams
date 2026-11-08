# ADR 0013: The shisa pair, one look across Teams

Date: 2026-11-07. Status: **Accepted** (owner, 2026-11-07: "I like 3a hacking
they are the most representative"; 2026-11-08: "Can you do all of it?", so
the theme wash goes in with grey themes left untinted). Target: `0.6.1-torii.14`. Amends ADR 0010
(the invite welcome art). Keeps ADR 0003 (no upstream services: art is bundled)
and ADR 0005 (Torii UI on the Cordn engine).

## Context

ADR 0010 added a shisa pair to the invite welcome: a flat cartoon pair, 40 KB,
bundled. Later art rounds tried a different style per theme, which made the
app feel like several products. The owner chose one direction instead:

- the characters: cypherpunk shisa from the future, AI on the left with its
  mouth closed (visor eyes), the human on the right laughing (headphones);
- the rendering: painted in the style of Continuum's sign-in art (soft brush
  shading, warm sunrise light, a faint neon edge), cut out with no background;
- the pose: **3a, the pair at a laptop**, as the one that best represents
  people and AI working together.

## Decision

1. **One pair everywhere.** `src/lib/torii/ui/shisa-pair.webp` is replaced by
   the painted 3a pair, 480 px wide, about 44 KB (now 40 KB). Same file name,
   same `ShisaWelcome` component, so the invite welcome and the project welcome
   pick it up with no other change. Alt text stays empty and `aria-hidden`
   (decorative).
2. **Rule kept in code.** The component comment and a test name record the
   pairing: AI left with its mouth closed, human right laughing.
3. **Theme blend (optional per theme).** A CSS layer in the theme's primary
   colour sits over the image with `mix-blend-mode: color`, masked to the
   image, at `--shisa-tint`. `shisaTint.ts` picks the strength from the
   theme's light primary: 0.35 when its HSL saturation is at least 0.2, else 0
   (Classic and Soft, whose grey primary only dulls the art; custom themes
   follow the same rule). One image file; no extra download.
4. **Motion unchanged.** The existing pop-in, bob and twinkles; none with
   `prefers-reduced-motion: reduce`.
5. **Logo and favicon: separate decision.** The flat neon heads (and heads
   under a torii) are drafts. They replace Cordn's mark only after the owner
   picks one, in the same release or a later one; 16 px reads as two
   coloured shapes.
6. **Not in this release.** Other poses (hoodies, hover-skate, the plain
   pair) and new screens (offline, chat-list avatars).

## Consequences

- Startup size: about +4 KB, loaded only on screens that show the pair.
- No new requests, no new dependencies, no change to the chat engine.
- Suite pins the new tag; Continuum is unaffected.
- The art is AI-generated; it is ours to ship, but the Plebeian P versions
  stay out until Bitko has seen them.

## Tests

- `ShisaWelcome.svelte.test.ts`: the bundled image, `aria-hidden`, empty alt,
  480x319; no wash on a grey primary; a 0.35 wash masked to the image on a
  coloured one.
- `shisaTint.test.ts`: saturation maths; Classic and Soft get 0, the six
  coloured built-in themes get 0.35.
- Checked in Chromium on all eight themes (light and two dark).
- `startupBundle.test.ts` still passes (the art stays out of the entry chunk).
