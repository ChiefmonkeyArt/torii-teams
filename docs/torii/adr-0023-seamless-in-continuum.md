# ADR 0023: The project chat feels like part of Continuum

Date: 2026-11-12. Status: **Accepted** 2026-11-12 after a local review of the
build (owner: "Accept and ship"). Target: `0.6.1-torii.25`. Proposed (owner, 2026-11-12: "Do all the things
1-9 … make the message say 'Loading Project' … is it worth having a loading
bar or circle … Do a nice animation"; earlier: "Cordn's integration must be
seamless"). Amends ADR 0005 (voice notes) and ADR 0021 (the frame's look).
Pairs with Continuum `docs/adr-seamless-team-chat.md` and Suite ADR 0006.

## Context

After ADR 0021/0022 the framed project chat matches Continuum's colours, but it
still behaves like a separate app: it opens at the "New messages" line, it
reads as read while hidden, its font and composer differ from Continuum's
assistant bar, it flashes "You're not on this project", "N not joined yet" and
"Fix it" before it knows, and Continuum cannot show an unread count, a search
button or a ready state because Teams never says them.

## Decision

1. **Open at the latest message.** The project chat opens at the bottom. The
   "New messages" line still marks where your unread messages start
   (`markerCursor`, separate from the focus cursor). Other Cordn chats keep
   open-at-first-unread. A hidden frame doesn't paint, so its follow-the-bottom
   scroll stalls; shown again after being left at the bottom, the chat goes
   back to the latest message and the line moves to the first message that
   arrived while it was hidden.
2. **Read only while seen.** A message counts as read only while the page is
   visible and, inside Continuum, while Continuum shows the frame
   (`torii:visible { on }`). The last report is applied when it shows again.
3. **One font.** Inside Continuum the frame uses Continuum's font stack
   (`system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial,
sans-serif`). Bubbles stay at 14px (`text-sm`), like Continuum's chat input.
4. **Unread counts out.** The frame posts `torii:unread { counts: {slug: n} }`
   (numbers only) whenever a project's unread count changes.
5. **Ready out.** The project page posts `torii:ready { slug }` once it shows
   its real state, so Continuum can hold its own loading animation until then.
6. **No false states.** "You're not on this project" shows only once the
   project list has loaded; before that the page shows "Loading project" with
   an animated ring. "N not joined yet" and "Fix it" show only after they have
   held for 3 s (they hide at once), and `torii:members` waits for the same.
7. **Composer like the assistant bar.** Inside Continuum: `[+] [box] [Send]`,
   40px tall, 10px corners, a "Send" label, and no expand chevron (the box
   still grows as you type). Theme CSS hooks, like ADR 0022's `chat-own`.
8. **Search from Continuum.** `torii:search` opens the chat's own search
   (ChatSearchBar, scoped to the project). Standalone, the header gets the same
   search button.
9. **Voice notes in project chats.** Reverses ADR 0005's "no voice notes":
   hold-to-record shows when the box is empty, as in Cordn. Inside Continuum
   the frame needs `allow="microphone"` and the Suite headers must delegate
   the microphone to the Teams origin (Suite ADR 0006).
10. **Group icon.** Standalone, the project header shows the chat's group icon
    beside its name. Inside Continuum the strip already names the project, so
    no second icon.

## Consequences

- Continuum must send `torii:visible`, and can now show unread badges, a search
  button and a ready animation; older Continuums ignore the new messages, and
  an older Continuum that never sends `torii:visible` is treated as visible.
- The browser asks for the microphone only when someone holds the mic.
- New messages are pure, origin-checked rules in `embed.ts`, with tests.
- Found in review: the delayed "Fix it" now reads the chat-server health
  eagerly, so it is skipped until the server key is known (the lookup throws on
  an empty key); and the unread effect reads its reactive inputs before the
  plain Continuum client, so it re-runs once that client exists.
