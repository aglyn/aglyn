---
sidebar_position: 3
title: Manifests, trust lifecycle & environment
description: The plugin manifest schema, the marketplace listing/version documents, the trust state machine, and every PLUGIN_* environment variable.
---

# Manifests, trust lifecycle & environment

## Plugin manifest (published with every version)

```jsonc
{
  "id": "my-plugin",          // stable kebab-case id; never rename
  "name": "My plugin",        // ≤80 chars
  "version": "1.0.0",         // semver; every publish is a new version
  "entry": "plugin.bundle.mjs", // relative bundle path (no absolute URLs)
  "hostAbi": 1,               // host ABI generation (AGL-429); mismatches never load
  "description": "…",         // ≤500 chars
  "capabilities": {
    "network": ["https://api.example.com"], // sandbox CSP connect-src allowlist
    "props": ["title"],       // host props the bridge forwards
    "events": ["submitted"],  // events the host will accept
    "size": { "height": 240 } // declared frame size
  },
  "restrictParent": [],       // besigner lineal rules
  "restrictChildren": [],
  "config": {                 // settings the console renders a form for
    "fields": [
      { "key": "pointsPerDollar", "label": "Points per dollar",
        "type": "number", "min": 1 },
      { "key": "tier", "label": "Tier", "type": "select",
        "options": [{ "value": "basic", "label": "Basic" }] }
    ],
    "defaults": { "pointsPerDollar": 5, "tier": "basic" }
  }
}
```

Validation is server-side (`validatePluginManifest`) — invalid manifests
never publish. `capabilities` are enforced by the sandbox tier: the plugin
origin stamps a CSP from `network`, the bridge drops undeclared props and
events.

### `config` — settings without writing a settings screen

A first-party plugin registers its settings schema by calling
`registerPluginConfigSchema` at module scope. Your bundle cannot: it runs
sandboxed on its own origin and never executes in the console process, so
there is no moment at which that call could happen. Declaring `config` in the
manifest is how you get the same thing.

The console reads it from the **pinned** manifest on the install, so the fields
a workspace sees are the fields the version it installed declared. Your plugin
reads the resolved values with `usePluginConfig(orgId, pluginId)` on the client
or `getPluginConfig(orgId, pluginId)` on the server — the same two calls a
first-party plugin uses — and gets the same two-level behavior for free: the
workspace answers once, and any one site can override a single field and keep
inheriting the rest.

Field `type` is one of `string`, `number`, `boolean` or `select`; a `select`
needs `options`, and a `number` may set `min`/`max`. Anything else is dropped
rather than rendered, at most 50 fields are read, and every default is coerced
to its declared type — so a manifest cannot put a control the console does not
have in front of a customer, and a mistyped default cannot become the value
every site inherits.

## Listing & version documents

- `marketplaceListings/{listingId}` — public: `displayName`, `description`,
  `categories[]` (fixed taxonomy), `logoUrl`, `screenshots[]`, `readme`
  (markdown), `homepageUrl`, `repositoryUrl`, `license`, `priceUsd`,
  `latestVersion`, `installCount` (cumulative installs ever),
  `activeInstalls` (installs live right now — the detail page shows both,
  e.g. `41 installs · 12 active`), `reviewStatus`.
- `marketplaceListings/{id}/pluginVersions/{version}` — **server-only**:
  `sha256`, `objectPath`, `manifest`, `changelog`, `trust?`, `signature?`.
  The buyer-safe subset (version/changelog/trust/hostAbi/date) is exposed
  by `GET /api/marketplace/listing-versions`.
- Installs pin `{version, sha256}` at `hosts/{hostId}/installs/{listingId}`
  (host tier) or `orgs/{orgId}/installs/{listingId}` (org tier). Artifacts
  are immutable content-addressed objects:
  `artifacts/{listingId}/{version}/{sha256}.bundle`.

## Review & trust lifecycle

```
publish ──▶ submitted ──▶ in_review ──▶ listed ──▶ verified
                              │
                              └──▶ rejected (reason → publisher notified)
```

- `listed`/`verified` (or legacy/absent) plugin listings appear in browse;
  everything else is owner-and-staff-only. Verified adds the ✅ badge.
- **Realm trust is separate and orthogonal**: a super-staff signature over
  a version's sha256 (`POST /api/admin/sign-plugin`) sets
  `trust: 'realm'`, letting that version load into the app realm. The
  `revocations/{listingId}` kill switch beats everything.

## Environment variables

| Variable | Runtime | Purpose |
| --- | --- | --- |
| `NEXT_PUBLIC_PLUGIN_ORIGIN` | client + server | Dedicated plugin origin: serves `/load` (sandbox) and `/artifacts/...` (realm fetches) |
| `PLUGIN_ARTIFACTS_BASE` | server | Optional server-side artifacts base override |
| `PLUGIN_ARTIFACTS_BUCKET` | console server | Isolated bucket the publish flow writes to |
| `NEXT_PUBLIC_PLUGIN_TRUST_PUBLIC_KEY` | client | Ed25519 public key (base64 raw); when set, client realm loads require valid signatures |
| `PLUGIN_TRUST_PUBLIC_KEY` | server | Same key, server loaders (mandatory there) |
| `PLUGIN_TRUST_PRIVATE_KEY` | console server only | Signing key (base64 PKCS8 DER) for the staff sign-plugin route |
| `PLUGIN_REMOTE_SERVER` | server | `enabled` turns on remote server bundles (default off everywhere) |
| `PLUGIN_REMOTE_SERVER_BUNDLES` | server | Per-deploy `listingId@version` allowlist |
| `PLUGIN_JOBS_SECRET` | tenant server | Shared secret the scheduler sends to `/api/plugins/run-jobs` |
| `NEXT_PUBLIC_PLUGIN_DEV_BUNDLES` | client, dev only | Unverified localhost bundle loading for the authoring loop; dead code in production builds |

## `plugins.config.json` (first-party contributors)

The single source mapping plugin ids to packages, register entry points
per surface (`site`, `console`, `tenantApi`, `consoleApi`), and
`apiPrefixes`. `node tools/scripts/generate-plugin-manifests.mjs` turns it
into the four generated loader manifests — the only files allowed to
reference `@aglyn/plugins-*` outside `libs/plugins` (an nx boundary rule
enforces this). The scaffolder (`tools/scripts/create-plugin.mjs`)
maintains it for you; the manual follow-ups are the
`FIRST_PARTY_PLUGINS` catalog entry and the release flag
(registry + Remote Config template).
