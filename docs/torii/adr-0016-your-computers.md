# ADR 0016: Your computers, for private git

Date: 2026-11-10. Status: **Proposed** (owner, 2026-11-10: "Do all the
things for stage c… adr and coding"). Target: Teams `0.6.1-torii.17` with
Continuum `v0.2.204-alpha` and Suite `v0.9.53-alpha`. Builds torii-continuum
`docs/adr-fips-default.md` §2, §3 and §5 (Accepted 2026-11-10). Keeps ADR
0003 (no upstream services) and ADR 0008 (one sign-in).

## Context

The team's private git listens only on the node's FIPS mesh, and the node's
firewall lets in only the computers listed in a root file. Nobody writes
that file from the member list yet, so a member can't reach git unless the
operator edits it over SSH. Members use Teams, not Continuum, so this is
where they should add their own computer. Phones have no FIPS client.

## Decision

1. **A "Your computers" panel.** Below the project list there's a "Your
   computers" button. It opens a short panel with:
   - the computers you've added, each with a name you chose and Remove;
   - Add a computer: paste its FIPS name (`fipsctl show`, an `npub1…`)
     and an optional name such as "Laptop";
   - this node's git address and FIPS name with Copy, plus one line on
     mapping it in your FIPS hosts file;
   - if FIPS isn't on this node, or you aren't on any project, one plain
     line saying so and no form.
     At most 3 computers per person. Nothing here is needed for chat.
2. **One signed note per person.** Each change signs a small note with
   your own signer: kind 27531, tag `t=torii-teams-devices`, content
   `{v:1, devices:[{npub, label}]}`. It's the full list, so removing one
   is signing the list without it; an empty list removes all. Continuum
   keeps the newest note only while you're on a project.
3. **Continuum passes it on, root checks it.** Continuum writes one file
   for the node (`memory/teams/mesh.json`) holding the owner-signed
   member lists, the owner-signed invite grants of people who joined by
   link, and everyone's device notes. A root helper in the Suite
   (`torii-teams sync`) checks every signature itself and writes
   `git-members` and `member-nodes` ("Written from Continuum. Do not
   edit."), then runs `torii-teams apply`.
4. **Who root believes.** Root accepts a person only from an owner-signed
   list, or from an owner-signed invite grant, counted against that
   grant's use limit. It accepts a computer only from that person's own
   note. Root refuses anything older than what it already applied. The
   one thing root takes from Continuum is that an invite claim came after
   the latest list; the use limit caps it, and git still checks each
   person's signature on every request.
5. **Privacy.** Computer names stay on the node and are shown only to
   their owner. FIPS mesh addresses are never shown.

## Consequences

- Removing someone from every project drops their computers at the next
  write, with no extra step.
- A compromised Continuum can't add people or computers on its own:
  everything root acts on is signed by the owner or the member.
- Hand edits to the two files are replaced once Continuum writes its file.
  Until then the files stay as they are.
- New surface: one member route (`GET`/`PUT /api/team/devices`), one root
  path unit (`torii-teams-sync.path`), and this panel.

## Tests

- Panel: lists computers; add, remove, the 3 cap, a bad name and a
  refused save; the no-FIPS and not-on-a-project lines.
- Continuum: wrong signer, a person not listed, a 4th device, an older
  note: refused; a removed person's devices leave the file.
- Root: bad signatures, a non-owner list, too many claims on one grant, a
  device signed by someone else, an older list: refused or dropped; a good
  file writes both lists, and an unchanged file doesn't restart git.
