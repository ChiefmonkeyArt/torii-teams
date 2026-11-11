# ADR 0019: Added in seconds, and no session key needed

Date: 2026-11-11. Status: **Proposed** (owner, 2026-11-11: "can you finish
these off", about "adding a member takes about 60 seconds" and "Teams still
needs a signature when a welcome check is due or a key package is
published"). Target: `0.6.1-torii.20` with Suite `v0.9.63-alpha`. Amends
ADR 0006 (quiet 60 s roster poll). Keeps ADR 0005, ADR 0008 and ADR 0018.

## Context

1. **The 60 s add.** In the two-person test the member reported ready in
   1 s, but the owner's client only read Continuum's signals on its 60 s
   pass (ADR 0006), so the add landed after about 58 s. In an earlier
   measurement the member's ready report also seemed to be lost. That was the
   test harness: it started the coordinator before the relay was listening,
   so the coordinator subscribed about 9 s late, the first requests went
   unanswered, and the client's 60 s read backoff did the rest. A
   long-running node does not do this. The harness now waits for the relay
   and the coordinator.
2. **The signatures left after ADR 0018.** Measured on a fresh identity with
   the fixed harness: the first sign-in signs the Continuum login (kind 22242) and publishes the key package once (`kp_publish`); after that, four
   reloads and 70 s of open page made **0** signer calls. The other
   signatures only happen on real events: being added (accepting the
   welcome) and the owner adding someone. Each one is the user's own key
   acting on their own membership, so a coordinator session key would not
   remove any of them.

## Decision

1. **Quick check while someone waits.** While a teammate on a project you
   own is not in its chat yet, the owner's client checks Continuum every
   15 s (`OWNER_QUICK_MS`). This lasts for 15 minutes (`OWNER_QUICK_FOR_MS`)
   after the waiting list changed or the page opened, then the 60 s pass
   carries on. Visible tabs only. The check is the existing quiet refresh
   (`/api/team/me` and the rosters, bearer only); the coordinator, and so
   the signer, is asked only once someone has reported ready. Pure rules in
   `rosterPlan.ts` (`waitingKey`, `ownerQuickCheckDue`).
2. **No session key.** The ADR 0018 follow-up ("needs Cordn session
   support") is closed: what still signs is first sign-in and real
   membership changes, which should be signed by the user.

## Consequences

- Owner add after the member signs in: 58 s → 13 s in the two-person e2e
  (join, messages both ways, names and avatars, no external hosts).
- At most 4 extra small Continuum reads a minute per open owner tab, for
  15 minutes after a change. Those routes have no rate limit.
- Signer calls: unchanged at 0 per reload and 0 during the quick checks.
- Tests: `rosterPlan.test.ts` (waiting key, 15 s / 15 min window, nobody
  waiting).
