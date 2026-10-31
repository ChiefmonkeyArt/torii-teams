# ADR 0001: Mounting Torii Teams on a Torii node

Status: Proposed (2026-10-31). Owner approval is needed before the first tag
and the first deploy.

Context: TEAMS-2c part (a) in torii-continuum `docs/adr-team-jobs.md`. The
node services (strfry relay at `wss://relay.<domain>`, the `torii-teams-coord`
coordinator, `/etc/torii/teams/coord.pub`) come from torii-suite `docs/TEAMS.md`
(v0.9.26-alpha).

## 1. Own subdomain, not a path

The app is served at `https://teams.<domain>/` (`TORII_TEAMS_HOST`), not under
`/teams/` on the main host.

- cordn-web assumes it owns `/`: route checks in chat attention, the manifest
  (`start_url: /chat`, `scope: /`), `/manifest.webmanifest` in `app.html`, and
  the service worker scope. A path mount would mean patching all of those and
  keeping the patches in step with upstream.
- Chat keys and group state live in IndexedDB and localStorage. A separate
  origin keeps them apart from Quest, Continuum and anything else on the main
  host, so a bug or injected script there cannot read them.
- It follows the existing `relay.<domain>` pattern (its own nginx server block
  and certbot certificate in `install-nostr-git.sh`).

Cost: the operator adds one DNS A/AAAA record for `teams.<domain>`.

## 2. Node settings file

The installer writes `/torii-node.json` and nginx serves it from outside the
release directory, so app updates never touch it and the build never ships one
(CI checks this).

```json
{
	"version": 1,
	"name": "example.com team",
	"coordinator": "<64 hex, from /etc/torii/teams/coord.pub>",
	"relays": ["wss://relay.example.com"],
	"git": "http://torii-teams.fips:7334"
}
```

The app reads it once at start (`src/lib/torii/nodeConfig.ts`): same origin,
no cookies, no redirects, no cache, `application/json` only, 4 KB at most.
Relays must be `wss://`; plain `ws://` is accepted only for loopback and
`.fips` mesh hosts; at most 8; no credentials in URLs. Anything else means the
file is ignored and the app behaves exactly like upstream cordn-web. Off a
node (dev, the Android app) the file is a 404 and nothing happens. `git` is
informational for now.

## 3. Coordinator default rule

- The node coordinator is added to the device's coordinator list, and the
  node's relays are merged into it. A label the member set is kept.
- It becomes the default only if the device has no default, or the current
  default is the coordinator this node set last time (so a key rotation
  follows the node). A default the member chose is never changed.
- Nothing is removed. A member can still use other coordinators.

## 4. Release and install

- Tags `<upstream>-torii.<n>` (first: `0.6.1-torii.1`) run
  `.github/workflows/torii-release.yml`: check, server tests, lint, build, then
  a reproducible `torii-teams-<tag>.tar.gz`, a `.sha256` file and
  `MANIFEST.json`, with a build-provenance attestation, on a GitHub
  pre-release. Tags without the `v` prefix do not trigger the upstream APK job.
- torii-suite installs it (proposed `installers/install-teams-app.sh`, opt-in,
  requires the Teams services): download, verify the checksum, unpack to
  `releases/<stamp>` with a `current` symlink, write `torii-node.json`, add the
  `teams.<domain>` server block with SPA fallback, certbot and security
  headers, and register with the sidecar. That work belongs to the Suite and
  is agreed with the Continuum Teams session.

Security headers (Suite server block): `Content-Security-Policy` with
`default-src 'self'`, `connect-src 'self' wss: ws://*.fips`, `img-src 'self'
data: blob: https:`, `frame-ancestors 'none'`, `object-src 'none'`,
`base-uri 'self'`; plus `Referrer-Policy: no-referrer`,
`X-Content-Type-Options: nosniff` and HSTS. The exact CSP is tested against
the built app before the first deploy; SvelteKit's inline start-up script
needs a `script-src` hash (or `kit.csp` in `svelte.config.js`), and the MLS
WebAssembly needs `'wasm-unsafe-eval'`.

## 5. Deferred

- Passing the Continuum project roster into the app (roles from kind 30098).
  Until then, roles fall back to group admins as maintainers.
- Using `git` from the settings file for code actions (J3+).
- A product domain and name.
