# ADR 0025: A person's devices can sit in a room, under their name

Date: 2026-11-24. Status: **Accepted** 2026-11-24 (owner chose "Own device key"
for the Tab5 in Teams rooms). Target: `0.6.1-torii.30`. Builds on ADR 0005
(the roster is the chat membership), ADR 0016 (Your computers) and ADR 0024
(the AI member). Pairs with tab5-signer `docs/TEAMS.md`.

## Context

The Torii Companion (an M5Stack Tab5) joins Teams rooms as an MLS member. If
it used its owner's main key, adding the owner's npub could pick the browser's
key package instead of the Tab5's, its messages would look like the owner's,
and a lost Tab5 could not be removed on its own. So the Tab5 has its own key.

That key is not on the Continuum roster, and ADR 0005 removes any project-chat
member who is not. Teams needs a way to know "this key belongs to that person".

## Decision

1. **Owner note.** The owner's main key signs an event of kind **27532**:
   tags `["t","torii-teams-device"]`, `["p",<device pubkey>]`,
   `["label","Tab5"]`, empty content. It is never published to relays.
2. **Claim message.** The device sends a room message (rumor) of kind
   **1013** (`ChatKinds.DeviceClaim`, provisional like Action 1012) whose
   content is the owner note as JSON. It is hidden from the message stream
   and from search. The device resends it after joining a room and when new
   members arrive.
3. **Check.** A claim counts only when the note's signature verifies, its
   `p` tag equals the MLS-authenticated sender, and owner ≠ device. The label
   is stripped of control characters, capped at 24 characters and defaults to
   "Tab5". Rules live in `src/lib/torii/deviceClaim.ts` (tested); claims are
   kept per session in `deviceOwners.svelte.ts`, filled at ingest and from
   storage when a chat opens.
4. **Display.** A device's messages use its owner's avatar and read
   "<owner>'s Tab5". Room info shows the owner's card with a "Tab5 · device"
   pill.
5. **Seats and removal.** `peopleOnly(members, owner)` drops a device whose
   owner is also a member before roster sync, membership signals and member
   counts. So a device takes no seat and roster sync leaves it alone. If its
   owner leaves the roster, the device is no longer hidden and is removed
   with them. Continuum still caps the roster (12 people); devices are not on
   it.

## Consequences

- Anyone in a room can see which device sent a message. That is the point.
- A claim cannot be forged without the owner's main key, and a device cannot
  claim someone else, because the sender is MLS-authenticated.
- Kind 1013 and 27532 are Torii-local until upstream Cordn has an equivalent.
- An owner removes a lost device from room info like any member; nothing
  re-adds it unless the device rejoins and is added again.
