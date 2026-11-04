# ADR 0002: Torii Teams inside Continuum, one channel per project

Status: Accepted by the owner on 2026-11-04 ("do all the things": ADR 0002 and
the per-project sidebar first). Builds on ADR 0001 and the access model in
torii-continuum PR #255.

## 1. Own origin, embedded

Teams stays at `https://teams.<domain>/`. Continuum moves to
`https://continuum.<domain>/` (torii-suite v0.9.31-alpha) and shows Teams in
its Team view as an iframe of `<teams_app_url>/chat?embed=1`, with an
"Open in full window" link.

- Teams keeps its own origin, so chat keys in IndexedDB and localStorage are
  out of reach of Continuum, Quest and the main host, and Continuum's owner
  token is out of reach of Teams.
- The Suite sets `frame-ancestors https://continuum.<domain> https://<domain>`
  for the Teams vhost and drops `X-Frame-Options: DENY`. No other site can
  frame it.
- When framed, the app sets `data-torii-embed="1"` on `<html>`. Chrome changes
  stay small so upstream merges stay easy.

## 2. Sign-in to Continuum from Teams

Teams signs in to Continuum with the same Nostr account the member uses for chat:

1. `POST {continuum}/api/auth/challenge` with `{}`.
2. The active signer signs kind 22242, with `content` = challenge and a
   `["challenge", c]` tag. This is one signer prompt, after the member clicks
   "Show my projects".
3. `POST /api/team/auth/verify` with `{event}` returns `{token: "m1.…", expires_at}`.

The token goes in `sessionStorage` under the Continuum origin, for that pubkey,
until `expires_at`. Requests are sent with no cookies (`credentials: 'omit'`) and
`redirect: 'error'`. A 401 clears the token and the member signs in again. Teams
never calls `/api/auth/verify`, so the owner's admin token never reaches this
origin. Until Continuum v0.2.194-alpha, the owner gets 403 `use_owner_login`
and the sidebar says so. From v0.2.194, the owner gets a scoped token through
the same route.

## 3. The sidebar is the project list

The project is the only unit of access, with 12 people at most. There is no
lobby, team-wide group or team list. On a node whose `/torii-node.json` has a
`continuum` origin:

- The sidebar shows only "Projects": one row per project in
  `GET /api/team/me`. Other groups and News are hidden.
- A row opens the project's Cordn group only if exactly one local group:
  1. runs on the node coordinator from `/torii-node.json`;
  2. has the roster owner (`GET /api/projects/:slug/roster` returns
     `roster.owner`) as a member and an admin;
  3. carries `torii:project=<slug>` as a word in its description;
  4. is not removed or poisoned.
- If the roster is unreadable, or no group or two groups match, nothing is
  opened: the check fails closed.
- With no group, the owner sees "Create project chat". This opens
  create-group with the name, the marker and the coordinator filled in.
  Members see "Waiting to be added to the chat".
- Being on a project does not by itself put anyone in its group. Joining
  still needs a Cordn invite from an admin, which is the MLS rule.

Without `continuum` in the node file, the app behaves exactly like upstream
Cordn.

## 4. Invites and notifications (next slice, 2a-3)

Continuum sends the invite as a NIP-17 DM. The DM carries hints: slug, owner
npub, coordinator, relays, group id and app origin. The join page confirms the
project through `/api/team/me` and fails closed if it does not match. The
hints never grant access. Members with Continuum see a "Shared with me"
project. Members without Continuum open `teams.<owner-domain>` and sign in
with Nostr.

## Consequences

- The marker in the description is a stopgap. When Continuum projects groups
  itself (2a-4), the group id comes from Continuum and the marker is dropped.
- A member who is not yet in the group sees the project but cannot read it.
  This is intended.
- A rogue member can make a look-alike group only on the node coordinator, and
  only with the owner as an admin. That needs the owner's own key, so the check
  holds.
