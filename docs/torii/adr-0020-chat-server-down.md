# ADR 0020: Say when the chat server is down

Date: 2026-11-11. Status: **Accepted** (owner, 2026-11-11: "Accept, ship and deploy"; asked by owner, 2026-11-11: "do all
the things", after a live test with Bekka where typed messages never reached
the other screen). Target: `0.6.1-torii.21` with Suite `v0.9.69-alpha`
(Suite ADR 0005, which keeps the server up). Keeps ADR 0004 and ADR 0018.

## Context

1. **What happened.** The node's coordinator was stopped for about 12 hours
   (a failed nightly backup did not start it again; Suite ADR 0005). Both
   people could type and send, and each message showed in their own chat as
   usual, so nothing told them it had not been delivered.
2. **Reproduced locally** (owner and member in one project chat, then the
   coordinator stopped): the sent message appears in the sender's chat with
   only a small clock icon, and for two minutes nothing else on screen
   changes. Once the coordinator was back, the waiting message went out.
3. **The client already knows.** Every coordinator request has a 20 s limit.
   A request that gets no answer marks the coordinator `degraded` in
   `coordinatorHealth.svelte.ts`, and the next successful call marks it
   `healthy` again. Only network-type failures count, and failures in a
   hidden tab are ignored, so a healthy server is not reported as down.
4. **A misleading prompt.** While the server is unreachable, the "Your team
   can't add you yet / Fix it" bar (ADR 0004) can show. Fix it cannot work
   and suggests the wrong cause.

## Decision

1. **Banner.** When the node coordinator is `degraded`, the chat pane shows
   "Chat server is down. Messages won't send until it's back." at the top,
   above the reconnecting note (which it replaces) and below the signer note.
   It clears on the first successful coordinator call. No new polling: the
   existing reads and the stream keepalive already notice both changes.
2. **No Fix it while down.** The "Your team can't add you yet" bar (sidebar
   and chat pane) is hidden while the banner shows.
3. **Pure rules.** `serverDown.ts` holds both rules, unit-tested; the shell
   only connects them to the stores.
4. **Continuum.** The project chat inside Continuum is this app embedded, so
   Continuum gets the banner with no change of its own.

## Consequences

- People see straight away that messages are not going out, and why.
- A single unanswered request shows the banner until the next success,
  usually within a minute. That is the honest state: the last request failed.
- Messages typed while the server is down still wait with the clock icon
  and go out when it is back, as before.

## Test

- Unit: `serverDown.test.ts` (unknown, healthy, degraded; no node).
- e2e (local node build, owner and member): the coordinator is stopped after
  messages flow; the banner appears within 30 s of a send; the coordinator is
  restarted; the banner clears; the next message reaches the member.
