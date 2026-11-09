# ADR 0015: Removal finishes before you leave

Date: 2026-11-08. Status: **Accepted** (owner, 2026-11-09, "Accept and
build"; raised 2026-11-08, asking: "Can I not
simply, as the admin/owner, just delete someone and then IF they are online
it will eventually stop working?"; then "Do 1"). Target: Teams
`0.6.1-torii.16` with Continuum `v0.2.202-alpha`. Amends ADR 0010 (the one
Teams frame) and ADR 0012 (removal while the owner is away). Keeps ADR 0003
(no upstream services) and ADR 0008 (one sign-in).

## Context

When the owner removes someone and presses **Save changes**, Continuum signs
the new member list and the person can no longer sign in or fetch the join
card. Continuum then tells its hidden Teams frame (`torii:roster-changed`),
and the owner's own Teams takes the person out of the encrypted chat at
once. That usually takes a second or two, but nothing reports back: the
status line says "Saved." before the chat step has run, and if the owner
closes the tab in that moment, the chat step waits for the next teammate to
open Teams (ADR 0012). Nobody needs to arrange anything, but the owner can't
tell whether removal is complete.

## Decision

1. **Teams answers.** After a pass started by `torii:roster-changed`, the
   embedded Teams posts `torii:roster-synced` to its parent, exact Continuum
   origin only: `{ slug, left, error }`. `left` is how many people are still
   in that project's chat but not on the signed list (never the owner);
   `error` is true when the pass failed. No names or keys in the message.
2. **Continuum waits, briefly, with words.** After a save that removed
   someone, while the frame is running:
   - status: "Saved. Taking <name> out of the chat…";
   - on `left: 0`: "Saved. <name> is out of the chat.";
   - on `left > 0`, `error`, or no answer within 20 seconds: "Saved. <name>
     can't sign in any more. Teams finishes taking them out of the chat the
     next time you or a teammate opens it."
     With several people removed, "<name>" becomes "2 people".
3. **Leaving early asks once.** While Continuum is waiting (at most 20
   seconds), closing or reloading the tab shows the browser's own "Leave
   site?" prompt. Nothing else changes: leaving still works, and the ADR 0012
   fallback still finishes the job.
4. **No frame, no change.** Without Teams on the node, or when the frame is
   not running, Save behaves exactly as today.
5. **Adds unchanged.** Only removals wait; adding people keeps its current
   wording.

## Consequences

- In the normal case the owner sees removal finish before leaving the page;
  in the rare early-close case the wording says what happens next.
- One new message type each way is checked by origin and source, like the
  existing ones. No new requests, no new dependencies, no engine change.
- Suite pins the new Teams tag; Continuum ships alongside. Deploy Continuum
  and Teams together; either alone keeps today's behaviour (an older
  Continuum ignores the answer; an older Teams never answers, so Continuum
  shows the fallback wording after 20 seconds).

## Tests

- Teams: the answer goes only to the Continuum origin, only after a
  roster-changed pass, with the right `left` count and `error` flag; no
  answer outside a frame.
- Continuum: wording for each outcome (out, still in, error, timeout, two
  people), the leave prompt only while waiting, and no wait without a frame
  or without removals.
