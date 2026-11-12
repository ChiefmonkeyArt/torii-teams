# ADR 0022: Your own messages are a soft amber inside Continuum

Date: 2026-11-12. Status: **Accepted** 2026-11-12 ("Yes that looks much better… apply all the changes", after the review screens). Proposed (owner, 2026-11-12: "The orange reply
boxes on the dark theme are a bit too bright and the orange reply boxes on the
light theme are a bit too dark they really stand out on both versions of the
theme").

## Context

ADR 0021 made the framed chat use Continuum's palette, with your own messages
in solid `primary` (amber #f6ae31 dark, #e18b09 light). Next to Continuum's
calm cards they are the loudest thing on the page. Continuum's own assistant
chat draws your messages as a tinted pill: `primary` at 10%, a 28% `primary`
border, normal text (`src/styles/chat.css`, `.chat-msg.user .bubble`).

## Decision

1. Inside Continuum only (the built-in Continuum theme, `softOwnBubbles`), your
   own messages are a soft tint: `primary` mixed 14% into the chat background,
   a 42% `primary` border, and the normal text colour. Light: #fbefdd on white,
   border #f2ce98. Dark: #40331f on #221f1c, border #7b5b25.
2. How: own bubbles carry a `chat-own` class; the theme CSS redefines
   `--primary` and `--primary-foreground` inside it. Tailwind's inline theme
   variables mean every primary utility inside the bubble (links, ticks,
   quotes, file chips) follows with no other change.
3. A failed send keeps today's look (solid, red border) so it still stands out.
4. Standalone Teams themes are unchanged.

## Consequences

- One hex rule in `themeCss` (`mixHex`); `app.html` carries the same string
  for the first paint (embedLook.test.ts keeps them equal).
- Text on the tint passes AA in both modes (tested).

## Tests

`src/lib/themes/softOwn.test.ts`: `mixHex`, only Continuum has the rule, AA
on the tint, the hook is on own bubbles and not on failed sends.
