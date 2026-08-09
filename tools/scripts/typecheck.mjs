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
 * Workspace type-check driver for the native TypeScript 7 compiler (AGL-460).
 *
 * Runs `tsc --noEmit` (from @typescript/native, the Go compiler) over every
 * project tsconfig in the workspace. Builds don't type-check here (swc/rollup
 * strip types; jest uses babel/swc transforms), so this script is the only
 * whole-workspace type gate. Usage: `npm run typecheck` or
 * `node tools/scripts/typecheck.mjs [pathPrefix ...]` to filter.
 */

import { execFile } from 'node:child_process'
import { readdirSync, existsSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const run = promisify(execFile)
const root = join(fileURLToPath(import.meta.url), '..', '..', '..')

const TSC = join(root, 'node_modules', '@typescript', 'native', 'bin', 'tsc')

// Not type-checkable as standalone programs, or tracked debt:
// - tsconfig.base.json: shared base, compiling it lumps the whole repo into
//   one program with conflicting globals.
// - tools/: no .ts inputs (scripts are .mjs) -> TS18003.
// - apps/docs: standalone Docusaurus package with its own TypeScript.
const SKIP = [
  'tsconfig.base.json',
  'tools/',
  'apps/docs/',
]

// `.claude` holds agent worktrees — separate checkouts of this same repo, each
// with its own copy of every tsconfig and no `node_modules`. Walking them made
// a clean run report 437 failures instead of 10, which is how a real one hides
// (AGL-1323). A worktree type-checks itself, from its own root.
const PRUNE = new Set([
  'node_modules',
  'dist',
  '.next',
  '.docusaurus',
  '.git',
  '.claude',
])

function findConfigs(dir, acc) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!PRUNE.has(entry.name)) findConfigs(join(dir, entry.name), acc)
    } else if (/^tsconfig.*\.json$/.test(entry.name)) {
      // tsconfig.next.json is generated for Next's app-dir-anchored paths
      // resolution (tools/scripts/sync-next-tsconfigs.mjs); checking it
      // would double-check each app with redundant alias maps.
      if (entry.name === 'tsconfig.next.json') continue
      const rel = relative(root, join(dir, entry.name))
      if (!SKIP.some((s) => rel === s || rel.startsWith(s))) acc.push(rel)
    }
  }
  return acc
}

const filters = process.argv.slice(2)
const configs = findConfigs(root, []).filter(
  (c) => filters.length === 0 || filters.some((f) => c.startsWith(f)),
)

if (!existsSync(TSC)) {
  console.error('native tsc not found at', TSC, '- run npm install')
  process.exit(1)
}

const CONCURRENCY = 4
let failed = 0
const queue = [...configs]

async function worker() {
  for (;;) {
    const cfg = queue.shift()
    if (!cfg) return
    try {
      await run(TSC, ['-p', cfg, '--noEmit'], { cwd: root, maxBuffer: 1 << 24 })
      console.log('PASS', cfg)
    } catch (err) {
      failed++
      console.error('FAIL', cfg)
      console.error(String(err.stdout || err.message).trimEnd())
    }
  }
}

await Promise.all(Array.from({ length: CONCURRENCY }, worker))
console.log(`\n${configs.length - failed}/${configs.length} configs clean`)
process.exit(failed ? 1 : 0)
