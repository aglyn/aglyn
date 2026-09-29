/**
 * Your plugin's entry. Two optional exports, one per tier:
 *
 * - `register(host)` — CLIENT surfaces. Runs in the console and/or
 *   published sites after the platform verifies your bundle's sha256 pin
 *   and staff signature. `host` is `__AGLYN_PLUGIN_HOST__`:
 *   `{ version, React, jsxRuntime, aglyn, mui, muiStyles }`.
 * - `registerApi()` — SERVER API handlers. Only ever loaded on
 *   deployments that explicitly enable remote server bundles
 *   (`PLUGIN_REMOTE_SERVER=enabled` + a per-deploy allowlist); most
 *   plugins should not need this.
 *
 * The imports below compile to host lookups (see rollup.config.mjs) —
 * the emitted bundle has NO dependencies.
 */
import { createElement } from 'react'
import { registerConsoleExtension } from '@aglyn/aglyn'

function HelloWidget() {
  return createElement(
    'div',
    { style: { padding: 8 } },
    'Hello from my plugin',
  )
}

export function register(host) {
  if (host?.version !== 1) {
    console.warn('my-plugin: unexpected host ABI version', host?.version)
  }
  registerConsoleExtension({
    pluginId: 'my-plugin', // must match manifest.json `id`
    displayName: 'My plugin',
    widgets: [
      {
        slot: 'hostActivity',
        widgetId: 'my-plugin-hello',
        title: 'My plugin',
        Component: HelloWidget,
      },
    ],
  })
}
