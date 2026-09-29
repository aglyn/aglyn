/**
 * @license
 * Copyright 2026 Aglyn LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * Builds the Calculators marketplace bundle (AGL-3394):
 *
 *   npx rollup -c libs/plugins/calculator/rollup.config.mjs
 *
 * `@aglyn/aglyn`, `react` and `@mui/material` resolve to the host through the
 * realm config's externals, so the bundle carries none of them. Everything
 * else is the lib's own source.
 */

import commonjs from '@rollup/plugin-commonjs'
import { nodeResolve } from '@rollup/plugin-node-resolve'
import { minify, transform } from '@swc/core'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  aglynHostExternals,
  productionEnv,
} from '../../../tools/plugin-loader/realm/rollup.config.mjs'

const LIB = dirname(fileURLToPath(import.meta.url))
const ROOT = join(LIB, '..', '..', '..')

/** TypeScript and JSX, with the automatic runtime the host provides. */
function swc() {
  return {
    name: 'aglyn-swc',
    async transform(code, id) {
      if (!/\.(ts|tsx)$/.test(id)) return null
      const output = await transform(code, {
        filename: id,
        isModule: true,
        sourceMaps: false,
        jsc: {
          target: 'es2020',
          parser: { syntax: 'typescript', tsx: id.endsWith('.tsx') },
          transform: { react: { runtime: 'automatic' } },
        },
      })
      return { code: output.code, map: null }
    },
  }
}

/** What a site downloads is minified, the way the host's own chunks are. */
function minified() {
  return {
    name: 'aglyn-minify',
    async renderChunk(code) {
      const output = await minify(code, { compress: true, mangle: true, module: true })
      return { code: output.code, map: null }
    },
  }
}

export default {
  input: join(LIB, 'src/bundle.ts'),
  output: {
    file: join(ROOT, 'dist/marketplace/calculator/plugin.bundle.mjs'),
    format: 'es',
    sourcemap: false,
  },
  plugins: [
    aglynHostExternals(),
    swc(),
    nodeResolve({ browser: true, extensions: ['.ts', '.tsx', '.mjs', '.js', '.json'] }),
    commonjs(),
    productionEnv(),
    minified(),
  ],
}
