# ADR 0003: A Torii build never contacts Cordn's public coordinator by itself

Status: Accepted (2026-11-04, owner: "do all the things"; privacy-first rule).

## Context

Upstream cordn-web does three things with Cordn's public coordinator
(`DEFAULT_CHAT_COORDINATOR_PUBKEY`) without being asked:

1. It seeds that coordinator on first run (`loadCoordinators`).
2. It probes it at every login for a foreign key package (`checkMigrationBanner`).
3. It falls back to it when publishing "reachable" key packages
   (`makeReachableAction`).

Auto-publish (`maintainReachability`) then sends the member's key packages to
every known coordinator. On a Torii node, that would tell a third party which
Nostr keys use this team, and invite contact through it.

## Decision

`torii-release.yml` builds with `VITE_TORII_NODE_BUILD=1`
(`src/lib/torii/build.ts`). With the flag set:

- Cordn's coordinator is not seeded. `/torii-node.json` seeds the node's
  coordinator as the default instead (ADR 0001).
- The migration probe checks only the coordinators the member already knows.
- With no coordinator given, publishing uses the node default. If there is no
  default, it fails with a plain message instead of falling back to Cordn's.
- A profile link with no `c=` uses the node default.
- The "Join Cordn group" button is hidden. The logged-out page says
  "Welcome to your team".

A member can still add any coordinator by hand on the config page. That is
their choice and stays allowed.

Dev and test builds leave the flag unset, so upstream behaviour and its tests
are unchanged.

## Not covered

Encrypted media uploads still go to the public Blossom list in
`constants/chat.ts`. A node Blossom server is a separate decision (todo).
Profile and relay-list lookups still use public Nostr relays (relay.ditto.pub,
relay.primal.net, nos.lol and others), so those relays see which npubs the
app looks up. Routing lookups through the node relay is also a separate
decision (todo).
