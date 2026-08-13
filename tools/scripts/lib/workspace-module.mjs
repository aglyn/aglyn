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
 * Load a workspace TypeScript module from a plain `.mjs` operator script
 * (AGL-1481).
 *
 * This exists so an operator script can CALL the function a served path calls
 * instead of copying it. `tools/scripts/erase-tenant.mjs` reimplemented
 * `eraseOrg`, and within a week of four new sweeps landing in the shared
 * function the script was missing all four and reporting success without
 * them. A second implementation of a cascade delete is a divergence with a
 * schedule; the only durable fix is one implementation and a way to reach it.
 *
 * `jiti` rather than `@swc-node/register`: the register hook resolves through
 * Node's ESM algorithm, which rejects the extensionless bare specifiers this
 * graph contains (`lodash-es/cloneDeep`, reached transitively through
 * `@aglyn/aglyn/server`). jiti resolves them the way the bundlers do. Measured
 * both, 2026-08-13.
 *
 * The alias map is derived FROM `tsconfig.base.json` at run time rather than
 * transcribed, so a new `@aglyn/*` path is reachable here the moment it is
 * added — the same reasoning as the rest of this issue.
 */

import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createJiti } from 'jiti'

const WORKSPACE_ROOT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
)

/**
 * `tsconfig.base.json`'s `paths` as a jiti alias map.
 *
 * Two forms have to stay distinct. `"@aglyn/x"` points at a barrel
 * (`src/index.ts`) and `"@aglyn/x/*"` points at a directory (`src/lib/`); jiti
 * matches by prefix, so the wildcard entry keeps its trailing slash and the
 * exact entry does not. Collapsing them — dropping `/*` from both keys — makes
 * the wildcard overwrite the barrel and every bare import of the library
 * resolves to a directory that has no entry point.
 */
function workspaceAliases() {
  const tsconfig = JSON.parse(
    readFileSync(join(WORKSPACE_ROOT, 'tsconfig.base.json'), 'utf8'),
  )
  const alias = {}
  for (const [specifier, targets] of Object.entries(
    tsconfig.compilerOptions?.paths ?? {},
  )) {
    const target = targets[0]
    if (!target) continue
    alias[specifier.endsWith('/*') ? specifier.slice(0, -1) : specifier] = join(
      WORKSPACE_ROOT,
      target.replace(/^\.\//, '').replace(/\*$/, ''),
    )
  }
  return alias
}

let loader

/**
 * Import a workspace module by its path relative to the repository root, e.g.
 * `libs/tenant/data/admin/src/lib/server/erase.ts`.
 *
 * Note for callers with module-load side effects: `libs/**` server modules
 * initialize the firebase-admin default app on import. Initialize the app
 * YOURSELF before calling this if you need to control which project or
 * credential it uses.
 */
export async function importWorkspaceModule(relativePath) {
  loader ??= createJiti(import.meta.url, { alias: workspaceAliases() })
  return loader.import(join(WORKSPACE_ROOT, relativePath))
}

export { WORKSPACE_ROOT }
