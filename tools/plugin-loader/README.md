# Plugin origin loader (AGL-45)

Reference implementation of the **dedicated plugin origin** from the
[AGL-43 marketplace security design](https://linear.app/aglyn/document/marketplace-security-and-architecture-design-agl-43-a224cc4e9696).

Executable community plugins never run in the console or tenant realms.
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
   built from the plugin's manifest** (`pluginContentSecurityPolicy`):
   `default-src 'none'`, `connect-src` = the manifest's declared network
   allowlist, `frame-ancestors` = the aglyn app origins. The serving layer
   (a Cloud Function or Hosting rewrite on the plugin project) stamps this.

## Plugin authoring contract (v1)

A plugin bundle's entry module default-exports a render function:

```js
export default function render({ mount, props, scheme, emit }) {
  // `mount` is a container element; render your UI into it.
  // `props` are the host props, already filtered to your manifest allowlist.
  // Call `emit(name, payload)` to send a declared event to the host.
  // Return a cleanup function (optional).
}
```

The loader wires `props`/`scheme` from the host `init`/`props` messages,
forwards `emit` calls as bridge `event` messages (dropped by the host
unless declared in the manifest's `events`), and reports rendered height
via `resize`. No DOM, storage, or network access is provided by the bridge;
the plugin's own `fetch` is constrained to the manifest `connect-src`.

`load.html` is intentionally not built by this repo's Nx graph — it deploys
with the separate plugin project. It is version-pinned here as the contract
the host `PluginFrame` and the `plugin-manifest`/`plugin-bridge` libs are
written against.
