---
sidebar_position: 4
title: "Guide: trusted realm bundles"
description: The end-to-end path from a standalone bundle to first-party-grade code running in the app realm.
---

# Trusted realm bundles

Marketplace plugins run **sandboxed** by default (cross-origin iframe,
capability bridge). The realm tier is for plugins the platform has
reviewed and **signed**: they load into the app realm and use every
registry first-party plugins use. This guide is the operator + publisher
view; the architecture is `docs/PLUGIN_LOADING.md` in the repo.

## Build against the host ABI

Use the template's build config: your `react`, `react/jsx-runtime`, and
`@aglyn/aglyn` imports compile to lookups on
`globalThis.__AGLYN_PLUGIN_HOST__` — the app injects its own singletons
there, which is what keeps your components on the app's React and your
registrations in the app's registries. Export `register(host)` (client
surfaces) and, only if you truly need server handlers, `registerApi()`.
Declare `hostAbi` in your manifest; a bundle built for another generation
never loads.

## The chain that runs before a byte executes

1. **Content pin** — the install doc's sha256 must match the fetched
   bytes (immutable content-addressed artifacts).
2. **Platform signature** — Ed25519 over the sha, granted by super staff
   after review; verification fails closed.
3. **Kill switch** — a `revocations/{listingId}` doc beats everything.
4. **ABI check** — declared `hostAbi` must equal the host's generation.

## Granting trust (staff)

From **Admin → Plugin reviews**, the *Grant realm trust* button signs the
listing's latest version (super staff; adminAudit'd), or call
`POST /api/admin/sign-plugin { listingId, version }` directly. Revoke
with `{ action: 'revoke' }`; hard-kill with a revocation doc. Signing
requires `PLUGIN_TRUST_PRIVATE_KEY` on the console deployment — generate
the pair with `tools/scripts/generate-plugin-trust-key.mjs`.

## Where realm bundles load

- **Console**: before the shell renders, from the org's trusted installs.
- **Published sites**: post-hydration (additive — first paint never waits
  on a marketplace CDN).
- **Server** (rare): only on deployments with `PLUGIN_REMOTE_SERVER=enabled`
  plus a per-deploy `listingId@version` allowlist; every load is audited.

## Key rotation

`generate-plugin-trust-key.mjs` → `resign-realm-plugins.mjs` (re-signs
every granted version with the new key, `--dry-run` first) → deploy the
new public keys → retire the old private key. Re-sign **before** the
public-key swap so nothing stops loading mid-rotation.

## Troubleshooting

- **Loads in dev loop, not from the marketplace**: dev loop skips
  verification. Check the browser console for the loader's reason —
  usually "missing signature" (not signed yet) or "sha256 mismatch".
- **`__AGLYN_PLUGIN_HOST__ is not set`**: your bundle executed outside a
  host surface — the console gate and site effect set the ABI before
  loading; don't import the bundle yourself.
- **Server bundle didn't register**: the dispatcher logs which chain link
  failed (`not realm-trusted`, `built for host ABI N`, fetch, signature)
  and skips — check the deployment logs and the allowlist entry.
