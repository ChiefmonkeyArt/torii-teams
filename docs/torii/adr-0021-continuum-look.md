# ADR 0021: The project chat looks like Continuum

Date: 2026-11-12. Status: **Accepted** 2026-11-12 ("Accept and ship", after the review screens). Proposed (asked by owner, 2026-11-12: "That
looks nothing like our continuum theme", after a snapshot of the project chat
on opening; "Write the ADR as Proposed for Continuum's embedded chat theme and
header"). Target: `0.6.1-torii.22` with the next free Continuum version
(`v0.2.211-alpha` at the time of writing) and a Suite pin bump. Keeps ADR 0002,
ADR 0013 and ADR 0017; amends ADR 0017 §3 (where Your computers lives).

## Context

1. **What the owner sees.** Continuum 0.2.210 is dark brown with amber
   highlights. Its Team tab shows the project chat (this app, framed at
   `/chat/p/<slug>?embed=1`) as a light grey card with dark grey bubbles. It
   reads as a different app pasted in. Snapshot: "Project chat on opening
   inside Continuum" (local build, owner and one teammate, desktop and phone).
2. **Why.** The frame never learns Continuum's theme. It uses the person's
   Teams theme and the browser's light or dark preference (`mode-watcher`), so
   it only matches Continuum by chance, and never in Continuum's palette.
3. **Two headers.** Continuum's strip shows faces, "2 people", Add people and
   Open in full window. Straight below it, the frame repeats the project name,
   the faces, the count and Your computers. On a phone the two take a quarter
   of the screen before the first message.
4. **A stale count.** Continuum's strip counts from the signed member list, so
   for a few seconds after someone joins it still says "1 not joined yet". The
   frame knows who is really in the chat.
5. **Both sides already share token names.** Continuum's `theme.css` and this
   app's themes both use shadcn-style tokens (`--background`, `--card`,
   `--primary`, `--muted`, `--border` and so on), with a light and a dark set.

## Decision

1. **A built-in Continuum theme.** `builtin.ts` gains a `continuum` theme
   whose light and dark sets copy Continuum's `theme.css` values. When
   embedded, the frame always uses it. The page background is Continuum's
   `--card`, so the frame sits as one of Continuum's cards. Bubbles, buttons
   and the composer take their colours from the same tokens as every other
   theme; no new styling paths. It is not saved: the person's own Teams theme
   (`cordn.themeCss`) is untouched and still applies in the full window.
2. **Light or dark follows Continuum.** Only one word crosses the frame, never
   colours or CSS:
   - first paint: Continuum adds `&mode=dark` or `&mode=light` to the frame
     address, and `app.html` applies it before anything draws (no flash);
   - toggle: Continuum sends `torii:theme { mode }` to the frame. The frame
     accepts it only from the parent window at Continuum's exact origin and
     only for `dark` or `light`, as with `torii:navigate`.
3. **One header, Continuum's.** When embedded, the frame drops its header row
   (name, faces, count). Any note it carried (for example who has not signed in
   yet) shows as a slim line at the top of the chat instead. Continuum's strip
   becomes the only header: faces, count, Add people, Your computers and Open
   in full window. Your computers sends `torii:open-computers` to the frame,
   which opens the same panel as today. On a phone the strip stays one line:
   faces and count, Add people, and a More menu for the other two. The menu is
   a browser popover (top layer), since the docked frame sits above the page.
4. **A count that is true.** The frame sends `torii:members { slug, joined,
   waiting }` to Continuum when its member list changes: two numbers, no keys.
   Continuum shows these in the strip in place of its own estimate, falling
   back to the estimate until the first message arrives.
5. **Pure rules, tested.** The theme choice, the mode check and the new
   message checks live in `embed.ts` next to `navigateTarget`, and are
   unit-tested; the shell only connects them.

## Consequences

- The Team tab reads as part of Continuum, in both its light and dark modes.
- One header row less above the chat on desktop, and two on a phone.
- The palette is copied, so it can drift. A Teams test pins the copied values,
  and a comment in Continuum's `theme.css` will name `builtin.ts` as the other
  place to update.
- Teams themes and the theme editor no longer affect the embedded chat. They
  still apply in the full window and on a phone outside Continuum.
- Three new frame messages (`torii:theme`, `torii:open-computers`,
  `torii:members`), each origin-checked both ways. None carries a key or a
  name.

## Not in this ADR

- Opening at the latest message rather than the "New messages" line.
- Reloading the Team tab on a phone briefly saying "No project with that slug".
- Cordn extras such as search, voice notes and a group picture.

## Test

- Unit (Teams): `embed.test.ts` for the mode from the address, `torii:theme`
  from the wrong origin, window or value (ignored), `torii:open-computers`
  and the `torii:members` counts; `themes.test.ts` pins the Continuum values.
- Unit (Continuum): `teams-frame` adds `&mode=`, sends `torii:theme` on
  toggle and `torii:open-computers` on click, and uses `torii:members` counts
  only from the frame's origin.
- e2e (local build, owner and member): the Team tab in dark and in light,
  desktop and phone, has one header and the frame's colours match Continuum's;
  toggling the theme changes the frame without a reload; the count changes
  from "1 not joined yet" to "2 people" when the member joins; Your computers
  opens from Continuum's strip.
