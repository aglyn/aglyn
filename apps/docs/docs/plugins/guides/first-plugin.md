---
sidebar_position: 1
title: Build your first plugin
description: The full loop — scaffold, develop against a live workspace, verify, publish, install, uninstall.
---

# Build your first plugin

Two tracks share the same registries. **First-party** plugins live in this
repo under `libs/plugins/*` and load through the generated manifests;
**community** plugins are standalone bundles published to the marketplace.
This walkthrough does community end-to-end and notes the first-party
deltas.

## 1. Scaffold

```bash
# Community: copy the standalone starter out of the repo
cp -r tools/plugin-loader/realm/template my-plugin && cd my-plugin
npm install

# First-party (in-repo) instead:
node tools/scripts/create-plugin.mjs my-plugin \
  --label "My Plugin" --surfaces console,tenantApi
```

The community starter gives you `src/index.js` (the entry contract),
`manifest.json`, a build config that compiles your `react` /
`@aglyn/aglyn` imports into host-ABI lookups, and a README that becomes
your marketplace listing docs. The first-party scaffolder generates the
whole Nx library, wires `plugins.config.json`, and prints the two manual
follow-ups (catalog entry + release flag).

## 2. Write the entry

```js
import { createElement } from 'react'
import { registerConsoleExtension } from '@aglyn/aglyn'

export function register(host) {
  registerConsoleExtension({
    pluginId: 'my-plugin', // must match manifest.json id
    displayName: 'My plugin',
    widgets: [{
      slot: 'hostActivity',
      widgetId: 'my-plugin-hello',
      Component: () => createElement('div', null, 'Hello!'),
    }],
  })
}
```

Every registry in the [API reference](../reference/plugin-manager-api.md)
is available on `host.aglyn`; the [zones catalog](../reference/injection-zones.md)
lists where widgets can render.

## 3. Develop against a live workspace

```bash
npm run watch          # rebuilds dist/plugin.bundle.mjs on save
npx serve dist --cors  # any localhost static server works
```

Start the console/tenant dev server with the dev-loop variable and
refresh after each rebuild:

```bash
NEXT_PUBLIC_PLUGIN_DEV_BUNDLES="my-plugin=http://localhost:3000/plugin.bundle.mjs" \
  npx nx serve console
```

The bundle loads **unverified** (localhost only; the whole path is
compiled out of production builds). The browser console logs
`dev realm bundle loaded (UNVERIFIED): my-plugin`. If a change doesn't
stick, clear the Next dev cache (`rm -rf apps/console/.next/cache`) —
inlined env values live in it.

## 4. Verify

```bash
node tools/scripts/verify-plugin-bundle.mjs dist/plugin.bundle.mjs
```

The same checks the publish API enforces: entry exports, no leftover
static imports, no forbidden APIs, size. It prints the bundle's sha256 —
the content pin every install verifies.

## 5. Publish

Publish from the console (Community → your profile) or the API — the
bundle plus `manifest.json` fields and your listing content (README,
logo, screenshots, links, license, categories — see the
[publisher handbook](../publishing/publisher-handbook.md)). New listings
enter the **review queue** as `submitted`; staff list (or verify ✅) them
before they appear in browse. Publishing requires a community profile, a
Pro plan, and payouts onboarding for paid listings; there's a daily
publish cap.

## 6. Install, enable, load

A workspace admin installs from the marketplace: the install pins your
exact `{version, sha256}`, enables the plugin on the org switchboard, and
it loads on the next visit — sandboxed by default, or into the app realm
once staff have signed the version (`trust: 'realm'`). Upgrades are
explicit re-pins; your published artifacts are immutable, so nobody's
pinned install can change underneath them.

## 7. Uninstall

Plugins & add-ons → Uninstall removes the pin and the switchboard entry.
**Data your plugin created stays untouched** — reinstalls pick up where
they left off. Design for that: namespace your documents and tolerate
finding old ones.

## Troubleshooting

- **Nothing loads**: check the browser console for the loader's reason —
  sha mismatch (stale artifact URL), missing/invalid signature (not
  realm-signed yet — expected for sandbox-tier), host ABI mismatch
  (rebuild against the current template), or the plugin isn't in
  `org.enabledPlugins`.
- **Blank widgets / hook errors**: your bundle carries its own React.
  Realm bundles must import `react` only through the template's build
  config (host-ABI lookups) — run the verifier; leftover static imports
  fail it.
- **Publish 422**: the response lists exactly which static check failed.
- **Works in dev, not after publish**: the dev loop skips verification;
  the published path doesn't. Run the verifier locally first.
