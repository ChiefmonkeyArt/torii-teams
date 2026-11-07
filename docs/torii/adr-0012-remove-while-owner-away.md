# ADR 0012: Removing people while the owner is away, invite QR codes, a lighter app

Date: 2026-11-07. Status: **Accepted** (owner, 2026-11-07: "Do 1,2 and 6",
choosing from: 1 the invite quick wins, 2 "removing people while you're
away", 6 the speed and size pass). Target: `0.6.1-torii.13` with Continuum
`v0.2.201-alpha` for section 1. Amends ADR 0011 (joining while the owner is
away) and ADR 0006 (membership signals). Keeps ADR 0003 (no upstream
services) and ADR 0008 (one sign-in).

## Context

Since ADR 0011 nobody has to be online for a newcomer to get in. Removal
still needs the owner's own Teams client: every member's client rejects a
Remove from anyone but the group admin (`chatAdminPolicy.ts`). The owner
signs the new member list in Continuum, but the Remove itself waits for the
owner's Teams client to run its next pass. If the owner closes the tab
first, the removed person keeps reading new messages until the owner comes
back, which can be days. Continuum already blocks their sign-in and their
join-card fetch; the encrypted chat is the gap.

Two smaller asks sit beside it: invite links that are easy to hand to a
phone, and an invite step when a project's chat is created. A standing rule
asks for efficiency, security, file size and speed improvements.

## Decision

### 1. Invite links: a QR code, and invites when a chat is created (Continuum)

- Every link Continuum shows (an "Add person" personal link or a group link)
  gets **Show QR**, drawn in the browser by Continuum's bundled QR encoder
  (`src/views/qr.js`). Nothing is sent anywhere; the link stays on the page.
- The new-project "Team chat" dialog gains a second step after "Create
  chat": each picked person's own link (Copy, or Show QR), an optional
  ask-first group link, then **Open chat**. Without invite links on the node
  it opens the Team page straight away, as before.
- "Let in" now says the person can open the chat now (ADR 0011 made that
  true).

### 2. Any member's client may remove people the owner took off the list

A member's client may commit a Remove for someone who is in the chat but
not on the owner's newest signed member list. The commit carries the
proof in its authenticated data: the owner-signed roster event (kind
`30098`), unchanged, behind the prefix `torii-remove/1\n`.

Every member's client, before applying a Remove or settings change from a
non-admin, checks using only the commit and the group's own state (so all
clients reach the same answer):

1. The roster is signed by the group's admin (`adminPubkeys[0]`), is kind
   `30098`, and its `d` tag is the group name (the project slug).
2. It is not older than the group's member-list floor (ADR 0011 §4).
3. The committer is listed on it (`p` tag).
4. The commit holds only Removes, plus at most one settings change.
5. Nobody removed is listed on it, nor is the admin, nor the committer.
6. The settings change, if any, only raises the floor to that roster's
   `created_at`: the group metadata is otherwise identical, and every
   other group extension is unchanged. It is required when the floor is
   lower than that `created_at`, so the door closes behind the removed
   person for every later joiner, exactly as when the owner removes.

A commit that fails is skipped, like an unauthorised admin action today.
The check sits beside the ADR 0011 join check on the one path that
processes every MLS message. It only ever turns the admin policy's
"reject" into "accept"; it never weakens anything else (the sibling-skip
and the join check still run first).

Who acts, so that members don't all race:

- The owner's client still removes first, as now.
- A member's client acts only on people missing from the node's member
  list (which includes people let in by a straight-in link who aren't on a
  signed list yet), and only when the node's signed roster also leaves them
  out.
- It waits 2 minutes after that roster was signed, plus 1 minute per place
  in the sorted list of remaining members, so usually one client acts and
  the rest see the person already gone.
- It never removes more than half the chat at once (same rule as the
  owner's client), and remembers each attempt for 10 minutes.

### 3. Speed and size

A measured pass over the Teams build: no behaviour change, no new
dependency, no outside requests. Measured on the release build
(`VITE_TORII_NODE_BUILD=1`), opening `/chat` before any cache:

| What                        | Before                 | After               |
| --------------------------- | ---------------------- | ------------------- |
| Start-up files (raw)        | 1,839 KB               | 1,808 KB            |
| Start-up files (gzip)       | 577 KB                 | 565 KB              |
| Bytes sent on the live node | about 1.8 MB (no gzip) | about 565 KB (gzip) |

Changes:

- **The node sends files gzipped (Suite).** The live Teams host sent every
  file uncompressed. The Suite installer now writes a `.gz` copy of each
  text file in the release once, at install, and the vhost has
  `gzip_static on; gzip_vary on;`. No per-request work; static files carry
  no secrets, so compression adds no BREACH-style risk. Biggest win: about
  a third of the bytes on a first visit or after each update.
- **QR scanner on use.** `qr-scanner` loads when a scan starts, not at
  start-up (about 15 KB of code).
- **Camera web components after first paint.** The `@ionic/pwa-elements`
  loader is imported inside `onMount` (about 16 KB of code).
- A guard test (`startupBundle.test.ts`) fails if either comes back as a
  static import.

Looked at and left alone:

- Cordn's News feed (about 28 KB) is never shown in Torii builds but still
  loads: Rolldown puts it in a chunk shared with live code whatever the
  side-effect or chunk settings. Removing it needs a change to upstream's
  News code; not worth the divergence for 5%.
- The engine (MLS, coordinator client with its MCP SDK and zod, about
  170 KB gzip) is needed before the first message, so it stays eager.
- The service worker still pre-caches the whole build after the first
  load, in the background; it doesn't slow the first screen.

## Consequences

- Taking someone off a project closes the chat to them within minutes
  whenever any teammate's Teams is open, not only the owner's.
- The owner's signature is still the only authority for who belongs: a
  member can only remove people that the owner's newest list (as served by
  the node) leaves out.
- A member could use an older signed list (still above the floor) to remove
  someone added after it. That is a nuisance, not a breach: the person can
  let themselves back in with the newer list (ADR 0011), and the honest
  client never does it. Members are people the owner chose; this is the
  same trust as letting them post.
- Someone let in by a straight-in link isn't on a signed list until the
  owner's next save. Honest clients leave them alone (the node lists them);
  a dishonest member could remove them, and they would rejoin with the
  grant.
- A removal by a member shows as "X removed Y" in the chat.
- Diverges from upstream Cordn in one more place, in Torii's own code
  (`src/lib/torii/memberRemoval.ts`), and changes nothing for groups that
  don't use it.
