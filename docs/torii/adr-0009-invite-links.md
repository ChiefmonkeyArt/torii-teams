# ADR 0009: Invite links

Date: 2026-11-06. Status: **Accepted** (owner, 2026-11-06: "Accept ADR 0009
and implement it for torii.9"); proposed the same day ("Write the
invite-link ADR next"). Implemented in `0.6.1-torii.9` with Continuum
`v0.2.198-alpha` and Suite `v0.9.39-alpha`; see "Amendments on acceptance". Amended by
[ADR 0010](adr-0010-joining-that-works.md) (personal links straight in,
group links ask first or straight in, places default to seats left). Target: `0.6.1-torii.9` with a Continuum and a Suite
release. Builds on ADR 0002 (Teams in Continuum), ADR 0006 (membership
signals) and ADR 0008 (one sign-in). Continuum owns invites (Continuum
`docs/adr-team-collaboration.md`, "Decision: access model", 2026-11-04: "the
access model, invites (2a-3) ... stay in Continuum/Suite. The Teams app ...
handles invite links"); that document gets a matching addendum in the
implementing Continuum PR.

## Amendments on acceptance

Implementation changed four details; the rest stands as written below.

1. **One store file.** Invites live in `memory/teams/invites.json` (0600,
   atomic, expired entries pruned on write) next to the other Teams state,
   not one file per project.
2. **Peek returns names only:** `{kind, project_name, owner_name}`. No avatar:
   fetching it would be a second request keyed to a valid link, and the name
   is enough to recognise the sender.
3. **Approve after the roster.** "Let in" pushes the person onto the roster,
   signs it with the owner's signer through the existing
   `PUT /api/projects/:slug/roster` (one signature), then calls
   `decide {pubkey, approve: true}`, which refuses (`not_on_roster`) unless the
   stored signed roster already lists them. The roster stays the only grant
   and `decide` never carries an event.
4. **One more owner route:** `GET /api/team/invites/pending` returns waiting
   counts per project for the "(n waiting)" mark on the Team view picker.
   Roles are Continuum's roster roles (`maintainer`, `contributor`,
   `viewer`; default `contributor`).

In Teams the root layout reads `/chat/join/<id>#<secret>` during component
init, before any request, keeps it in this tab's `sessionStorage` (so a signer
login or reload keeps it) and rewrites the address bar to `/chat`.

## Context

Today a teammate joins a project like this:

1. The owner searches for them in Continuum (name, NIP-05 or npub) and adds
   them to the project roster. The roster is a kind 30098 event signed by the
   owner's own signer; Continuum only verifies it and holds no key.
2. The owner tells them, outside the app, to open `https://teams.<domain>/chat`.
3. They sign in (ADR 0008). Their Teams posts `ready`, and the owner's Teams
   adds them to the project chat (ADR 0006).

Three things go wrong with real people:

- **The owner must already know the person's npub.** Many people know their
  NIP-05 or nothing at all; a newcomer may not have a Nostr key yet.
- **There is nothing to send.** The owner has to explain the address and that
  "you'll get in once I've added you"; the teammate lands on a sign-in card
  with no idea which project they are joining or who asked.
- **A stranger who opens Teams fails late.** `POST /api/team/auth/verify`
  answers `not_member` only after the signer has been asked, which spends the
  ADR 0008 prompt on nothing.

The roster stays the only authority (access model, 2026-11-04). An invite link
must never put someone on a project by itself: Continuum cannot sign a roster,
and a link that is forwarded, leaked or guessed must not open a private chat or
repo.

## Decision

### Two kinds of invite, one link format

- **Named invite.** The owner picks a person first (people search, as today).
  They go on the roster at once, exactly as now. The link is only a friendly
  pointer to the right project; it carries no authority, because being on the
  roster is the authority. Opening it signs them straight in.
