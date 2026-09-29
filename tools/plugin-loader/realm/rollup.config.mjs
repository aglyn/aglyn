/**
 * Realm-bundle build template (AGL-420) — for TRUSTED marketplace plugins
 * (`trust: 'realm'`) that load into the app realm instead of the sandboxed
 * PluginFrame. Copy this config into your plugin repo and point `input` at
 * your entry.
 *
 *   npx rollup -c tools/plugin-loader/realm/rollup.config.mjs
 *
 * The one rule of the realm ABI: bundles import NOTHING at runtime. What
 * must be one instance across the app and the bundle — React, core's
 * registries, the site's theme and style cache — and the libraries the site
 * already runs (MUI) come from the host's `globalThis.__AGLYN_PLUGIN_HOST__`,
 * and this config rewrites those imports into lookups on it. It refuses to
 * compile MUI or emotion in: the page would download them twice. Everything
 * else you import is compiled in and tree-shaken.
 *
 * Your entry must export `register(host)` (site/console surfaces) and/or
 * `registerApi()` (server handler bundles, loaded only behind
 * PLUGIN_REMOTE_SERVER). Publish the emitted file through the standard
 * marketplace pipeline; a staff member signs the version to grant realm
 * trust.
 */

import commonjs from '@rollup/plugin-commonjs'
import { nodeResolve } from '@rollup/plugin-node-resolve'

/**
 * The libraries a realm bundle takes from the HOST instead of compiling in
 * (AGL-3392), each a key of `__AGLYN_PLUGIN_HOST__` (`PLUGIN_HOST_ABI_KEYS` in
 * `@aglyn/aglyn`). Two reasons put a library here: it must be ONE instance
 * across the app and the bundle (React, core's registries, the site's theme
 * and style cache), or the site already runs it and a second copy would be
 * downloaded twice (MUI). The verifier refuses a name the host module does not
 * hold: `@aglyn/aglyn` and `@mui/material` are held as reviewed surfaces.
 */
const HOST_MODULES = {
  react: 'React',
  'react/jsx-runtime': 'jsxRuntime',
  '@aglyn/aglyn': 'aglyn',
  '@mui/material': 'mui',
  '@mui/material/utils': 'mui',
  '@mui/material/styles': 'muiStyles',
}

/**
 * Packages a realm bundle may never compile in: the site already runs them,
 * so any part of them in a bundle is a second copy — and a second copy of
 * MUI's styling runtime also misses the site's theme and style cache.
 */
/** Host modules whose default import may need unwrapping from a namespace. */
const DEFAULT_INTEROP = new Set(['React', 'jsxRuntime'])

const NEVER_COMPILED_IN =
  /^(react-dom|@mui\/(material|system|utils|styled-engine|private-theming|base|lab)|@emotion\/[^/]+)(\/|$)/

/**
 * Rewrites host imports into lookups on the host ABI. `@mui/material/Button`
 * is the `Button` the host holds, with the rest of MUI's surface available by
 * name (`import Button, { buttonClasses } from '@mui/material/Button'`). A
 * default import of a whole module reads its `default` when it has one, and
 * the module itself otherwise (`import React from 'react'`).
 */
export function aglynHostExternals() {
  return {
    name: 'aglyn-host-externals',
    resolveId(source) {
      if (source in HOST_MODULES) return `\0aglyn-host:${HOST_MODULES[source]}`
      const component = /^@mui\/material\/([A-Z][A-Za-z0-9]*)$/.exec(source)
      if (component) return `\0aglyn-host-member:mui:${component[1]}`
      if (NEVER_COMPILED_IN.test(source)) {
        this.error(
          `"${source}" is not on the Aglyn host, and a realm bundle never ` +
            'compiles it in: the site already runs it, so a copy would be ' +
            'downloaded twice. Use "@mui/material", ' +
            '"@mui/material/<Component>" or "@mui/material/styles" (its ' +
            '`styled`, `css` and `keyframes` style through the site\'s cache).',
        )
      }
      return null
    },
    load(id) {
      const lookup = (key) =>
        'const host = globalThis.__AGLYN_PLUGIN_HOST__;\n' +
        "if (!host) throw new Error('__AGLYN_PLUGIN_HOST__ is not set');\n" +
        `if (!(${key} in host)) throw new Error('this Aglyn host does not provide ' + ${key});\n` +
        `export const __aglynHostModule = host[${key}];\n`
      if (id.startsWith('\0aglyn-host:')) {
        const name = id.slice('\0aglyn-host:'.length)
        const key = JSON.stringify(name)
        // Only React's modules can be a namespace with a `default` on it. Core
        // and MUI have none, and reading one would be a read of a name their
        // host surface does not hold.
        const defaultExport = DEFAULT_INTEROP.has(name)
          ? 'export default __aglynHostModule.default !== undefined ? __aglynHostModule.default : __aglynHostModule;\n'
          : 'export default __aglynHostModule;\n'
        return {
          code: lookup(key) + defaultExport,
          syntheticNamedExports: '__aglynHostModule',
        }
      }
      if (id.startsWith('\0aglyn-host-member:')) {
        const [key, member] = id.slice('\0aglyn-host-member:'.length).split(':')
        return {
          code: lookup(JSON.stringify(key)) + `export default __aglynHostModule[${JSON.stringify(member)}];\n`,
          syntheticNamedExports: '__aglynHostModule',
        }
      }
      return null
    },
  }
}

/** Compiled-in libraries read `process.env.NODE_ENV`; a bundle is production. */
export function productionEnv() {
  return {
    name: 'aglyn-production-env',
    transform(code) {
      if (!code.includes('process.env.NODE_ENV')) return null
      return { code: code.replaceAll('process.env.NODE_ENV', '"production"'), map: null }
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
  plugins: [
    aglynHostExternals(),
    nodeResolve({ browser: true, extensions: ['.mjs', '.js', '.jsx', '.json'] }),
    commonjs(),
    productionEnv(),
  ],
}
