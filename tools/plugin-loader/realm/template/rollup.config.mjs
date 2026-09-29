/**
 * Realm-bundle build (AGL-425 template). Emits ONE dependency-free ESM
 * file. `react`, `react/jsx-runtime`, `@aglyn/aglyn`, MUI
 * (`@mui/material`, any `@mui/material/<Component>` the host holds,
 * `@mui/material/styles`) become lookups on
 * `globalThis.__AGLYN_PLUGIN_HOST__`, where the app injects its own: your
 * elements render with the app's React, register into its registries and
 * follow the site's theme, and the page never downloads MUI twice; the
 * build refuses to compile in MUI, emotion or react-dom. Anything else you
 * import is compiled in and tree-shaken.
 *
 * Build: `npm run build` → dist/plugin.bundle.mjs. Publish that file
 * through the Aglyn marketplace pipeline; its sha256 becomes the content
 * pin every install verifies.
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
function aglynHostExternals() {
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
function productionEnv() {
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
