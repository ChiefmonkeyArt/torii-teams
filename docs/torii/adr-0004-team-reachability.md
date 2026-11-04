# ADR 0004: Members must sign in to be addable; tell them when they are

Status: Accepted (2026-11-04, owner approved torii.4 for deploy).

## Context

A project owner adds a teammate to the project chat from the group's member
picker. The picker only lists people with a key package on the group's
coordinator (the node coordinator). A key package is published by
`maintainReachability`, which runs only for a signed-in account.

On chiefmonkey.art, several teammates opened `teams.<domain>/chat` without
signing in. They published nothing, so the owner's picker listed one person.
Nothing on the page told them that visiting is not enough.

Two smaller gaps sat next to it:

1. The startup reachability pass can run before `/torii-node.json` adds the
   node coordinator (first visit), so the node is left unverified until the
   next daily sweep.
2. Browsers that opened `0.6.1-torii.2` still store Cordn's public
   coordinator (the "Default coordinator" seed), and any key package that went
   there kept it in the automatic pass.

## Decision

In Torii builds (`VITE_TORII_NODE_BUILD=1`):

- The logged-out page says "Sign in so your team can add you" with a
  "Sign in" button, and drops the "What is Cordn?" link.
- Signed in, the chat home shows the node coordinator's verified state
  (`src/lib/torii/teamReachability.ts`):
  - checking: "Getting you ready so your team can add you…";
  - missing (verified no key package): "Your team can't add you yet" with
    "Fix it now" (an explicit publish);
  - ready (verified served): "Your team can now add you", shown until the
    member clicks "Got it" (per member, per browser:
    `torii.teamReadyAck:<pubkey>`).
    The node coordinator is left out of the generic "not reachable everywhere"
    callout so it is not shown twice.
- `reachabilityStore.coveredCoordinatorKeys` records coordinators that
  verified a key package after the pass. Unreachable coordinators are in
  neither list, so "ready" is never shown on a guess.
- If the pass left the node unverified, the chat home re-runs it once per
  account.
- One-off cleanup: on load, the exact torii.2 seed (Cordn's key, label
  "Default coordinator", not default) is removed from stored coordinators. A
  Cordn coordinator the member renamed or made default is kept.
- The automatic pass covers Cordn's public coordinator only if it is stored
  by hand or a group lives there, not because a key package once went there.
- Create group defaults to the node coordinator when no `?coordinator=` is
  given.

Upstream-style builds (flag unset) are unchanged.

## Not covered

Roster membership still does not add people to the project chat; the owner
adds each member by npub. Roster-to-group sync is a separate decision (todo).
