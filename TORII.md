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

| Step                                                                      | State                                                    |
| ------------------------------------------------------------------------- | -------------------------------------------------------- |
| J1 slice 1: action kind, role-checked fold, panel views, `/action` parser | Merged (PR #1)                                           |
| J1 slice 2: chat wiring (see below)                                       | Merged (PR #2)                                           |
| J1 slice 3: whole-history fold, edit form, Assign to me                   | Merged (PR #3)                                           |
| Continuum mount (TEAMS-2c a): node settings, release workflow, ADR 0001   | In review; first tag and deploy need owner approval      |
| Live use on a node                                                        | Needs the Suite installer step (Continuum Teams session) |

### Using actions (J1 slice 2)

- **Make an action.** Open a message's menu (or long-press on a phone) and choose
  "Make action", or hover a message and press `A`. Choose "Make action" on more
  messages to add them to the same draft (up to 20).
- **Quick capture.** Type `/action Fix login timeout @alice fri` in the composer.
  It fills in the form; nothing is sent until you press Save. The source is the
  message you are replying to, or else the newest message.
- **The panel.** The list button in the chat header opens the Actions panel
  (right-hand side; a full-screen sheet on phones): Open, In progress, Jobs and
  Done, plus a Decisions tab. The eye button jumps to the source message.
- **Who can do what.** Buttons appear only when the fold will accept them: the
  creator, the owner and maintainers change status; maintainers turn code
  actions into jobs ("Make job").
- **In the chat.** Messages that became actions show a small list badge.
  Creating, finishing, dropping or promoting an action draws a one-line note in
  the chat. These notes are drawn on each device from the log, never sent.
- **Edit and assign.** "Edit" on a card reopens the form to change the title, type,
  owner or due date (only changed fields are sent; sources stay fixed). "Assign to
  me" takes an open action in one click. Both appear only for people allowed to
  change the action.
- **Whole history.** When a chat opens, its stored history is read once (newest
  first, 500 rows a page) and only action ops are kept, so old actions show without
  scrolling back. The eye button can jump to a source message that is no longer
  loaded.

The action kind number (provisionally 1012) must be agreed with Cordn before any
release.

## On a Torii node

Served at `https://teams.<domain>/` on its own origin, so chat keys stay apart
from Quest and Continuum. At start the app reads `/torii-node.json`, written by
the Suite installer, and adds the node's coordinator and relay. It becomes the
default only on a fresh device or if this node set the old default; a default
the member chose is never changed. Without the file the app is plain
cordn-web. Details: [`docs/torii/adr-0001-node-mount.md`](docs/torii/adr-0001-node-mount.md).

## Versions

`<upstream version>-torii.<n>`, for example `0.6.1-torii.1`. The first tag is cut
when the app is first deployed (the Continuum mount); until then nothing is
tagged and `package.json` keeps the upstream version. A Torii tag runs
`.github/workflows/torii-release.yml`, which publishes a checksummed web build
for the Suite installer.

## Development

Node 22 or newer and pnpm 10.

```sh
pnpm install --frozen-lockfile && npx vitest run --project server && pnpm check && pnpm lint
```
