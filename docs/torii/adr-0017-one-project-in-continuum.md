# ADR 0017: One project at a time inside Continuum

Date: 2026-11-10. Status: **Proposed** (owner, 2026-11-10: "the Teams screen
is confusing... I don't think we need the chat panel there"; "the group chat
should than appear in the tab on the project page"). Target:
`0.6.1-torii.18` with Continuum `v0.2.205-alpha` (its
`docs/adr-project-team-chat.md`) and Suite `v0.9.54-alpha`. Amends ADR 0010
§2 (where the frame is docked). Keeps ADR 0005 (member list = chat
membership), ADR 0008 (one sign-in) and ADR 0016 (Your computers).

## Context

Inside Continuum, Teams runs in one hidden frame per page load and is docked
on the Team page (ADR 0010 §2). There it shows the whole app: the list of
every project's chat on the left, the open chat on the right and "Your
computers" under the list. Continuum is moving the chat to each project's own
Team tab, and Continuum already has the project list in its sidebar, so a
second list inside the frame repeats it. The frame already accepts
`torii:navigate` to `/chat/p/<slug>`.

## Decision

1. **Inside Continuum, one project only.** When Teams is framed (the existing
   `data-torii-embed` check in the layout), it hides its own project
   list and shows only the chat Continuum navigated to, at full width. The
   chat header, members, "n not joined yet", reactions, files and the
   message box stay as they are.
2. **No project chosen.** Framed at `/chat` with no project, Teams shows
   nothing but a quiet empty state; it keeps running hidden to add
   newcomers (ADR 0010 §2).
3. **"Your computers" moves to the chat header** when framed, as a small
   button that opens the same panel (ADR 0016). The panel, its 3-computer
   cap and its notes don't change.
4. **Standalone is unchanged.** Opened directly (the "Open in full window"
   link, or a member's own browser or phone), Teams keeps its project list,
   "Your computers" under it and every route it has today.
5. **Navigation stays checked.** `torii:navigate` keeps its exact-origin and
   path checks; Continuum sends it on every Team tab open and project
   change. Teams never navigates Continuum.

## Consequences

- No list of other projects inside a project's page; the chat looks like
  part of the project.
- Members using Teams directly see no change.
- No new messages, routes or storage: one layout switch on the existing
  embed check, and the "Your computers" button placement.

## Tests

- Framed: no project list; the navigated project fills the width; `/chat`
  shows the empty state; "Your computers" opens from the header.
- Not framed: the list and "Your computers" under it, as in torii.17.
- `torii:navigate` from a wrong origin or with a bad path is still ignored.
