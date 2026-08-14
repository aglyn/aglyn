# plugins.aglyn.com — the deployed plugin origin (AGL-879)

The concrete deployment of the [plugin origin reference](../README.md):
Vercel project **aglyn-plugins**, git-connected to this directory
(`rootDirectory: tools/plugin-loader/origin`, production branch `production`
since 2026-08-04), serving `https://plugins.aglyn.com`.

That alias is verified after every promote by
`tools/deploy/verify-production-aliases.mjs` (AGL-1610). Note `vercel project
ls` prints only the canonical `aglyn-plugins-aglyn.vercel.app` URL for this
project — the custom domain shows up in `vercel inspect`.

What it serves:

- **`/load`** — the sandboxed plugin iframe. Served by `api/load.js`,
  which stamps a **per-manifest CSP**: `connect-src` is built from the
  version's declared `capabilities.network` (via the console's public
  listing-versions endpoint), strict-fallback to `'self'` on any lookup
  failure. `frame-ancestors` = the console + `*.aglyn.app` sites, plus the
  framing host's VERIFIED custom domain (AGL-884): PluginFrame passes
  `?host=`, and the loader resolves it server-side through the console's
  `/api/plugin-host-origins/{hostId}` — the origin value never comes from
  the caller.
- **`/artifacts/{listingId}/{version}/{sha256}.bundle`** — edge-rewritten
  to the console's `/api/plugin-artifacts/…` route, which streams from the
  PRIVATE `aglyn-main-plugin-artifacts` bucket with immutable cache
  headers and open CORS. The bucket has no public access; the console
  route is the only read path, and every consumer verifies the sha256
  (realm loads also verify the Ed25519 staff signature) before executing.

No secrets live on this project — it is a static page plus edge rewrites.

Deployments are scoped to this directory. The repo-root `vercel.json` is
only read by projects rooted at `.` (aglyn-console), so without its own
git settings this project rebuilt on **every** push to the monorepo — the
whole `main` history showed up here as no-op deploys. `vercel.json` now
carries both halves: `git.deploymentEnabled` limits it to `production`
(`main: false`, so a push to `main` no longer creates a record here), and
`ignoreCommand` (`bash ../../scripts/vercel-ignore-build.sh plugins` —
exit 0 skips) builds only when this directory changed.

The `deploymentEnabled` and Production Branch settings must move together:
see the header of `tools/scripts/vercel-ignore-build.sh`, which explains
why `main: false` would silently starve this project of production
deployments if anyone set the branch back to `main`.

Apps point here via `NEXT_PUBLIC_PLUGIN_ORIGIN=https://plugins.aglyn.com`
(console + tenant). The realm trust keys (`PLUGIN_TRUST_*`) are separate —
see `docs/PLUGIN_LOADING.md`.

<!-- deploy: static; project settings pin no-op build/install commands -->
