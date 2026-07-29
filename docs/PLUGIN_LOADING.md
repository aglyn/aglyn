# Plugin loading (AGL-415..420)

How plugins reach the running apps: the manifest pipeline, the org
switchboard, and the three trust tiers. The companion authoring guide is
`apps/docs/docs/developers/plugins/building-feature-plugins.md`; the sandboxed-origin
reference is `tools/plugin-loader/README.md`; the competitive gap analysis
and v2 roadmap live in `docs/PLUGIN_PLATFORM_GAPS.md`.

## The rule

**Nothing outside `libs/plugins/*` imports `@aglyn/plugins-*`.** Enforced
by the nx boundary rule (`scope:app` may not depend on `aglyn:addons`,
`eslint.config.mjs`). Apps reach plugins only through:

1. **Generated loader manifests** — `plugins.config.json` at the repo root
   maps plugin id → package → register-fn names per surface (`site`,
   `console`, `tenantApi`, `consoleApi`) and API path prefixes.
   `node tools/scripts/generate-plugin-manifests.mjs` emits the four
   `plugins.{client,server}.generated.ts` files under
   `apps/{console,tenant}` — the ONLY sanctioned plugin references
   (file-scoped eslint-disable).
2. **Core registries** (`libs/aglyn/src/lib/plugin-manager/`) — console
   extensions (nav, pages, widgets, providers), site runtimes, site-page
   hooks (redirect resolvers, page resolvers, enrichers), billing-webhook
   handlers, API routes.

## Per-org enablement

