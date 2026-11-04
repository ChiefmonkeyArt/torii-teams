# ADR 0005: Torii's own team UI on the Cordn engine

Status: Accepted (2026-11-04, owner chose "own UI on Cordn engine").

## Context

Up to `0.6.1-torii.4`, a Torii node served cordn-web's own interface with a
project sidebar added. The owner expected a plain, white-labelled team chat,
not Cordn's full client (logo, News, coordinators, key packages, share links,
tab bar, voice notes). They also expected the roster to be the membership:
today the owner creates the project chat by hand and adds each member from a
picker that only lists people who have already signed in.

Owner decisions (2026-11-04): own UI on the Cordn engine; v1 has text chat per
project, images and files, reactions and replies (no voice notes); it runs
embedded in Continuum and full screen at `teams.<domain>`; this session owns
the work.

## Decision

In Torii builds (`VITE_TORII_NODE_BUILD=1`) the `/chat` routes render a Torii
shell instead of Cordn's. The engine (`src/lib/services`, MLS, coordinator
client, outbox, media) is unchanged; upstream-style builds are unchanged.

### Screens

- **Signed out:** the app name, one line ("Sign in so your team can add you")
  and a Sign in button. After Nostr sign-in the client signs Continuum's
  challenge straight away (no second button).
- **Signed in:** a project list (left on desktop, a top bar on phones) and one
  chat per project at `/chat/p/<slug>`. The header shows the project name,
  members, and who has not signed in yet. Nothing else: no News, settings,
  coordinators, key packages, share links, tab bar or banners.
- **Chat:** Cordn's message list and composer with Torii options: text,
  images and files, reactions, replies (and the reply thread). Voice notes,
  polls, GIF search, pins and the Actions panel are hidden. The Actions engine
  stays in the code for a later release.
- `/` and every other `/chat/*` route redirect to `/chat`. A group link
  (`/chat/<gid>`, from notifications) goes to its project, or to `/chat`.
  `?embed=1` is kept on redirects.
- Branding: tab titles and the manifest say "Teams"; Cordn's logos, store
  badges and share target are removed from the release (`scripts/torii-brand.mjs`
  in the release workflow). The credit to Cordn stays in `TORII.md` and
  `LICENSE`.

### The roster is the membership

Roster: `GET /api/projects/:slug/roster` (`roster.members[].pubkey`, owner
included, agents included).

On the **owner's** client, for each project they own (`src/lib/torii/rosterSync.svelte.ts`,
rules in `rosterPlan.ts`):

1. No project chat yet: the owner clicks "Start project chat" once. It is
   created on the node coordinator, named after the project, description
   `torii:project=<slug>`, owner as the only admin. Creation is not automatic,
   because the owner's second device has no local copy of an existing chat and
   would make a duplicate. It is single-flight per project (Web Locks where
   available) and re-checks after taking the lock, so two tabs do not make two.
2. Roster members not in the chat who have a key package on the node are
   invited in one batch. Members without one are shown as "waiting to sign
   in". A failed invite is retried after 10 minutes.
3. Members in the chat who are no longer on the roster are removed, but only
   when the roster was read successfully, still lists the owner, and the
   removal is at most half of the chat (a bad read never empties a chat).

The pass runs when projects load, when the chat's members change, when the
tab regains focus, and every 5 minutes.

On a **member's** client, a welcome is accepted automatically only when all
hold: its description carries `torii:project=<slug>` for a project in the
member's `/api/team/me`; it is on the node coordinator; its members include
that project's owner; and every member in it is on that project's roster.
Anything else is left alone. Display still goes through `matchProjectGroup`
(fails closed on look-alikes).

### Relation to ADR 0004

Supersedes ADR 0004's screens only: the chat-home reachability cards are
replaced by the sign-in copy and a "Your team can't add you yet / Fix it" note
in the project list. Kept as engine rules: `reachabilityStore.coveredCoordinatorKeys`,
the one-shot re-check, the torii.2 Cordn seed cleanup, the Cordn auto-cover
filter, and node-default create-group.

### Release and caching

`scripts/torii-brand.mjs` runs in `torii-release.yml` after the build. It fails
the release if the service worker would precache a file the release removed
(`src/lib/torii/releaseDropped.js`, shared with `src/service-worker.ts`). Before
this, releases deleted `.well-known/`, `_headers` and `_redirects` while the
service worker still listed them, so its install failed and the app had no
offline cache.

## Consequences

- Teammates only need to sign in once; the owner starts each project chat once
  and does nothing per member.
- A member with no key package on the node stays "waiting" until they sign in.
- Removal needs the owner's client to be open; until then a removed member can
  still read new messages. Continuum-side enforcement is later work.
- Images and files are still uploaded (encrypted) to Cordn's default Blossom
  servers, and profiles come from public relays. Routing both through the node
  is the next step (ADR 0003 "Not covered").
- A look-alike chat built by someone who knows the roster's public keys would
  have to include only roster members; a stranger who creates one stays a
  visible member and fails the roster check.
