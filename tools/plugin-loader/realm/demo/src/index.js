/**
 * Demo realm plugin (AGL-420). Built with the sibling rollup template —
 * these imports compile to lookups on `globalThis.__AGLYN_PLUGIN_HOST__`,
 * so the emitted bundle is dependency-free and renders with the host's
 * own React/registry singletons.
 *
 *   cd tools/plugin-loader/realm/demo && npx rollup -c ../rollup.config.mjs
 */
import { createElement } from 'react'
import { registerConsoleExtension } from '@aglyn/aglyn'

function RealmDemoWidget() {
  return createElement(
    'div',
    { style: { padding: 8, fontSize: 13 }, 'data-testid': 'realm-demo' },
    'Hello from a trusted realm plugin',
  )
}

/** Client entry: called with the host ABI once the bundle verifies. */
export function register(host) {
  if (host?.version !== 1) {
    console.warn('realm-demo: unknown host ABI version', host?.version)
  }
  registerConsoleExtension({
    pluginId: 'realm-demo',
    displayName: 'Realm demo',
    widgets: [
      {
        slot: 'hostActivity',
        widgetId: 'realm-demo-widget',
        title: 'Realm demo',
        Component: RealmDemoWidget,
      },
    ],
  })
}
