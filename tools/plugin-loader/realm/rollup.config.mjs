/**
 * Realm-bundle build template (AGL-420) — for TRUSTED marketplace plugins
 * (`trust: 'realm'`) that load into the app realm instead of the sandboxed
 * PluginFrame. Copy this config into your plugin repo and point `input` at
 * your entry.
 *
 *   npx rollup -c tools/plugin-loader/realm/rollup.config.mjs
 *
 * The one rule of the realm ABI: bundles import NOTHING at runtime. The
 * host publishes its singletons on `globalThis.__AGLYN_PLUGIN_HOST__`
 * ({ version, React, jsxRuntime, aglyn }), and this config rewrites your
 * `import ... from 'react' | 'react/jsx-runtime' | '@aglyn/aglyn'` to read
 * from that global — so your components render with the app's own React
 * and register into the app's own registries (two React copies or two
 * registry instances is the blank-canvas failure).
 *
 * Your entry must export `register(host)` (site/console surfaces) and/or
 * `registerApi()` (server handler bundles, loaded only behind
 * PLUGIN_REMOTE_SERVER). Publish the emitted file through the standard
 * community pipeline; a staff member signs the version to grant realm
 * trust.
 */

/** Maps bare module ids to `__AGLYN_PLUGIN_HOST__` keys. */
const HOST_MODULES = {
  react: 'React',
  'react/jsx-runtime': 'jsxRuntime',
  '@aglyn/aglyn': 'aglyn',
}

/**
 * Resolves the host-provided modules to virtual shims that read the host
 * global. `syntheticNamedExports` makes any named import (`useState`,
 * `registerConsoleExtension`, ...) a runtime lookup on the host object.
 */
export function aglynHostExternals() {
  return {
    name: 'aglyn-host-externals',
    resolveId(source) {
      return source in HOST_MODULES ? `\0aglyn-host:${HOST_MODULES[source]}` : null
    },
    load(id) {
      if (!id.startsWith('\0aglyn-host:')) return null
      const key = id.slice('\0aglyn-host:'.length)
      return {
        code:
          'const host = globalThis.__AGLYN_PLUGIN_HOST__;\n' +
          `if (!host) throw new Error('__AGLYN_PLUGIN_HOST__ is not set');\n` +
          `export default host[${JSON.stringify(key)}];\n`,
        syntheticNamedExports: 'default',
      }
    },
  }
}

export default {
  input: 'src/index.js',
  output: {
    file: 'dist/plugin.bundle.mjs',
    format: 'es',
    sourcemap: false,
  },
  plugins: [aglynHostExternals()],
}
