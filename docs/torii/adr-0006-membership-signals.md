# ADR 0006: Membership signals from Continuum, no background signer calls

Date: 2026-11-05. Status: **Accepted** (owner, 2026-11-05). Ships in
`0.6.1-torii.6` with Continuum `0.2.195-alpha`. The full design, including the
Continuum API, is in Continuum's `docs/adr-teams-membership-signals.md`. This
records the Teams side. It amends ADR 0005 and closes the profile-lookup gap
that ADR 0003 lists under "Not covered".

## Context

Every request to the node chat coordinator is signed, and its reply decrypted,
by the user's signer; with an extension, each is a popup. torii.5 rations those
requests, so a teammate can wait up to 30 minutes to be added. Roster edits in
Continuum also went unseen until a reload. Profiles were loaded from public
relays, and avatars directly from their hosts.

## Decision

1. **Continuum is polled; the coordinator is not.** While visible, the client
   re-reads `/api/team/me` and the project rosters every 60 seconds, quietly
   (the UI never drops to a loading state). A `torii:roster-changed`
   `postMessage` from the framing page (origin must equal the configured
   Continuum host) does the same at once. No signer calls are involved.
2. **Ready is verified only.** A client posts `POST /api/team/ready` only after
   `reachabilityStore.coveredCoordinatorKeys` includes the node coordinator,
   that is, a key package confirmed on the node coordinator (ADR 0004). Never
   on sign-in alone.
3. **Owner: chats.** When a project has no Continuum chat record and no chat on
   this device, the client claims the chat, creates it, then records the group
   id; if creation fails, it releases the claim. A chat from torii.4/5 that
   exists only on this device is recorded instead. A 409 response shows "This
   chat was started on another device". "Start project chat" remains only as a
   retry after an error.
4. **Owner: members.** A coordinator call (key-package lookup and invite) runs
   only for roster members marked `ready` who are not yet in the chat. After an
   invite succeeds, the client marks them `added`. Members who aren't ready
   cost nothing and show "Hasn't opened Teams yet". Removals follow ADR 0005
   (at most half the chat), then are reported as `removed`. A failed invite is
   retried after 10 minutes.
5. **Member: joining.** For a project marked `added` with no chat on this
   device, look up welcomes and accept (ADR 0005 rules). If the welcome isn't
   there yet, retry after 1, 2, 4… up to 30 minutes. No welcome lookups
   otherwise.
6. **No public profile relays.** In Torii builds, profile (kind 0) loads go to
   `GET /api/team/profiles` and the returned signed events are added to the
   event store, which Cordn's own components read. Relay-list (kind 10002)
   lookups are skipped, and `metadataRelays` is empty. Avatars come from
   `GET /api/team/avatar/:hex` as `blob:` URLs, with initials as the fallback,
   including inside Cordn's own components.
   Torii's own components (project list, chat header, member list) always
   show avatar and display name, with a short npub as a secondary line.
   Everywhere in a Torii build the name shown is `display_name`, then
   `name`, then NIP-05, then a short npub (upstream Cordn keeps
   `name` first; `pickProfileName` in `src/lib/utils/profileName.ts`).

Signer prompts now happen only on events: page load, the owner creating a chat
or adding someone, and a member joining. The ADR 0005 pacing (`PACE_*`) is kept
only as retry backoff.

## Consequences

- Adds and joins happen within about a minute without reloads, as long as the
  owner has Teams open somewhere (only the owner's client can add to the MLS
  group).
- Browsers no longer contact public relays for profiles, or avatar hosts; the
  node agent does. Cordn's avatar spots (`ProfileCard`, `ChatGroupAvatar`,
  message items) take their image from `toriiAvatarSrc(pubkey, picture)`, which
  in Torii builds returns the proxied `blob:` URL (never the remote URL). The
  signed kind-0 events stay unmodified, because the event store verifies
  signatures.
- If Continuum is unreachable, nothing is added or removed (fail closed), and
  the chats keep working.
