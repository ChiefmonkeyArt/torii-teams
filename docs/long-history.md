# Long chat histories — windowed rendering plan

Grounded design for keeping long chat sessions fast. Measured problem (Pixel 7a, ~15
groups, the active one at ~3k messages): renderer PSS ~320MB and a user-visible
slowdown that grows with usage, because every ingest batch pays O(history) work that
scales with the total message count.

## Why this shape (what other messengers do)

Signal (and Molly, which shares its message pipeline), Telegram and Discord-family
clients all decouple three budgets:

- **render window** — a small paging window bound to the UI (Signal: `pageSize=25`,
  3 buffer pages over SQLite; Discord: `before/after/around` pages per channel);
- **storage** — full durable history (nothing deleted for perf);
- **search** — never scoped to the render window (Signal: a persistent
  `message_fts` FTS5 table maintained by DB triggers; Telegram: DB-served search
  over cached history).

No messenger keeps a whole history in the render layer. This plan applies the same
split to Cordn: IndexedDB stays the full store (records keyed
`['groupId', cursor']` — range reads need no schema change), and only the reactive
render layer becomes windowed.

## Decisions

1. **Per-group window state.** Open group: tail of N=300 messages always loaded,
   older pages loaded on scroll-up, LRU-evicted beyond ~2k loaded rows. Non-open
   groups: tail of 50 (previews, attention). Nothing is ever deleted from storage.
2. **Storage reads.** `getGroupMessagesPage(groupId, { after?, before?, limit })`
   in [`chatStorage.ts`](../src/lib/storage/chatStorage.ts), ascending cursor order,
   exclusive boundaries:
   - no bounds → newest `limit` (tail page);
   - `before` → newest `limit` below `before` (prepend page);
   - `after` (optionally capped by `before`) → oldest `limit` above `after` (append page).
3. **Write path.** `putGroup` persists only cursors missing from storage (it must:
   `fastForwardGroup` can advance `fetchCursor` past messages that arrive late, so a
   high-water skip would drop them). The known-cursor set is memoized per group per
   session so the diff stops costing one `getAllKeys` per persist.
4. **Unread ledger.** Exact unread/mention counts must not scan history. Per group,
   a persisted list of *countable* cursors (non-system, non-own — the exact rules of
   `getChatGroupMessageSummary`) gives badge counts by binary search, updated O(1) at
   ingest. Existing installs get a one-time backfill scan at first load. Previews
   stay tail-derived (`messages.at(-1)`).
5. **One load primitive.** `loadChatGroupMessagesAround(groupId, cursor, radius)` (and
   the scroll-up `loadOlderChatGroupMessages`) is the only way older history enters a
   window; pages merge into the window and the `MAX_WINDOW_ROWS` cap bounds memory.
   Call sites: `?message=` deep links,
   search-result jumps, reaction/mention reference jumps, reaction marker rows whose
   target is unloaded, first-unread focus. `ChatMessageList.scrollToMessage()` keeps
   its measured-row convergence; an unloaded target loads its page first, then scrolls.
6. **First-unread edge (the sharp one).** `ChatShell` computes the focus id
   synchronously during render on purpose (an effect-set focus loses the race to the
   bottom-pin — see the comment at `initialFocusCursor`). When the first unread is
   inside the loaded window: unchanged synchronous path. When it is below the window
   (unread backlog deeper than the window): compute the focus from the ledger cursor,
   load the page around it before the list mounts (brief loading state), and match the
   row by cursor (`data-cursor`), since the event id is unknown until the row is loaded.
7. **Ingest dedupe under partial history.** The dedupe set is the loaded window plus
   an IDB point check for out-of-window candidates. This matters: drop-recovery
   re-fetches *old* cursors and self-echoes dedupe by message id. Invariant: a cursor
   that is already durable must never produce a second in-memory row.
