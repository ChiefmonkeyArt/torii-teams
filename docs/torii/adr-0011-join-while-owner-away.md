# ADR 0011: Joining while the owner is away

Date: 2026-11-07. Status: **Accepted** (owner, 2026-11-07: "Accept and
build", after "can we jump
into this… option 1 doesn't appeal and I'm happy to do the work now", in
reply to "newcomers let themselves in"). Target: `0.6.1-torii.12` with a
Continuum release for the node side. Amends ADR 0010 (joining that works)
and ADR 0006 (membership signals). Keeps ADR 0008 (one sign-in) and ADR
0003 (no upstream services).

## Context

Since ADR 0010 a person who has been let in (personal link, "Let in", or a
straight-in group link) is a member in Continuum straight away. They still
can't read the chat until the owner's own Teams client adds them to the
encrypted group (an MLS Add plus a Welcome). The group lists only the owner
as admin (`adminPubkeys: [owner]`), and every member's client rejects an
Add, Remove or group-settings change from anyone else
(`chatAdminPolicy.ts`). So a newcomer waits until the owner has Continuum
open somewhere, which can be hours.

The owner's words: "People should be able to accept an invite whenever
they like… they don't need me to be awake watching the screen waiting".

Options weighed (2026-11-07):

1. Teammates' clients add people on the owner-signed list. Rejected by the
   owner: it still needs someone else online.
2. **Newcomers add themselves** (MLS external join, RFC 9420 §12.4.3.2),
   with the owner's signature as the only authority. Chosen.
3. The node joins the chat as a member and adds people. Rejected: the node
   would hold a chat key and could read the chat.

Facts from the code that shape the design:

- `ts-mls` 2.0.0-rc.13 (already a dependency) has `joinGroupExternal` and
  `createGroupInfoWithExternalPubAndRatchetTree`.
- Cordn's coordinator never reads MLS contents. It stores each group's
  messages as an ordered stream with cursors, and clients treat the first
  commit for an epoch in that order as the winner (Cordn spec §10). A
  joiner's commit races like any other.
- Each message is sealed a second time with a key derived from the current
  epoch (Cordn spec/03, `chatGroupPayloadCrypto.ts`). A joiner from outside
  does not have that key.
- Cordn ties a person's Nostr key to their MLS leaf through a Nostr-signed
  key package. An external join has no key package, so it needs its own
  binding or anyone could join under a member's name.
- The roster event (kind `30098`, `d` = project slug) is owner-signed. A
  straight-in grant (kind `27098`) is owner-signed. The group's settings
  carry the owner as admin and the project slug as the group name.

## Decision

### 1. The node keeps a join card, not a key

Every member's client, after any change that moves the group to a new
epoch, uploads the group's current **GroupInfo** (with the external public
key and the member tree) to Continuum:

- `PUT /api/projects/:slug/teams/groupinfo`
  `{group_id, epoch, group_info, transcript_hash}`: member session only, and
  only for the project's recorded chat (`409 wrong_group` otherwise). The
  node keeps the highest epoch it has been given (ignores older ones) and,
  per epoch, the first confirmed transcript hash it saw (`history`, last 32
  epochs). A second, different hash for an epoch is refused. Epoch 0 has an
  empty hash and records none. At most 64 KB; a new group id starts afresh.
- `GET /api/projects/:slug/teams/groupinfo` returns
  `{group_id, epoch, group_info, history, proof}`: only for people on the
  signed member list (proof = the signed roster event) or admitted by a
  straight-in grant (proof = that grant). Nobody else gets it; `404 none`
  until a member has uploaded one. Never cached.

GroupInfo holds no secret. It lets its holder ask to join; it does not let
anyone read past or present messages. The node already knows who is on the
project, so the member tree tells it nothing new.

### 2. A newcomer's own client joins

When a member's client finds it is on the project but not in the chat, it
fetches the GroupInfo and makes an **external commit**. It carries a proof
in the commit's authenticated data:

- **Who let me in**: the owner-signed roster event that lists them, or the
  owner-signed straight-in grant they used (plus the link id it was used
  for).
