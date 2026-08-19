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

// Fails when the monaco bundle we serve from our own origin stops matching the
// DOMPurify posture the four dismissed Dependabot alerts rest on (AGL-2300).
//
//   node tools/scripts/check-monaco-dompurify.mjs

import { createRequire } from 'node:module'
import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'

import {
  evaluateMonacoDompurify,
  formatMonacoDompurifyFailure,
  REVIEWED_DOMPURIFY_VERSION,
} from './lib/monaco-dompurify.mjs'

const require = createRequire(import.meta.url)

/**
 * Resolve monaco-editor's package root.
 *
 * Deliberately NOT `require.resolve('monaco-editor/package.json')`, for the
 * reason `tools/scripts/lib/sync-monaco-assets.js` spells out at length
 * (AGL-2051): 0.56.0 narrowed the `exports` map to `"./*": "./esm/vs/*.js"`,
 * which rewrites that subpath to a file that has never existed and reports it
 * as MODULE_NOT_FOUND — indistinguishable from the package being absent.
 * Resolve the ENTRY, which an `exports` map must always publish, and walk up.
 */
function resolveMonacoPackageDir() {
  let entry
  try {
    entry = require.resolve('monaco-editor')
  } catch {
    throw new Error(
      '[monaco-dompurify] `monaco-editor` is not installed, so the vendored ' +
        'DOMPurify posture cannot be checked. Run `npm ci`.',
    )
  }
  let dir = dirname(entry)
  while (dir !== dirname(dir)) {
    const manifest = join(dir, 'package.json')
    if (existsSync(manifest)) {
      try {
        if (JSON.parse(readFileSync(manifest, 'utf8')).name === 'monaco-editor') {
          return dir
        }
      } catch {
        /* unreadable manifest — not this package's root, keep walking */
      }
    }
    dir = dirname(dir)
  }
  throw new Error(
    `[monaco-dompurify] resolved monaco-editor to ${entry} but found no ` +
      'monaco-editor package.json above it.',
  )
}

/** Every `.js` under `dir`, recursively, as `{ path, source }`. */
function readJsFiles(dir, root) {
  const files = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      files.push(...readJsFiles(full, root))
    } else if (entry.name.endsWith('.js')) {
      files.push({ path: relative(root, full), source: readFileSync(full, 'utf8') })
    }
  }
  return files
}

const packageDir = resolveMonacoPackageDir()
const { version: monacoVersion } = JSON.parse(
  readFileSync(join(packageDir, 'package.json'), 'utf8'),
)

// `min/vs` and not `esm/`: `esm/` is readable, but the AMD build under `min/vs`
// is what sync-monaco-assets.js copies into apps/console/public and what the
// browser actually executes.
const vsDir = join(packageDir, 'min', 'vs')
if (!existsSync(vsDir)) {
  console.error(
    `[monaco-dompurify] monaco-editor@${monacoVersion} has no min/vs at ${vsDir}.`,
  )
  process.exit(1)
}

const files = readJsFiles(vsDir, vsDir)
const result = evaluateMonacoDompurify({ monacoVersion, files })

if (result.ok) {
  console.log(
    `monaco-editor@${monacoVersion} inlines DOMPurify ` +
      `${result.dompurifyVersion} (reviewed: ${REVIEWED_DOMPURIFY_VERSION}) in ` +
      `${result.bundles.join(', ')} and passes none of the config options the ` +
      `four dismissed advisories need (${files.length} .js file(s) scanned).`,
  )
  process.exit(0)
}

console.error(formatMonacoDompurifyFailure(result))
process.exit(1)