`org.enabledPlugins: string[]` (AGL-416) is the switchboard; absent means
`DEFAULT_ENABLED_PLUGINS` (all first-party), and always-on plugins (`mui`)
are unioned in via `resolveEnabledPlugins(org)`. Managed on the console's
**Plugins & add-ons** page (org section, AGL-423) — first-party toggles
with release-flag state chips plus the marketplace installs (upgrade /
uninstall / share-with-org via the community plugin's `orgAddons` widget);
the org-settings "Plugins" tab links there.

On top of the org switchboard sits the **platform release gate**
(AGL-422): every non-always-on first-party plugin maps to a release flag
(`FirstPartyPlugin.releaseFlag` → the Remote Config registry), and
`filterPluginsByReleaseFlags` subtracts flagged-off plugins from the
effective set on every surface — console loader, published-site loader,
and the API dispatchers (404, staff bearer tokens excepted). Staff keep
the usual preview bypass; org-subject bucketing means rollout percentages
give a whole workspace the same verdict everywhere. Server verdicts come
from a 60s-cached admin-SDK template read that fails open to the registry
defaults (`getServerReleaseFlagValues` in tenant-data-admin).

Surfaces follow the switches:

- **Console**: `ConsolePluginsGate` loads the enabled set's `console`
  surfaces after the org resolves, then renders the shell. Editor pages
  additionally gate on the `site` surfaces (`withSitePlugins`).
- **Published sites**: `load-page-data` resolves the host org's enabled
  set into page props; the catch-all client suspends (SSR included) until
  those `site` surfaces register — the canvas never renders against an
  empty registry.
- **APIs**: the `[...pluginApi]` dispatchers lazy-load every first-party
  `/server` entry once, then gate per request — a disabled plugin's paths
  404 for that workspace.

## Trust tiers for marketplace (remote) plugins

| Tier | Where it runs | Gate |
| --- | --- | --- |
| Sandboxed (default) | Cross-origin `PluginFrame` iframe on the dedicated plugin origin | sha256 pin + manifest CSP + postMessage bridge (AGL-45) |
| Trusted realm | The app realm itself (console and/or site) | Everything below (AGL-420) |
| Remote server handlers | The API dispatcher process | Realm chain + env master switch + per-deploy allowlist |

### The realm trust chain

Every link must hold before a byte executes:

1. **Content pinning** — the workspace's install doc pins
   `{version, sha256}`; artifacts are immutable content-addressed objects
   (`artifacts/{listingId}/{version}/{sha256}.bundle`). The loader hashes
   the fetched bytes and refuses on mismatch.
2. **Staff signature** — granting `trust: 'realm'` (super-staff route
   `POST /api/admin/sign-plugin`, console app) writes an Ed25519
   `signature` over the sha256 hex onto the server-only version doc.
   Loaders verify it with the platform public key and fail closed —
   unsigned, badly signed, or unverifiable (no WebCrypto Ed25519) never
   loads when a key is configured. Server-side loading refuses to run
   without a key at all.
3. **Kill switch** — `revocations/{listingId}` beats a still-present trust
   grant; revoked versions are dropped by the server-side join. **Staff
   takedown is a kill switch too** (AGL-948): hiding a plugin listing
   writes the revocation as well, and `resolveCommunityPluginVersion`
   refuses any listing carrying `hiddenAt`, so one moderation action stops
   the bundle everywhere instead of only de-listing it. Un-hiding clears
   the revocation only if the takedown wrote it (`source: 'takedown'`), so
   a hand-written revocation survives.

   Publisher **unpublish (`deletedAt`) is deliberately NOT a kill
   switch** — it blocks new installs and hides the listing, but existing
   installs keep loading. A publisher retiring a listing must not break
   the sites already paying for it.
4. **ABI compatibility** (AGL-429) — manifests declare `hostAbi`; the
   loaders refuse a bundle whose generation differs from the host's
   `PLUGIN_HOST_ABI_VERSION` (undeclared = legacy, loads with a warning),
   and the install API warns at pin time. Bumping the ABI is a breaking
   platform change: ship it with a migration window where publishers
   rebuild against the new host object.
5. **Host ABI, no imports** — bundles are built with
   `tools/plugin-loader/realm/rollup.config.mjs`: `react`,
   `react/jsx-runtime`, and `@aglyn/aglyn` compile to lookups on
   `globalThis.__AGLYN_PLUGIN_HOST__`, which each APP composes from its
   own bundle (`setRealmPluginHost`) so there is exactly one React and one
   registry instance (the blank-canvas invariant).

### Client loading

- **Console**: `ConsolePluginsGate` fetches
  `GET /api/orgs/realm-plugins?orgId=` (server-side join of install pins
  with the staff-only trust grants — clients can't read version docs) and
  `loadRealmPlugins` executes each verified bundle via a blob-URL import,
  calling its exported `register(host)`. Loaded before the shell renders.
- **Sites**: `load-page-data` ships `props.realmPlugins` (same join,
  admin SDK); the catch-all client loads them in a post-hydration effect —
  realm site runtimes are additive, so first paint never waits on a
  marketplace CDN.
- **Switchboard integration** (AGL-424): installs append the listing id to
  `org.enabledPlugins` and uninstalls remove it once no pin remains, but
  only for workspaces that explicitly configured the field — absent means
  default-open so pre-switchboard installs keep loading. A configured list
  also gates the realm join, so toggling an installed plugin off disables
  it without uninstalling.
- Failures (fetch, sha, signature, execution) are logged and skipped,
  per bundle. A broken remote plugin cannot take a surface down.

### Remote server handlers — the highest-risk switch

Default **OFF everywhere**. All of the following, no exceptions:

- `PLUGIN_REMOTE_SERVER=enabled` — master switch.
- `PLUGIN_REMOTE_SERVER_BUNDLES=listingId@version,...` — explicit
  per-deploy allowlist; installs alone never load server code.
- `PLUGIN_TRUST_PUBLIC_KEY` — required; the signature check is mandatory
  here (no dev-mode skip).
- Version doc must carry `trust: 'realm'`.

The dispatcher writes verified bytes to a private temp file and imports it
(`file://`; node can't import blob URLs), then calls the bundle's
`registerApi()` — handlers register through the same
`registerPluginApiRoute` first-party `/server` entries use, so the
per-request org gate applies to them too.

## Environment variables

| Variable | Runtime | Purpose |
| --- | --- | --- |
| `NEXT_PUBLIC_PLUGIN_ORIGIN` | client + server | Dedicated plugin origin; serves `/load` (sandbox) and `/artifacts/...` (realm fetches) |
| `PLUGIN_ARTIFACTS_BASE` | server | Optional server-side override of the artifacts base |
| `PLUGIN_ARTIFACTS_BUCKET` | console server | Isolated bucket the publish flow writes bundles to |
| `NEXT_PUBLIC_PLUGIN_TRUST_PUBLIC_KEY` | client | Ed25519 public key (base64 raw); when set, client realm loads require valid signatures |
| `PLUGIN_TRUST_PUBLIC_KEY` | server | Same key for the server loader (mandatory there) |
| `PLUGIN_TRUST_PRIVATE_KEY` | console server ONLY | Signing key (base64 PKCS8 DER) for the staff sign-plugin route |
| `PLUGIN_REMOTE_SERVER` | server | `enabled` turns on remote server bundles (default off) |
| `PLUGIN_REMOTE_SERVER_BUNDLES` | server | Comma-separated `listingId@version` allowlist |
| `NEXT_PUBLIC_PLUGIN_DEV_BUNDLES` | client, **dev only** | `id=http://localhost:PORT/plugin.bundle.mjs,...` — loads UNVERIFIED bundles for the local authoring loop (AGL-427). The code path is compiled out of production builds and refuses non-localhost URLs; never set it anywhere shared. Pair with `npm run watch` in the realm template and refresh. |

Generate the key pair with
`node tools/scripts/generate-plugin-trust-key.mjs`. Rotation runbook
(AGL-437), in this order so nothing stops loading mid-swap:

1. Generate the new pair (keep the old private key until the end).
2. `PLUGIN_TRUST_PRIVATE_KEY=<new> node
   tools/scripts/resign-realm-plugins.mjs` — re-signs every
   `trust: 'realm'` version doc (use `--dry-run` first).
3. Deploy the new PUBLIC key to every runtime
   (`PLUGIN_TRUST_PUBLIC_KEY` + `NEXT_PUBLIC_PLUGIN_TRUST_PUBLIC_KEY`).
4. Swap the console's `PLUGIN_TRUST_PRIVATE_KEY` to the new key and
   destroy the old one.

## Performance guardrails (AGL-436)

- **Per-plugin budgets**: `node tools/scripts/check-plugin-budgets.mjs`
  measures each plugin's OWN minified code (everything external) against
  `tools/plugin-budgets.json` (baseline + 25% headroom) and fails on
  regression; `--update` re-baselines after a deliberate change. Current
  baseline: commerce ~179 KB, everything else 8–61 KB.
- **Loader metrics**: dev builds log `[plugin-loader] <id> [surfaces]
  load Xms, total Yms` per activation, so a slow plugin is visible
  instead of hiding in the gate's total.
- **Server cold start**: the dispatchers' `ensureAll` loads every
  first-party `/server` entry once per process; the same dev metrics
  time it. Registrations are cached — repeat requests pay nothing.
- **Realm artifacts** are immutable content-addressed objects published
  with `public, max-age=31536000, immutable`; front them with a CDN and
  cache hits are free forever (a new version is a new URL).

## Artifact retention (AGL-942)

Bundles are immutable and content-addressed, so the bucket only ever grew
— nothing deleted from it. The stranding case is a **republish of the same
version string with different bytes**: the new build writes a new object
and the version doc's `sha256` repoints, leaving the previous object
unreachable forever (every loader derives its URL from the version doc's
hash).

`POST /api/admin/reap-plugin-artifacts` (cron-secret auth) joins the
bucket against Firestore and deletes only what no version doc claims. It
runs weekly from `.github/workflows/scheduled-crons.yml` (Mondays 05:30
UTC) alongside the other scheduled routes, and is in that workflow's
`workflow_dispatch` list for a manual run:

- **Survives** if ANY `pluginVersions` doc claims the object's exact
  `{listingId}/{version}/{sha256}`. Not "is it the latest" and not "does
  an install pin it" — `install-plugin` accepts a `requestedVersion`, so
  every version doc is installable and keeps its bytes alive at zero
  installs.
- **Reaped** if unclaimed AND older than 7 days. The min-age guard exists
  because a publish writes the object before the version doc that claims
  it; a run racing an in-flight publish would otherwise see a legitimate
  bundle as an orphan. Capped at 200 deletions per run and audited to
  `adminAudit` (`plugins.artifacts.reap`).
- **Reported, never deleted**: objects whose parent `communityListings`
  doc is gone (Firestore doesn't cascade to subcollections, and existing
  installs of a hard-deleted listing still load off the orphaned version
  doc), and anything under `artifacts/` that isn't a canonical path.

Deletions are permanent — the bucket has no object versioning and a
publisher's build isn't reproducible from our side — so run it dry first:

```
CRON_SECRET=… node tools/scripts/reap-plugin-artifacts.mjs           # dry run
CRON_SECRET=… node tools/scripts/reap-plugin-artifacts.mjs --apply
```

The script is a thin client for the route, not a second implementation:
the join needs the Admin SDK plus `PLUGIN_ARTIFACTS_BUCKET`, and one home
for the rules means a local dry run and the weekly cron can never disagree
about what counts as an orphan. The decision itself is a pure function
(`planArtifactReap`, `apps/console/utils/server/reap-plugin-artifacts.ts`)
so the rules that authorize a permanent delete are unit-tested.

**A GCS lifecycle rule cannot do this job** — it matches on age, storage
class and prefix, and has no view of Firestore. An age-based delete rule
would eventually remove bundles that live installs pin by exact sha, which
breaks them unrecoverably.

### The one safe lifecycle rule (AGL-944)

`cloud/plugin-artifacts-lifecycle.json` carries the bucket's policy:
`AbortIncompleteMultipartUpload` at 7 days, and nothing else. It reaps
abandoned partial uploads and cannot touch a finished object, so a
published bundle is out of its reach by construction. There is
deliberately **no `Delete` rule** — see above for why age is not a safe
signal here.

```
gcloud storage buckets update gs://$PLUGIN_ARTIFACTS_BUCKET \
  --lifecycle-file=cloud/plugin-artifacts-lifecycle.json
gcloud storage buckets describe gs://$PLUGIN_ARTIFACTS_BUCKET \
  --format='value(lifecycle_config)'          # read it back
```

Revert with `--clear-lifecycle`. The bucket is a plain GCS bucket in the
`aglyn-main` project, never registered with Firebase Storage, so it does
not appear in the Firebase console's Storage tab (only
`aglyn-main.appspot.com` is) — use the Cloud console or `gcloud`. Keep it
that way: registering it would put it behind Firebase Security Rules and
make it addressable from the client SDKs, when the whole design has the
console's `/api/plugin-artifacts/…` route as the only read path. Billing
is unaffected either way — same project, same Cloud Billing account as
Firebase, just Cloud Storage SKUs rather than the Firebase Storage line.

## Publish → sign → load walkthrough

1. Author builds with the realm rollup template; entry exports
   `register(host)` (client) and/or `registerApi()` (server).
2. Verify locally: `node tools/scripts/verify-plugin-bundle.mjs
   dist/plugin.bundle.mjs` (AGL-426) — entry exports, self-containment,
   forbidden APIs, size. The publish API runs the SAME checks
   (`checkPluginBundle`) and 422s with the problem list, so local and
   server verdicts never drift. The checks PARSE the bundle since
   AGL-964: computed access on a global (`g['ev'+'al']`), any
   `.constructor()` call, `import()` with a runtime specifier, and every
   network call diffed against the manifest's `capabilities.network` —
   so pass the manifest (second argument, or leave it beside/above the
   bundle) or the network findings downgrade to warnings locally while
   the publish API still rejects. The output lists EVERY area it checked
   in four states — pass, fail, question, and not checked (AGL-1087);
   a not-checked row is not a pass.

   Bump `PLUGIN_VERIFIER_VERSION` when a rule changes. Stored verdicts
   (AGL-962) then recompute — but only for a version somebody OPENS, so
   after a bump, sweep them (AGL-1086):

   ```bash
   CRON_SECRET=… node tools/scripts/reverify-plugin-versions.mjs --apply
   ```

   That re-checks every stored version, writes the new verdicts back,
   and reports REGRESSIONS — bytes that passed the old checker and fail
   the new one. A regression on a live version with installs notifies
   staff and lands in `adminAudit`; nothing is delisted or revoked,
   because a lint that can stop a plugin in every workspace is a kill
   switch with no human in it. It also runs weekly (Mondays 06:00 UTC),
   where it skips every already-current verdict without downloading
   anything.
3. Publish through the community pipeline (`community/publish-plugin`) —
   content-addressed upload + version doc with sha256.
4. Workspace installs (pin) the listing; org enables it.
5. Staff review, then `POST /api/admin/sign-plugin`
   `{listingId, version}` (super staff; audited). Revoke trust with
   `{action: 'revoke'}`; hard-kill with a `revocations/{listingId}` doc.
6. Next console visit / site render loads the bundle through the chain
   above. For server handlers, additionally flip the two env switches on
   the specific deployment.
