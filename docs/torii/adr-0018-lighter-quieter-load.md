# ADR 0018: A lighter, quieter load

Date: 2026-11-11. Status: **Proposed** (owner, 2026-11-10: "Do the routstr
issue then 1, 2, and 3" from the improvements list). Target:
`0.6.1-torii.19` with Suite `v0.9.60-alpha`. Keeps ADR 0003 (no upstream
services by default), ADR 0008 (one sign-in), ADR 0011 (self-join) and
ADR 0012 (lighter start-up).

## Context

Three costs were left on every Torii load after ADR 0012:

1. **The Cordn News feed shipped anyway.** Torii builds never show News
   (ADR 0003), but `src/lib/news/feedItems.ts` is imported from the app
   entry, so its ~26 KB (gzip) chunk was fetched on every page.
2. **Every reload asked the signer.** With the e2e harness counting signer
   calls per reload, each reload made a public-key request and one signature
   (`tools/call welcome_take`, kind 25910). The cause was the chat layout's
   start-up `loadWelcomeNotificationsAction()` plus the notifications
   dialog's 5-minute poll. Inside Continuum that is a signing round trip on
   each load; with a browser signer it can be a prompt.
3. **Action history read the whole chat.** `ensureActionHistory` walked every
   stored message in 500-row pages to find the few action rows (kind 1012)
   and the messages they cite. A chat with tens of thousands of messages paid
   for all of them once per session.

## Decision

1. **No News in Torii builds.** A Vite plugin (`toriiNoNews`,
   `src/lib/torii/viteNoNews.ts`) swaps `feedItems.ts` for an empty stand-in
   with the same exports (`newsOff.ts`) when `VITE_TORII_NODE_BUILD=1`.
   Upstream builds are unchanged.
2. **No welcome poll in Torii builds.** `POLL_WELCOMES = !TORII_NODE_BUILD`
   gates the layout's start-up welcome fetch and the dialog's poll. Welcomes
   still arrive where they matter: roster sync (ADR 0011) fetches them when
   one of your projects has no chat yet. Result: a reload makes **0** signer
   calls (was 2).
3. **A by-kind index.** The message store (IndexedDB version 6 → 7) gains two
   indexes, `groupKindCursor` (`[groupId, kind, cursor]`) and
   `groupMessageId` (`[groupId, id]`), and `ChatStorage` gains
   `getGroupMessagesOfKind` and `getGroupMessageCursorsById` (memory and
   IndexedDB). Action history reads its rows by kind, then looks up only the
   cited ids. If the index read fails it falls back to the old full scan.
   The upgrade only adds missing stores and indexes, existing rows are
   indexed by the browser, and no data is rewritten.

## Consequences

- Torii JS drops from 2,496,354 to 2,419,934 bytes (−76 KB; gzip per file
  822,061 → 796,326, −25.7 KB); the build directory drops by the same amount.
- Reloading Teams, standalone or inside Continuum, no longer signs anything.
  Signing is still needed when a welcome check is really due (a project with
  no chat) or a key package is published. A true session key that removes
  those too needs upstream cordn-server support and is out of scope.
- Action history on a long chat costs its action rows and a few id lookups
  rather than every message.
- **Upstream divergence.** `chatStorage.ts` is shared with Cordn. The change
  is additive (new indexes, new methods), but the database version now leads
  upstream. If Cordn later bumps to 7 with its own change, rebase to
  `max(ours, theirs) + 1`; the upgrade is idempotent so either order works.
- Tests: `viteNoNews.test.ts`, `build.test.ts` (welcome gate),
  `chatStorage.test.ts` (memory reads), `chatStorage.svelte.test.ts` (real
  IndexedDB reads and a v6 → v7 upgrade over existing rows),
  `actionHistory.test.ts` (indexed read equals the full scan). The
  two-person e2e (join, messages both ways, names and avatars, no external
  hosts) still passes.