8. **Recovery paths stay window-safe by construction.** `multiDevice` catch-up merges and
   drop-recovery folds run through the same cursor-dedupe merge as ingest (a re-offered
   durable row becomes a window reload, never a duplicate), and the cap bounds their
   growth. `unrecoveredDropHorizon`'s "row exists" check is window-scoped: a
   recovered-but-evicted row re-triggers one recovery fetch whose ingest then no-ops
   (durable cursors are seen). (`markOwnCommitLost`'s in-memory row removal keeps
   today's semantics unchanged.)
9. **Search is always-deep (no button).** Window results return synchronously; the
   deep scan backfills older results from storage progressively, newest-first per
   group, one IDB page at a time on the main thread (every read yields; each
   keystroke cancels the previous scan). Edit/delete parity with
   `getSearchableMessages()` is exact: deletes and edits pend until their target
   row streams by so the author/kind validation sees it, and reaction matches
   resolve the same way (unsolved at scan end are skipped, like the sync pass).
   A newest-first early-out was dropped on purpose — results sort by `createdAt`
   and sender clocks skew, so a stopped scan could differ from a full one. UI:
   progressive list with a quiet "searching older messages…" line.
10. **Prepend anchoring** is hand-rolled around the load call (scroll-height delta
    restore, refined by TanStack's item-size anchoring): exact unless new arrivals land
    in the same update. Upgrading `@tanstack/svelte-virtual` to
    `anchorTo: 'end'`/`followOnAppend` remains the phase-3 option — deferred to avoid
    swapping the scroll system without device testing.

## Gotcha map (code that assumes complete in-memory history)

| Site | Assumption | Fix |
|---|---|---|
| `chatGroups.svelte.ts` `buildAnnotationIndex` + `ChatShell.svelte` `messages`/`foldReactionMarkers` | full history per batch | window makes it O(N) constant |
| `chatGroupMessages.svelte.ts:~830` `seenCursors`/`seenMessageIds` | array = all stored | window set + IDB point check (decision 7) |
| `chatGroupMessages.svelte.ts:~685` drop-horizon cursor set | array = all stored | IDB point lookup |
| `chatGroupPresence.svelte.ts` `getChatGroupMessageSummary` | scans all messages per batch | ledger + tail (decisions 4) |
| `chatGroupSessions.svelte.ts` `messages: [...group.messages]` | full copy per op | becomes O(window) automatically |
| `chatStorage.ts` `putGroup` `getAllKeys` diff | whole-history keys per persist | memo (decision 3, landed) |
| `multiDevice.svelte.ts:~2725-3020` catch-up merge/sort, `.some()` scans | array = all stored | decision 8 |
| `ChatShell.svelte` `?message=` effect, `handleJumpToMessage`, `initialFocusCursor` | target in `messages` | `loadChatGroupMessagesAround` (decisions 5-6) |
| `chatMessageSearch.ts` | searches loaded messages | decision 9 |
| `chatGroupDisplay.ts`, `chatAttention.svelte.ts` | tail-only reads | already window-safe |

## Behavior changes (intended)

- Search results arrive progressively (instant window hits, older hits backfilled).
- Deep links / jumps to very old messages show a brief load before scrolling.
- Reaction marker rows whose target is outside the window render standalone with a
  jump (matching today's "rows without a target keep their own row" behavior in
  `reactionMarkers.ts`).

## Regression risks, ranked

1. **Dedupe under partial history** — duplicate rows if the window check misses.
   Targeted tests before the window switch.
2. **Ledger correctness + backfill** — counts must match the old scan on fixtures;
   backfill must be idempotent.
3. **Prepend scroll anchoring** — visible if wrong; test page loads while scrolled up.
4. **Recovery paths** (`multiDevice`, drop-recovery) — rare and complex; the existing
   regression suites (`ownCommitRegression` etc.) must stay green.
5. **`markOwnCommitLost` parity** — preserved as-is (its row removal vs storage is a
   pre-existing quirk; do not silently change).

## Phases

- [x] 1a — storage page reads (`getGroupMessagesPage`) + `putGroup` cursor memo.
- [x] 1b — unread ledger + backfill; presence summaries off full-history scans.
- [x] 1c — windowed store (decision 1), ingest dedupe (7), recovery merge semantics (8),
      `loadChatGroupMessagesAround` + jump call sites (5-6), prepend anchoring (10).
      Backup export reads full history from storage.
- [x] 2 — always-deep search (9).
- [ ] 3 — optional: write-through at ingest, persisted search index, only if metrics
      from 1-2 say so.

Validate each phase with the device probes used for the diagnosis: `dumpsys meminfo`
(renderer PSS), `dumpsys gfxinfo` (jank / input latency), and the logcat bridge-call
counts.
