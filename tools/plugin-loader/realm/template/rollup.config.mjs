/**
 * Realm-bundle build (AGL-425 template). Emits ONE dependency-free ESM
 * file: your `react`, `react/jsx-runtime`, and `@aglyn/aglyn` imports are
 * rewritten to runtime lookups on `globalThis.__AGLYN_PLUGIN_HOST__` — the
 * host app injects its own singletons there, which is what keeps your
 * components rendering with the app's React and registering into the
 * app's registries.
 *
 * Build: `npm run build` → dist/plugin.bundle.mjs. Publish that file
 * through the Aglyn marketplace pipeline; its sha256 becomes the content
 * pin every install verifies.
 */

const HOST_MODULES = {
  react: 'React',
  'react/jsx-runtime': 'jsxRuntime',
  '@aglyn/aglyn': 'aglyn',
}

function aglynHostExternals() {
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
          "if (!host) throw new Error('__AGLYN_PLUGIN_HOST__ is not set');\n" +
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
