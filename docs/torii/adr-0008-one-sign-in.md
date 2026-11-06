# ADR 0008: One sign-in, one Allow

Date: 2026-11-06. Status: **Proposed** (owner request, 2026-11-06: "one login
and 'Allow All' and everything just works"). Planned for `0.6.1-torii.8` with
Continuum `0.2.197-alpha` and Suite `v0.9.38-alpha`. Amends ADR 0002 (Teams in
Continuum: where the session lives) and builds on ADR 0006 (quiet signer) and
ADR 0007 (uploads use the Continuum session).

## Context

A teammate's signer is asked for four things when Teams loads (measured in the
local e2e for torii.6 and torii.7):

| Call            | Why                                                                       |
| --------------- | ------------------------------------------------------------------------- |
| `getPublicKey`  | Learn who is signing in.                                                  |
| sign kind 22242 | Continuum member sign-in (`POST /api/team/auth/verify`).                  |
| sign kind 25910 | The Cordn coordinator handshake (ContextVM message signed by the member). |
| NIP-44 decrypt  | The coordinator's encrypted reply.                                        |

After that, chat is quiet: torii.5 to torii.7 brought adds, focus, idle and
file uploads to zero signer calls. The friction is at the start, and it repeats:

1. **The Continuum session is lost with the tab.** Teams keeps the member token
   in `sessionStorage` (ADR 0002), so every new tab, and every restart of the
   browser, signs a new 22242 challenge.
2. **Member tokens cannot be renewed.** An `m1` token lives for
   `session_ttl_sec` (24 h by default) and then needs a new signature. The
   owner's admin session already slides forward without the signer
   (`POST /api/auth/refresh`, capped by `session_max_lifetime_sec`, 7 days by
   default); members have no equivalent.
3. **The owner signs in twice.** In Continuum's Team view the owner is already
   signed in to Continuum, yet the embedded Teams frame (a different origin)
   asks the signer for its own 22242 challenge.
4. **Prompts arrive one by one, unexplained.** The four calls are spread over
   the first seconds of load, each with the signer's technical wording. A
   NIP-46 signer (Amber, a bunker) asks for each permission separately.

The signer itself is not ours to change: an extension's "Always allow" is a
per-site choice the member makes, and a NIP-46 signer approves the permissions
the app asks for. What Teams controls is how many distinct things it asks for,
when, how often, and how clearly.

## Decision

**Prompt budget.** On a new device, signing in is one click and one approval
round in the signer. After that, Teams makes no new Continuum challenge until
the session's absolute lifetime ends, and the owner inside Continuum makes
none at all. These budgets become e2e assertions (see Tests).

1. **One consent step before any signer call.** Teams shows one card before it
   touches the signer: "Sign in to your team. Your signer will ask once. Choose
   'Always allow' for this site so it doesn't ask again." It has one button. All
   four calls run back to back from that click, in a fixed order
   (`getPublicKey`, 22242, coordinator handshake). Nothing calls the signer
   before the click. The card names the signer type it detects (browser
   extension, NIP-46 app) and gives the matching hint. If the member already
   has a valid session, the card is skipped.

2. **NIP-46: ask for every permission at connect.** The connect request lists
   the full set Teams needs, from one constant in the code:
   `get_public_key`, `sign_event:22242`, `sign_event:25910`,
   `sign_event:30078` (multi-device tip), `nip44_encrypt`, `nip44_decrypt`.
   The member approves once in Amber or the bunker. A test fails if Teams signs
   a kind that is missing from the constant.

3. **The session survives tabs and restarts.** The member token moves from
   `sessionStorage` to `localStorage`, under the same key (Continuum origin and
   pubkey). Sign-out, a 401, a pubkey change and the end of the session all
   delete it. This does not widen exposure to page scripts (both stores are
   equally readable by script on this origin), and since ADR 0007 the Teams CSP
   allows connections only to the node's own hosts, so a token has nowhere
   else to go.

