#!/usr/bin/env node
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
 * Whole-tree check that no import crosses App Router's two module graphs
 * (AGL-1349). Exits 1 with the full import trace when one does.
 *
 * ```
 * npm run check:app-router-graph
 * node tools/scripts/check-app-router-graph.mjs --json
 * ```
 *
 * The `aglyn/no-cross-graph-import` ESLint rule reports the same invariant
 * per file as you type; this is the single-pass form, used by
 * `apps/console/specs/app-router-graph.spec.ts` (which cannot `require` an
 * ESM analyser directly) and runnable on its own in CI.
 */

import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { analyzeAppRouterGraph } from '../lint-rules/lib/app-router-graph.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const asJson = process.argv.includes('--json')

const graph = analyzeAppRouterGraph(ROOT)

if (asJson) {
  process.stdout.write(
    JSON.stringify({
      serverEntries: graph.serverEntries.size,
      serverModules: graph.serverModules.size,
      clientModules: graph.clientModules.size,
      files: graph.files.length,
      classification: {
        clientBarrel: graph.isClientOnly(join(ROOT, 'libs/aglyn/src/index.ts')),
        clientBarrelIsServerOnly: graph.isServerOnly(
          join(ROOT, 'libs/aglyn/src/index.ts'),
        ),
        serverBarrel: graph.isServerOnly(join(ROOT, 'libs/aglyn/src/server.ts')),
        serverBarrelIsClientOnly: graph.isClientOnly(
          join(ROOT, 'libs/aglyn/src/server.ts'),
        ),
        planEntitlementsClientOnly: graph.isClientOnly(
          join(ROOT, 'libs/aglyn/src/lib/app-utils/plan-entitlements.ts'),
        ),
        planEntitlementsServerOnly: graph.isServerOnly(
          join(ROOT, 'libs/aglyn/src/lib/app-utils/plan-entitlements.ts'),
        ),
      },
      usageMetering: {
        inServerGraph: graph.serverModules.has(
          join(ROOT, 'apps/console/utils/usage-metering.ts'),
        ),
        inClientGraph: graph.clientModules.has(
          join(ROOT, 'apps/console/utils/usage-metering.ts'),
        ),
      },
      violations: graph.violations.map((violation) => ({
        direction: violation.direction,
        file: violation.file,
        line: violation.line,
        specifier: violation.specifier,
        reachedFrom: violation.reachedFrom,
        through: violation.through,
      })),
    }),
  )
  process.exit(graph.violations.length === 0 ? 0 : 1)
}

console.log(
  `Walked ${graph.files.length} modules: ${graph.serverEntries.size} App Router ` +
    `server entries, ${graph.serverModules.size} server / ` +
    `${graph.clientModules.size} client modules.`,
)

if (graph.violations.length === 0) {
  console.log('No import crosses the server/client boundary.')
  process.exit(0)
}

for (const violation of graph.violations) {
  const side =
    violation.direction === 'client-into-server'
      ? 'CLIENT-only module reached from a SERVER graph'
      : 'SERVER-only module reached from the BROWSER bundle'
  console.error('')
  console.error(`${violation.file}:${violation.line}  ${side}`)
  console.error(`  imports '${violation.specifier}'`)
  console.error(`  reached from:  ${violation.reachedFrom.join('\n              -> ')}`)
  console.error(`  which reaches: ${violation.through.join('\n              -> ')}`)
}
console.error('')
console.error(
  `${graph.violations.length} violation(s). Name the module underneath the ` +
    'entry barrel (`@aglyn/aglyn/foundation`, ' +
    '`@aglyn/aglyn/app-utils/plan-entitlements`) — AGL-405/1349.',
)
process.exit(1)