- **This leaf is me**: a Nostr event signed by the newcomer's own key
  (kind `27099`, never published) with tags `group` (group id), `epoch`
  (the epoch being joined) and `leaf` (the new leaf's signature public
  key). Signing it is the newcomer's one "Allow"; it replaces the key
  package that a Welcome needs.

It posts the commit to the group's stream. It can use the chat at once, but
counts the join as unconfirmed (kept across reloads) and uploads no
GroupInfo until it is confirmed: when the node's `history` for the joined
epoch holds its own transcript hash, or when it has since processed a later
commit. If `history` holds a different hash, another commit for that epoch
got there first: it drops the group, fetches the newer GroupInfo and tries
again (at most 3 times, then a 10-minute pause). With no GroupInfo yet it
looks again after 1 minute, doubling to 30. If the owner's client marked
them added (a Welcome is waiting), the Welcome is used instead.

### 3. Every member checks the proof the same way

Before processing a commit from a new member, every member's client checks,
using only what is in the commit and the group's own state (so all clients
reach the same answer):

1. The roster or grant is signed by the group's admin (`adminPubkeys[0]`).
2. Its project (`d` tag, or the grant's `project` tag) equals the group
   name.
3. The newcomer's key is listed in the roster, or the grant is the one the
   proof names.
4. The binding event is signed by the key in the new leaf's credential,
   names this group and epoch, and names the new leaf's signature key.
5. The roster or grant is not older than the group's **member-list floor**
   (section 4).
6. The commit adds nobody else and changes no group settings: its only
   proposal is the ExternalInit. (RFC 9420 would also allow a Remove of
   the joiner's own old leaf and PSKs; Torii allows neither.)

A commit that fails any check is skipped, like an unauthorised admin
action today. The check wraps every path that processes an MLS message, so
no caller can skip it. The admin policy's other rules don't change.

### 4. Removing someone closes the door behind them

A removed person may still hold an older signed list with their name on
it. So when the owner's client removes someone, it follows with a
group-settings commit that writes the **member-list floor**: the
`created_at` of the signed list that removed them, as a
`torii:floor=<unix seconds>` word in the group description. Section 3
rejects any roster or grant older than the floor. The floor lives in the
group's own state, so a newcomer gets it from the GroupInfo and all
members agree on it.

Removal itself still needs the owner's client, as now. Until it runs, the
node already blocks the removed person's sign-in and their GroupInfo
fetch. A straight-in grant made before a removal stops working for
self-joins; the person waits for the owner's client to add them, as before
this ADR. The signed roster already lists them, so this is rare.

### 5. The join commit is sealed with a key both sides can work out

A joiner can't seal with the epoch key. Its commit is sealed under a key
derived from the GroupInfo's group context (group id, epoch, confirmed
transcript hash), which the joiner and every member can compute. That
hides nothing from the node, which serves the GroupInfo, but keeps the
stream's format the same as Cordn's. Members try this key only when the
normal and former-epoch unseals fail, and accept what it opens only if it
is an external commit.

### 6. Fallback stays

If no GroupInfo is on the node yet (a group made before this release whose
members haven't opened it since), the owner's client adds people with a
Welcome as today. The owner's client also keeps adding people it sees
waiting, so whichever happens first wins and the other stops.

## Consequences

- People let in can read the chat as soon as they open it, day or night,
  with no one else online. The owner's signature is still the only thing
  that lets anyone in, and the node never holds a chat key.
- One more Nostr signature for each newcomer (the binding), in place of
  the key package a Welcome used. Kind `27099` joins the signer
  permissions asked for at sign-in (ADR 0008).
- A self-join shows as "X joined the group" (there is no adder).
- The node stores one small GroupInfo per project chat (up to 64 KB).
- A member who leaves the project but keeps an old GroupInfo can't rejoin:
  the floor and the node's sign-in check both stop them.
- Joining is a commit, so it moves the epoch for everyone, like an Add.
- Removing someone still needs the owner's client. Letting any member's
  client remove people who aren't on the newest signed list is a later
  ADR.
- Diverges from upstream Cordn in two places (the proof check and the
  join seal). Both are in Torii's own code (`src/lib/torii/` and
  `chatAdminPolicy.ts`) and don't change how upstream clients behave in
  groups that don't use them.
