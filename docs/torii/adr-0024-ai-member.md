# ADR 0024: The project AI is labelled, and says who can ask it

Date: 2026-11-18. Status: **Accepted** 2026-11-18 after the local review
("Yes and do all the things still to do"). Proposed by the owner, 2026-11-18: "@mentions first,
both model options with the label, and Owners and Maintainers only to begin
with." / "Let's go with this"). Target: `0.6.1-torii.28`. Pairs with Continuum
`docs/adr-team-ai-member.md` and Suite ADR 0007. Builds on ADR 0005 (the
roster is the chat membership) and ADR 0006 (ready signals).

## Context

Continuum can now put one AI member, "Continuum AI", on a project's roster as
an `agent` of the owner. The owner's Teams adds it to the chat from its ready
signal like any other member; nothing changes there. It answers @mentions from
Owners and Maintainers only, with the model the owner picked (Local or
Routstr). Two things have to be visible in the chat:

1. Which messages come from the AI, and from which model.
2. That a Contributor or Viewer who mentions it will get no answer.

## Decision

1. **Roster field.** `parseRoster` reads `ai: {pubkey, name, label}` from the
   roster reply, only when that pubkey is listed with the `agent` role; names
   and labels are stripped of control characters and capped (40 / 60).
   `projectChannels.ai` keeps it per project slug.
2. **Badge.** A message whose author is a project AI shows a small pill after
   the name: "AI · Local · llama3.2:3b" (or "AI · Routstr · model"), with the
   tooltip "Written by an AI".
3. **Ask rule note.** When you pick the AI in the @mention list and your role
   in that project (from `/api/team/me`) is not owner or maintainer, a line
   above the composer says "Only Owners and Maintainers can ask Continuum AI.
   It won't answer this." Sending still works; the AI just stays quiet.
   The project is found from the chat's `torii:project=<slug>` marker.
4. Pure rules live in `src/lib/torii/aiMember.ts` (tested); the composer takes
   an optional `mentionHint` callback so upstream Cordn code is untouched
   when it is absent.

## Consequences

- Old Continuum (no `ai` field): no badge and no note; the chat works as
  before.
- The badge depends on Continuum's roster, not on anything the AI claims about
  itself, so a member cannot fake it with a profile name.

## Keeping the join check in step

Continuum's AI member is not a browser client, so it carries its own copy of
the ADR 0011 join check (`agent/lib/team-ai-join.mjs` in torii-continuum),
tested against a join-seal key computed by `src/lib/torii/externalJoin.ts`. A
change to the join proof, the join seal or the floor must update both, or the
AI stops reading the chat after the next person joins while the owner is away.

## Also in torii.28: the +N badge stays clear of the title

With the AI in a chat, most project chats have three or more members, so the
header shows a member avatar plus a "+N" badge. The stack was pinned to the
40 px single-avatar width, so the badge ran over the first letter of the
chat name. It now takes the width of its two avatars
(`ChatGroupAvatar.svelte`, marked Torii).
