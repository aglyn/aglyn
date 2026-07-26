# plugins.aglyn.com — the deployed plugin origin (AGL-879)

The concrete deployment of the [plugin origin reference](../README.md):
Vercel project **aglyn-plugins**, git-connected to this directory
(`rootDirectory: tools/plugin-loader/origin`, production branch `main`),
serving `https://plugins.aglyn.com`.

What it serves:

- **`/load`** — the sandboxed plugin iframe (`load.html`), CSP-stamped via
  `vercel.json` (`frame-ancestors` = the console + `*.aglyn.app` sites; a
  strict static CSP with `connect-src 'self'` — per-manifest network
  allowlists are a follow-up).
- **`/artifacts/{listingId}/{version}/{sha256}.bundle`** — edge-rewritten
  to the console's `/api/plugin-artifacts/…` route, which streams from the
  PRIVATE `aglyn-main-plugin-artifacts` bucket with immutable cache
  headers and open CORS. The bucket has no public access; the console
  route is the only read path, and every consumer verifies the sha256
  (realm loads also verify the Ed25519 staff signature) before executing.

No secrets live on this project — it is a static page plus edge rewrites.

Apps point here via `NEXT_PUBLIC_PLUGIN_ORIGIN=https://plugins.aglyn.com`
(console + tenant). The realm trust keys (`PLUGIN_TRUST_*`) are separate —
see `docs/PLUGIN_LOADING.md`.
