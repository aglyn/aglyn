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

Use the template's build config. Two kinds of import never end up in your
bundle: what must be the same instance as the app's, and libraries the site
already runs. Those compile to lookups on `globalThis.__AGLYN_PLUGIN_HOST__`,
where the app puts its own modules. Everything else you import is compiled in
and tree-shaken.

| Import | Host key | What the host holds |
| --- | --- | --- |
| `react`, `react/jsx-runtime` | `React`, `jsxRuntime` | The app's React. Two copies can't render one tree |
| `@aglyn/aglyn` | `aglyn` | The realm plugin surface: the registries, the schema and field constants, `defineUiFeatureBundle`, console slots, the element contexts, and the site-function and variable runtime |
| `@mui/material`, `@mui/material/<Component>` | `mui` | The components listed below, plus `useMediaQuery` and `createSvgIcon` |
| `@mui/material/styles` | `muiStyles` | `alpha`, `css`, `darken`, `emphasize`, `getContrastRatio`, `keyframes`, `lighten`, `styled`, `useColorScheme`, `useTheme` |

The MUI components on the host are `Alert`, `Box`, `Button`, `Card`, `CardContent`, `Checkbox`, `Chip`, `CircularProgress`, `Collapse`, `Divider`, `FormControl`, `FormControlLabel`, `FormHelperText`, `IconButton`, `InputAdornment`, `InputLabel`, `Link`, `List`, `ListItem`, `ListItemText`, `MenuItem`, `Paper`, `Radio`, `RadioGroup`, `Select`, `Stack`, `SvgIcon`, `Switch`, `Table`, `TableBody`, `TableCell`, `TableHead`, `TableRow`, `TextField`, `Tooltip`, `Typography`.

Taking MUI from the host is what makes a plugin element look like the rest of
the page. It takes the site's palette, type, component defaults and dark mode,
and its styles are written into the page's style cache during the server
render, not after it. It also costs nothing twice: the page already downloads
that MUI.

The rest of the rules:

- **The build refuses** to compile in anything from `@mui/*`, `@emotion/*` or
  `react-dom`. A copy would download twice and miss the site's theme. Style
  with `styled`, `css` and `keyframes` from `@mui/material/styles`.
- **`@mui/icons-material` is an ordinary dependency.** Bundle the icons you
  use; they draw through the host's `createSvgIcon`.
- **The verifier refuses a name the host doesn't hold.** That covers a
  component off the list (a `Slider`), a core export off the surface, or a
  host key the ABI doesn't have. Any of those would be `undefined` on every
  site. Class-name objects (`buttonClasses`) aren't on the host; write MUI's
  stable class names (`.MuiButton-root`) instead.
- **Import by name.** `import * as Aglyn from '@aglyn/aglyn'` works only for
  surface names, and the verifier warns when a namespace is used as a value.

The surfaces are short, reviewed lists in
`tools/scripts/generate-realm-host-exports.mjs`. A page loads them only when
it runs a realm plugin, and adding to one is a platform change.

Export `register(host)` (client surfaces) and, only if you truly need server
handlers, `registerApi()`. Declare `hostAbi` in your manifest; a bundle built
for another generation never loads.

## The chain that runs before a byte executes

1. **Content pin** — the install doc's sha256 must match the fetched
   bytes (immutable content-addressed artifacts).
2. **Platform signature** — Ed25519 over the sha, granted by super staff
   after review; verification fails closed.
3. **Kill switch** — a `revocations/{listingId}` doc beats everything.
4. **ABI check** — declared `hostAbi` must equal the host's generation.

## Granting trust (staff)

**Admin → Plugin reviews** has a **Listed plugins — realm trust** section: every
listed and verified plugin with its recent versions, each showing a **Realm-trusted**
or **Sandboxed** chip and a **Latest** marker, with per-version **Grant realm trust**
and **Revoke realm trust** buttons. Trust is granted to a *specific reviewed version*,
not to the listing — a newer version stays sandboxed until it is reviewed and granted
in turn.

Both actions are super-staff only and adminAudit'd. The equivalent API is
`POST /api/marketplace/admin/trust { listingId, version }`, with `{ action: 'revoke' }` to
revoke; a hard-kill still needs a revocation doc. Signing requires
`PLUGIN_TRUST_PRIVATE_KEY` on the console deployment — generate the pair with
`tools/scripts/generate-plugin-trust-key.mjs`.

## Where realm bundles load

- **Console**: from the org's trusted installs, on the screens that draw
  what the manifest declares under `contributes.console`.
- **Besigner**: for a site that runs the plugin, when it declares site
  components or site features, so its elements are in the Elements panel and
  draw on the canvas. The canvas waits for the bundle.
- **Published sites**: post-hydration (additive — first paint never waits
  on a marketplace CDN), and only on a page that uses the plugin: one that
  places a component its manifest declares under `contributes.site`, or on
  every page when it declares a site feature. A plugin that only adds console
  widgets never loads on a published page, and neither does the host that
  runs it. See [`contributes`](../reference/manifest-and-envs.md#contributes--where-the-plugin-loads).
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
- **`this Aglyn host does not provide mui`**: the bundle ran on a host
  older than the MUI keys. Every current console and site provides them.
- **`… never compiles it in`** (build): an import of MUI, emotion or
  `react-dom` outside what the host holds. Use the host's components and
  `@mui/material/styles`.
- **`__AGLYN_PLUGIN_HOST__ is not set`**: your bundle executed outside a
  host surface — the console gate and site effect set the ABI before
  loading; don't import the bundle yourself.
- **Server bundle didn't register**: the dispatcher logs which chain link
  failed (`not realm-trusted`, `built for host ABI N`, fetch, signature)
  and skips — check the deployment logs and the allowlist entry.
