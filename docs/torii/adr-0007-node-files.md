# ADR 0007: Images and files on the node's own file server

Date: 2026-11-05. Status: **Accepted** (owner request, 2026-11-05: "Move images
and files to the node's own Blossom server"). Ships in `0.6.1-torii.7` with
Continuum `0.2.196-alpha` and Suite `v0.9.37-alpha`. Amends ADR 0003 (no
upstream services) and ADR 0006 (profiles via Continuum).

## Context

Teams media is end-to-end encrypted: each file is sealed with a per-file key
that travels only inside the MLS message (`imeta`), and the server stores
opaque ciphertext. Uploads go to a public Blossom server
(`cdn.hzrd149.com` first, then a fallback list), signed by a throwaway key per
upload. Multi-device sync documents go to three public Blossom servers.

So the content is private, but the metadata is not: public hosts see every
member's IP address, when they send, how much, and who downloads it. Storage
also depends on third parties that can drop files at any time. The node
already has its own relay, coordinator and Continuum; files are the last piece
on someone else's server.

## Decision

1. **A small file server on the Teams host.** The Suite installs
   `torii-teams-files`: a zero-dependency Node.js server speaking the parts of
   Blossom that Teams uses (BUD-01 `GET`/`HEAD /<sha256>`, BUD-02
   `PUT /upload` and `DELETE /<sha256>`, BUD-06 `HEAD /upload`). It is mounted at
   `https://<teams host>/files/`, so it is same-origin: no new DNS name or
   certificate, and no CORS. It listens on loopback only, runs as a systemd
   `DynamicUser` with a strict sandbox, and stores blobs under
   `/var/lib/torii-teams-files`. nginx serves reads straight from disk.
   A full upstream Blossom server was rejected: it brings a database and a
   dependency tree onto the VPS for features Teams does not use.
2. **Only rostered people upload.** In Torii builds, uploads and deletes carry
   the member's Continuum session (`Authorization: Bearer <token>`) instead of a
   Nostr auth event, so there are no signer prompts. The file server asks
   Continuum `GET /api/team/files-ok` (loopback), which answers for the owner
   or anyone on at least one roster, and caches the answer for 60 seconds.
   Removed people lose upload rights within a minute.
3. **Reads are open, content is not.** Blobs are ciphertext addressed by their
   sha256, so `GET /files/<sha256>` needs no session (this keeps `fetch` and
   the round-trip check simple). Every blob is served as
   `application/octet-stream` with `nosniff`, `Content-Disposition: attachment`
   and `Content-Security-Policy: default-src 'none'; sandbox`, so nothing
   uploaded can run on the Teams origin.
4. **Limits.** 100 MiB per file and 10 GiB in total by default
   (`TEAMS_FILES_MAX_MB`, `TEAMS_FILES_QUOTA_GB`); the server checks the hash it
   computed against `X-SHA-256`. A delete is allowed only to the uploader or the
   owner. Retention is unlimited for now; clean-up of files nobody references
   is follow-up work.
5. **Teams uses the node only.** `/torii-node.json` gains
   `"files": "https://<teams host>/files"` (only when Continuum is installed;
   without Continuum nothing changes). With it, a Torii build:
   - uploads media to the node only, with no public fallback;
   - uses the node as the only multi-device document host;
   - loads media only from the node. Older messages whose files are on another
     host show "Stored outside this node", and nothing is fetched.
6. **The browser enforces it.** With the file server in place, the Suite tightens
   the Teams CSP from `https:`/`wss:` to the node's own hosts:
   `connect-src 'self' https://<continuum host> wss://<relay host>`, and
   `img-src`/`media-src 'self' data: blob:`. A Torii build cannot reach a
   public relay, profile host or file host even if code tries.

## Consequences

- Files, profiles, relays and the coordinator all live on the node; the browser
  talks only to the Teams, Continuum and relay hosts.
- Uploads need a Continuum session, which Teams already holds; standalone and
  Cordn builds keep upstream behaviour.
- The VPS disk now holds team media, bounded by the quota. Backups and expiry
  are the operator's concern until clean-up lands.
- Images sent before torii.7 that live on public Blossom no longer show.
- Multi-device sync documents stored on public Blossom before torii.7 are
  no longer read; sync starts again from what is on the node.
- The node sees which member uploaded each blob (by session), not its contents.
- If the file server is down, sending media fails with a clear error; text chat
  is unaffected.

## Not covered

- Clean-up of unreferenced blobs and per-member quotas.
- Mirroring to a second node for redundancy.
