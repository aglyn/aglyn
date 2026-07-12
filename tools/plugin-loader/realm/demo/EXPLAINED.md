# The realm demo, line by line

`src/index.js` is the smallest useful realm plugin — a console widget in
the `hostActivity` zone. What each piece is doing:

```js
import { createElement } from 'react'
import { registerConsoleExtension } from '@aglyn/aglyn'
```

These are NOT real imports in the emitted bundle. The build config
(`../rollup.config.mjs`) rewrites both module ids to lookups on
`globalThis.__AGLYN_PLUGIN_HOST__` — the object the host app publishes
with ITS OWN React and registry singletons. That single mechanism is why
realm plugins render correctly: two React copies (or two registry
instances) is the classic blank-canvas failure, and the ABI makes it
impossible. `syntheticNamedExports` in the rollup plugin is what lets
named imports (`createElement`, `registerConsoleExtension`) resolve at
runtime against the host object.

```js
function RealmDemoWidget() {
  return createElement('div', …)
}
```

Plain `createElement` instead of JSX keeps the demo dependency-free — a
real plugin can use JSX because `react/jsx-runtime` is also ABI-mapped.

```js
export function register(host) {
  if (host?.version !== 1) { console.warn(…) }
```

`register(host)` is the client entry contract. The loader calls it only
after the full trust chain verified the bytes (sha pin, staff signature,
revocations, ABI generation). The version check is belt-and-braces — the
loader already refuses ABI mismatches before executing.

```js
  registerConsoleExtension({
    pluginId: 'realm-demo',
    widgets: [{ slot: 'hostActivity', … }],
  })
}
```

Exactly what a first-party plugin's `register*Console()` does — realm
bundles use the same registries, which is the point of the tier. The
`pluginId` must match the marketplace listing's manifest `id`.

Build it (`npx rollup -c ../rollup.config.mjs`) and read
`dist/plugin.bundle.mjs`: the imports are gone, replaced by two host
lookups, and the whole file has zero dependencies — which is what
`verify-plugin-bundle.mjs` (and the publish API) enforce.
