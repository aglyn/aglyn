# Plugin origin loader (AGL-45)

Reference implementation of the **dedicated plugin origin** from the
[AGL-43 marketplace security design](https://linear.app/aglyn/document/marketplace-security-and-architecture-design-agl-43-a224cc4e9696).

Executable marketplace plugins never run in the console or tenant realms.
They load inside a cross-origin sandboxed iframe served from a **separate
Firebase project / domain** (e.g. `plugins.aglyn.app`) whose only job is to
serve `load.html` and stream plugin bundles out of the isolated artifacts
bucket. The browser's same-origin policy is the security boundary; this
origin shares no cookies, storage, or DOM with any app or tenant site.

## What the host does

`PluginFrame` (in `@aglyn/plugins-ui-mui`) frames
`https://<plugin-origin>/load?listing=<id>&v=<version>&sha=<sha256>` with
`sandbox="allow-scripts allow-same-origin"` (safe only because the src is
cross-origin — see the SANDBOX NOTE in `plugin-frame.tsx`) and speaks the
versioned postMessage bridge from `@aglyn/aglyn` (`plugin-bridge.ts`).

## What this origin must serve

1. **`load.html`** (this reference): a minimal page that fetches the pinned
   bundle, **verifies its sha256 against the query param** before executing
   (integrity check — a tampered artifact never runs), imports the entry
   module, and drives the bridge.
2. **The bundle**, streamed from `artifacts/{listingId}/{version}/{sha256}.bundle`
   in the isolated bucket, under a per-request **`Content-Security-Policy`
   built from the plugin's manifest** by `csp()` in
   [`origin/api/load.mjs`](./origin/api/load.mjs) — the only builder of this
   policy (AGL-1092), tested by `npm run test:plugin-loader`:
   `default-src 'none'`; `connect-src 'self'` plus the manifest's declared
   network allowlist (`'self'` is load-bearing — the frame fetches its own
   bundle from this origin); `base-uri`/`form-action` `'none'`;
   `frame-ancestors` = the aglyn app origins plus the framing site's verified
   custom domain. Measured live, with every egress API refused from inside
   the frame: fetch, XHR, WebSocket, EventSource and sendBeacon all raise
   `connect-src` violations at `disposition: enforce`.

## Plugin authoring contract (v1)

A plugin bundle's entry module default-exports a render function:

```js
export default function render({ mount, props, scheme, emit, hostFetch }) {
  // `mount` is a container element; render your UI into it.
  // `props` are the host props, already filtered to your manifest allowlist.
  // Call `emit(name, payload)` to send a declared event to the host.
  // Call `hostFetch(url, { method, body })` for host-mediated network
  //   (AGL-191) — resolves { ok, status, body }; the host rejects any URL
  //   whose origin isn't in your manifest `network` allowlist.
  // Return a cleanup function (optional).
}
```

The loader wires `props`/`scheme` from the host `init`/`props` messages,
forwards `emit` calls as bridge `event` messages (dropped by the host
unless declared in the manifest's `events`), reports rendered height via
`resize`, and relays `hostFetch` through the `fetch-request`/`fetch-response`
bridge. Two network paths exist: the plugin's own direct `fetch`
(constrained by the plugin-origin CSP's manifest `connect-src`), and
`hostFetch` (host-proxied, allowlist re-checked server-side, works even
under a strict CSP and gives the platform a metering point). No DOM or
storage access is provided by the bridge.

`load.html` is intentionally not built by this repo's Nx graph — it deploys
with the separate plugin project. It is version-pinned here as the contract
the host `PluginFrame` and the `plugin-manifest`/`plugin-bridge` libs are
written against.

## Trusted realm tier (AGL-420)

Listings a staff member has reviewed and **signed** (`trust: 'realm'` on
the version doc) skip the iframe and load INTO the app realm — first-party
grade extensions installed from the marketplace. See
[`docs/PLUGIN_LOADING.md`](../../docs/PLUGIN_LOADING.md) for the full trust
chain (sha256 content pinning + platform Ed25519 signature, verified
client- and server-side before a byte executes).

- **`realm/rollup.config.mjs`** — the build template. Realm bundles import
  nothing: `react`, `react/jsx-runtime`, and `@aglyn/aglyn` compile to
  lookups on `globalThis.__AGLYN_PLUGIN_HOST__`, which each app composes
  from its own bundle's singletons.
- **`realm/demo/`** — a minimal realm plugin (console widget in the
  `hostActivity` slot). Build with
  `cd realm/demo && npx rollup -c ../rollup.config.mjs`.
- **`realm/template/`** — the standalone starter for marketplace authors
  (AGL-425): npm package with the build config, entry-contract stubs,
  `manifest.json`, and a README that doubles as the marketplace listing
  documentation. Copy it out of the repo and go.

The authoring contract: export `register(host)` for client surfaces and/or
`registerApi()` for server handler bundles (the latter load only behind
`PLUGIN_REMOTE_SERVER=enabled` plus a per-deploy allowlist).