4. **Member sessions renew silently, with a hard cap.** Continuum adds
   `POST /api/team/auth/refresh`, the member twin of `/api/auth/refresh`:
   Bearer only, rate limited on the auth budget, distinct refusal codes. It
   issues a fresh token only if the caller is still the owner or on a roster.
   Tokens gain the original sign-in time: `m2.<oiat>.<iat>.<exp>.<pubkey>.<sig>`,
   with `exp = min(iat + session_ttl_sec, oiat + session_max_lifetime_sec)`,
   which is the same rule and settings as the owner's session. Continuum
   accepts `m1` until it expires and stops issuing it. Teams renews when less
   than a quarter of the token's life is left, on load and on focus. Only
   `max_lifetime_reached` sends the member back to the signer, and then through
   the consent card.

5. **The owner inside Continuum is handed a session.** When Continuum's Team
   view embeds Teams, the Teams frame asks the parent for a session
   (`{type: 'torii:session-request', pubkey}`). Continuum's page, holding the
   owner's admin session, calls a new admin-only route,
   `POST /api/team/auth/handoff`, which issues an ordinary scoped member token
   for the owner (the same token the 22242 route would give). The page posts it
   to the frame (`{type: 'torii:session', token, expires_at, pubkey}`) with
   `targetOrigin` set to the Teams origin. Teams accepts it only if
   `event.source === window.parent`, `event.origin` equals the `continuum`
   origin in `/torii-node.json`, and the pubkey equals its signer's
   `getPublicKey`. The admin token never leaves Continuum's origin, so the
   ADR 0002 boundary holds. The owner still gets the coordinator handshake
   (calls 1, 3 and 4) once per device, through the same consent card.

6. **No new state on the server.** Tokens stay stateless HMAC. Membership is
   still checked on every call and every renewal, so taking someone off every
   roster ends their access at the next request, not at token expiry.

### Not chosen

- **A key kept in the browser** (generated nsec, a key derived from the
  signer, or a NIP-26 delegation). This would remove the coordinator handshake
  prompt, but it puts signing authority in page storage, and NIP-26 is
  deprecated and unsupported by Cordn. The member's key stays in their signer.
- **One origin for Continuum and Teams.** That would give one signer
  permission per site, but ADR 0002 keeps them apart so the owner's admin
  session can never be read from the chat app.
- **Cookies.** The Teams API stays Bearer-only with `credentials: 'omit'`
  (ADR 0002); there is no cross-site cookie to protect.
- **Skipping the signer for the coordinator.** The Cordn coordinator
  authenticates members by their Nostr key. Changing that is an upstream
  protocol change, not a Torii decision.

## Consequences

- A member signs in once per device and approves once, then is not asked to
  prove who they are again for up to `session_max_lifetime_sec` (7 days by
  default; operators can lower it).
- The coordinator handshake still uses the signer once per page load. With
  "Always allow" it is invisible; without it, the member sees one prompt per
  load, which the consent card explains. Removing it needs Cordn support for a
  session, and is a follow-up for upstream.
- A token copied from a device works until its cap or until roster removal.
  This is the same exposure the owner's session already has, with the same
  settings. A per-pubkey "sign out everywhere" is a follow-up.
- Continuum gains two routes (`/api/team/auth/refresh`, `/api/team/auth/handoff`)
  and a token format (`m2`); `/api/team/files-ok` and the file server accept both
  formats.

## Tests

- Unit (Teams): the consent card gates every signer call; token stored in
  `localStorage` and cleared on sign-out, 401, pubkey change and expiry;
  renewal timing; the `torii:session` handler refuses a wrong origin, wrong
  source and wrong pubkey; every signed kind appears in the NIP-46 permission
  constant.
- Agent (Continuum): `m2` issue, verify and renew; the cap holds across renewals;
  renewal refused once off every roster; `m1` still verifies until expiry;
  handoff needs the admin session and returns a member-scoped token; rate
  limits.
- e2e (signer counter): first sign-in has all calls inside one click; a reload
  and a new tab make 0 Continuum challenges; renewal makes 0 signer calls; the
  owner embedded in Continuum makes 0 Continuum challenges; after the cap, one
  consent card and one challenge.

## Versions

Teams `0.6.1-torii.8`, Continuum `0.2.197-alpha`, Suite `v0.9.38-alpha` (pin).
