# Torii Teams

Private team chat that turns into work. Torii Teams is a standalone app in the
Torii family (alongside Torii Quest and Torii Hibiki). Torii Continuum opens it
from a project's Team view and passes in the project's signed roster.

Working name. The product name is still open (Kesshū 結集 was considered); the
repository name stays `torii-teams` until that is decided.

## Based on cordn-web

This repository starts from [cordn-web](https://github.com/Cordn-msg/cordn-web)
v0.6.1 by the Cordn project, with its full history, under the MIT licence in
[`LICENSE`](LICENSE). All credit for the MLS client, coordinator protocol and
chat UI goes to Cordn. Torii additions live in their own files where possible so
they can be offered upstream, and fixes to shared code go upstream first.

Upstream release tags are not mirrored here, so our own tags cannot collide with
them.

## What Torii adds

Design: torii-continuum `docs/adr-team-jobs.md` (sections 2–3 and 2a) and
`docs/adr-team-collaboration.md`.

- **Actions (J1).** Anyone with contributor rights picks one or more messages and
  makes an action: a todo, decision, question or code task, with an owner and an
  optional due date. Actions live in the group as a small log of operations
  (`src/lib/chat/actions.ts`); every device folds the same log in coordinator
  order, so there is no server database. People move every stage; clankers,
  viewers and non-members cannot write actions.
- **Roles.** From the Torii signed roster (kind 30098) when opened from
  Continuum; in standalone groups, group admins act as maintainers. Owners and
  maintainers promote code actions to jobs.
- **Later steps.** The optional scribe clanker with an end-of-day digest (J2), job
  specs and the Jobs page (J3+), and the open clanker market (J5+), as set out in
  the ADR.

## Status

| Step                                                                                                  | State                                                      |
| ----------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| J1 slice 1: action kind, role-checked fold, panel views, `/action` parser                             | In review                                                  |
| J1 slice 2: "Make action" menu, Actions panel, composer `/action`, `A` shortcut, badges, status lines | Next                                                       |
| Continuum mount (TEAMS-2c a)                                                                          | After slice 2                                              |
| Live use on a node                                                                                    | Needs a coordinator on the node (TEAMS-2b, Continuum side) |

The action kind number (provisionally 1012) must be agreed with Cordn before any
release.

## Versions

`<upstream version>-torii.<n>`, for example `0.6.1-torii.1`. The first tag is cut
when the app is first deployed (the Continuum mount); until then nothing is
tagged and `package.json` keeps the upstream version.

## Development

Node 22 or newer and pnpm 10.

```sh
pnpm install --frozen-lockfile && npx vitest run --project server && pnpm check && pnpm lint
```
