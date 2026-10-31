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

Mixed content: an https page cannot open `ws://` or fetch `http://`, and the
CSP blocks it too. So on https the app uses only the `wss://` relays from the
file (`wss://relay.<domain>` is the in-browser chat path). `.fips` relays and
the `.fips` git URL are for native clients and the CLI on the mesh; the app
may show them but never connects to them from an https page.

`continuum` (optional, https origin; omitted when Continuum is not installed)
is where member sign-in lives (TEAMS-2a slice 2 in torii-continuum
`docs/adr-team-collaboration.md`: challenge, `POST /api/team/auth/verify`
gives a bearer token, `GET /api/team/me`, role-scoped roster). There is no
cookie. Calling it cross-origin needs `https://teams.<domain>` in the
Continuum agent's `cors_origins` and `https:` in `connect-src`;
the installer sets both. The app does not use it yet.

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
- The release drops upstream Cordn's `.well-known/` files (NIP-05 names and
  Android app links for cordn.net) and Cloudflare `_headers`/`_redirects`: a
  Torii node must not claim Cordn's identities. The Suite installer drops them
  too and returns 404 for `/.well-known/` on the app host.
- torii-suite installs it (proposed `installers/install-teams-app.sh`, opt-in,
  requires the Teams services): download, verify the checksum, unpack to
  `releases/<stamp>` with a `current` symlink, write `torii-node.json`, add the
  `teams.<domain>` server block with SPA fallback, certbot and security
  headers, read `coord.pub` (fail closed if missing), write `torii-node.json`
  0644 root, and register with the sidecar. That work belongs to the Suite and
  is agreed with the Continuum Teams session.

Security headers (Suite server block): `Content-Security-Policy` with
`default-src 'self'`, `connect-src 'self' https: wss:` (members may add other relays and coordinators), `img-src 'self'
data: blob: https:`, `frame-ancestors 'none'`, `object-src 'none'`,
`base-uri 'self'`; plus `Referrer-Policy: no-referrer`,
`X-Content-Type-Options: nosniff` and HSTS. The exact CSP is tested against
the built app: the Suite derives `script-src` hashes from the inline start-up
scripts of each build (no `unsafe-eval`, no WebAssembly needed), and a real
build ran under the policy in headless Chromium with no violations
(torii-suite v0.9.27-alpha, `docs/TEAMS.md`). `connect-src` is `'self' https:
wss:`, since members upload images to Blossom servers.

## 5. Deferred

- Passing the Continuum project roster into the app (roles from kind 30098).
  Until then, roles fall back to group admins as maintainers.
- Using `git` from the settings file for code actions (J3+).
- A product domain and name.
