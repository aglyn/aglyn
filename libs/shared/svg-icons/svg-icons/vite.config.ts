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

/// <reference types="vitest" />
import react from '@vitejs/plugin-react'
import { copyFileSync } from 'fs'
import { join } from 'path'
import { defineConfig } from 'vite'
import dts from 'vite-plugin-dts'
import svgr from 'vite-plugin-svgr'

const outDir = join(__dirname, '../../../../dist/libs/shared/svg-icons/svg-icons')

export default defineConfig({
  resolve: {
    tsconfigPaths: true,
  },
  root: __dirname,
  cacheDir: '../../../../node_modules/.vite/shared-svg-icons-svg-icons',

  plugins: [
    dts({
      entryRoot: 'src',
      tsconfigPath: join(__dirname, 'tsconfig.lib.json'),
      // skipDiagnostics: true,
    }),
    react(),
    svgr({
      include: '**/*.svg',
      svgrOptions: { exportType: 'named' },
    }),
    // The lib's package.json is already shaped for dist (./index.js,
    // ./index.mjs, ./index.d.ts). The @nx/vite:build executor used to copy
    // it in; the inferred @nx/vite/plugin target runs plain `vite build`,
    // which does not, so the build has to (AGL-4218).
    {
      name: 'aglyn-copy-package-json',
      apply: 'build',
      writeBundle() {
        copyFileSync(join(__dirname, 'package.json'), join(outDir, 'package.json'))
      },
    },
  ],

  // Uncomment this if you are using workers.
  // worker: {
  //  plugins: [
  //    viteTsConfigPaths({
  //      root: '../../../../',
  //    }),
  //  ],
  // },

  // Configuration for building your library.
  // See: https://vitejs.dev/guide/build.html#library-mode
  build: {
    outDir,
    // Start every build from an empty directory (AGL-3201). Vite leaves an
    // outDir outside the project root alone unless told to, and the Nx
    // executor copies the lib's package.json only when the output has none,
    // so a build after a release kept the PREVIOUS release's manifest, and
    // the Nx cache then stored it under the new hash. The consumer proof
    // packed `@aglyn/shared-svg-icons@1.0.0-beta.219` from a beta.220 tree.
    emptyOutDir: true,
    reportCompressedSize: true,
    commonjsOptions: { transformMixedEsModules: true },
    lib: {
      // Could also be a dictionary or array of multiple entry points.
      entry: 'src/index.ts',
      name: 'shared-svg-icons-svg-icons',
      fileName: 'index',
      // Change this to the formats you want to support.
      // Don't forgot to update your package.json as well.
      formats: ['es', 'cjs'],
    },
    rolldownOptions: {
      // External packages that should not be bundled into your library.
      external: ['react', 'react-dom', 'react/jsx-runtime'],
    },
  },
})