- **Open invite.** The owner does not know who will use it yet ("anyone I send
  this to"). Whoever opens it and signs in becomes a **join request**. They get
  in only when the owner approves, which re-signs the roster with the owner's
  signer. One link, one person by default.

Both use the same address:

```
https://teams.<domain>/chat/join/<id>#<secret>
```

- `<id>`: 12 random bytes, base64url. Opaque: it does not reveal the project
  slug, the owner or the group.
- `<secret>`: 16 random bytes, base64url, in the **fragment**, so it never
  reaches nginx logs, `Referer` headers or the service worker's request cache.
  Teams reads it with `location.hash`, sends it once in a POST body, then
  removes it from the address bar with `history.replaceState`.
- Named invites have a secret too, so every link is one shape and can be
  revoked the same way.

The earlier agreed payload (project slug, owner npub, coordinator pubkey,
relays, group id, Teams origin; Teams todo, 2026-11-04) is **dropped from the
link**. Teams already reads the coordinator and relays from `/torii-node.json`
on its own origin, and the project comes from `GET /api/team/me` after sign-in.
A link that carries nothing can leak nothing and has no hints to forge.

### Continuum: invite store and routes

Invites live in Continuum's state directory, one JSON file per project
(`team-invites/<slug>.json`), written atomically. Each entry:

| Field                      | Notes                                                                           |
| -------------------------- | ------------------------------------------------------------------------------- |
| `id`                       | As in the link.                                                                 |
| `secret_sha256`            | SHA-256 of the secret. The secret itself is never stored or logged.             |
| `kind`                     | `named` or `open`.                                                              |
| `pubkey`                   | Named only: the invited person.                                                 |
| `role`                     | Roster role to grant (`member` by default; never `owner`).                      |
| `created_at`, `expires_at` | Default lifetime 7 days, owner may pick 1 h to 30 days.                         |
| `uses_left`                | Default 1 for open invites (the owner may pick up to the project's free seats). |
| `requests`                 | Open only: `[{ pubkey, at }]` waiting for approval.                             |
| `revoked`                  | Set by the owner; kept until expiry for the audit line, then pruned.            |

Routes (all rate-limited; secrets compared in constant time):

| Route                                         | Who            | Does                                                                                                                                                       |
| --------------------------------------------- | -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /api/projects/:slug/invites`            | owner session  | Create `{kind, pubkey?, role, ttl, uses}`; returns `{url, id, expires_at}`. Refuses when the project has no free seat (12 maximum, owner included).        |
| `GET /api/projects/:slug/invites`             | owner session  | List live invites and waiting requests, with display names via the existing profile cache.                                                                 |
| `DELETE /api/projects/:slug/invites/:id`      | owner session  | Revoke. Waiting requests on it are dropped.                                                                                                                |
| `POST /api/team/invite/peek`                  | anyone         | `{id, secret}` → `{project_name, owner_name, owner_avatar, kind}` or one generic refusal. Lets Teams say who invited you **before** the signer is touched. |
| `POST /api/team/invite/claim`                 | anyone, signed | `{id, secret, event}` where `event` is the usual kind 22242 sign-in challenge. See below.                                                                  |
| `POST /api/projects/:slug/invites/:id/decide` | owner session  | `{pubkey, approve}`. Approve needs a newer owner-signed roster in the same body (the browser signs it); deny just drops the request.                       |

Claim, after verifying the challenge exactly as `/api/team/auth/verify` does:

- **Named**, and the signer's pubkey is the invited one and still on the
  roster: returns a normal `m2` member token (ADR 0008). The invite is spent.
  Any other pubkey gets the generic refusal.
- **Open**, with uses left and a free seat: records a request and returns a
  `j1` **pending token** for that pubkey and invite. `j1` is accepted only by
  `GET /api/team/invite/status`, `POST /api/team/ready` and
  `POST /api/team/auth/refresh`. Refresh exchanges it for an `m2` token, without
  the signer, as soon as the pubkey is on the roster; until then it answers
  `pending`. A denied or revoked request answers `refused`. `j1` lives as long
  as the invite and is signed with the member-token key, a distinct prefix.

Every failure (unknown id, wrong secret, expired, revoked, used up, project
full, wrong person for a named invite) returns the same `404 {code:
"invite_unavailable"}` with the same timing, so the routes are not an oracle for
which projects or people exist.

### Teams: the join screen

A new route `/chat/join/[id]` (the only new route; everything else still
redirects as in ADR 0005):

1. Read and strip the fragment, call `peek`. On refusal: "This invite no longer
   works. Ask for a new one." No signer call is made.
2. Show the ADR 0008 consent card with the invite on top: owner avatar, "Olive
   invited you to **website**". One button, one signer round (getPublicKey,
   22242, coordinator handshake), unchanged prompt budget.
3. Call `claim` instead of `verify`.
   - `m2`: store the session as in ADR 0008 and go to `/chat/p/<slug>`. The
     existing ready/added signals do the rest.
   - `j1`: post `ready` (so the owner can add them the moment they approve) and
     show "Asked Olive to let you in. You can close this page; we'll let you in
     here next time you open it." Poll `refresh` with the ADR 0008 tick (load,
     focus, 60 s), never the signer.
4. With no signer installed, the card links to a short "Get a Nostr signer"
   page (Alby, nos2x, Amber), then returns to the same invite link.

If the person is already signed in and already on the project, the link just
opens the project chat.

### Continuum: making and approving invites

- Project create ("Team chat for <name>") and the project roster panel gain
  **Copy invite link** (open) next to the existing people search (named). The
  link shows once, with its expiry, plus a QR code for phones; it is never shown
  again because only its hash is kept.
- Waiting requests appear in the roster panel and as a count on the project in
  Continuum's Team view: avatar, display name, NIP-05 if any, npub, when they
  asked and which link they used. **Let in** asks the owner's signer for the new
  roster (the same single signature as adding someone by search today);
  **Decline** needs no signature.
- Approving from Continuum's Team view adds them to the chat at once, because
  the owner's Teams is open in that frame (ADR 0006). Approving elsewhere adds
  them the next time the owner's Teams is open; that limit is unchanged and has
  its own follow-up.

### Delivery is the owner's choice

Continuum does not send invites. The owner copies the link into whatever they
already use (Signal, a Nostr DM, email, in person by QR code). Sending it as an
encrypted NIP-17 DM from the owner's signer is a later option, not part of this
decision.

## Security and privacy

- **The roster stays the only authority.** An open link can at most create a
  request; only an owner-signed roster lets anyone in. A leaked link costs the
  owner one "Decline".
- **Secrets never at rest in plaintext:** hashed with SHA-256 (128-bit random
  input, so no salt or slow hash is needed), sent only in POST bodies, stripped
  from the address bar, excluded from logs (Fastify's default request log records the
  method and path, never the body; tests assert the secret never appears in a
  log line).
- **No oracle:** one refusal code and shape for every failure; `peek` and
  `claim` share the auth rate budget per IP.
- **Seats:** creation, claim and approval all re-check the 12-person limit, so
  several open links cannot oversubscribe a project.
- **Metadata:** `peek` reveals the project's display name and the owner's name
  and avatar to anyone holding a valid link. That is the point of the link, and
  it is no more than the owner chose to share. The slug and group id are never
  shown before approval.
- **Removal is unchanged:** taking someone off the roster ends their access,
  whether they came by link or by search.

## Tests

- Continuum: create, list, revoke; named claim (right person, wrong person);
  open claim → request → approve with a signed roster → `refresh` swaps `j1` for
  `m2` with no signature; deny; expiry; used up; project full at each step; the
  same 404 body for every failure; the secret absent from the store and from
  logs; `j1` refused by every other route.
- Teams: the join route strips the fragment before any network call except
  `peek`; refusal makes zero signer calls; the consent card shows the inviter;
  `signerPermissions` still covers every signing call (no new call sites); the
  pending screen polls `refresh` only.
- e2e (local Continuum + Teams, two browser profiles): an open invite from
  first click to a message in the project chat with **one** signer round for
  the newcomer and **one** roster signature for the owner; a named invite with
  one signer round and no owner action; a forwarded link used by a third
  profile produces a request the owner declines.

## Not covered

- Adding people while the owner's Teams is closed (needs its own ADR).
- NIP-17 delivery, invite emails, and invites that create a Nostr key for a
  newcomer.
- Repo access: the roster's existing projections (2a-4) apply to people who
  joined by link exactly as to anyone else.
- Lobby or team-wide invites: never (access model, 2026-11-04).

## Consequences

- Joining becomes "open the link, press one button, approve once in the
  signer"; for open links the owner adds one approval.
- Continuum gains an invite store, six routes and a third token prefix (`j1`).
- The 2026-11-04 invite payload is retired in favour of opaque links; the Teams
  todo line is updated to match.
- Releases: Teams `0.6.1-torii.9`, a Continuum minor bump and a Suite pin,
  shipped and deployed together as in ADR 0008, after owner approval.
