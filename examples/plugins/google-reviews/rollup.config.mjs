/**
 * @license
 * Copyright 2026 Aglyn LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Builds the Google reviews bundle with the realm template's rules:
 *
 *   npx rollup -c examples/plugins/google-reviews/rollup.config.mjs
 *
 * `react`, `@aglyn/aglyn` and `@mui/material` become lookups on the host
 * (`aglynHostExternals`), so the bundle carries none of them and imports
 * nothing. The output is not minified, so a reviewer reads what ships.
 */

import commonjs from '@rollup/plugin-commonjs'
import { nodeResolve } from '@rollup/plugin-node-resolve'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { aglynHostExternals, productionEnv } from '../../../tools/plugin-loader/realm/rollup.config.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))

export default {
  input: join(HERE, 'src/index.js'),
  output: {
    file: join(HERE, 'dist/plugin.bundle.mjs'),
    format: 'es',
    sourcemap: false,
  },
  plugins: [
    aglynHostExternals(),
    nodeResolve({ browser: true, extensions: ['.mjs', '.js', '.json'] }),
    commonjs(),
    productionEnv(),
  ],
}
