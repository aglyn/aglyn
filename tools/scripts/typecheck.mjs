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
 *
 * ## Why this script verifies the configs it skips (AGL-1723)
 *
 * It skips apps/*\/tsconfig.next.json by name (see findConfigs), which is the
 * right call — but it left those files with no local reader at all. When
 * AGL-1616 added a `paths` entry to tsconfig.base.json without re-running the
 * generator, the drift was invisible for a full day: the generated files carry
 * a do-not-edit header so nobody opens them, `typecheck` skipped them, and the
 * only thing that could notice was a whole-repo CI step that simply went red
 * unattended. Meanwhile several agents pointed a compiler at one by hand and
 * each re-diagnosed the same seven fabricated "Cannot find module" errors.
 *
 * So the preflight below runs the generator's own `--check` before any tsc.
 * This script is what everyone actually runs, it is the one command that
 * knowingly declines to read these files, and 0.15s buys the difference
 * between a named cause with its fix command and a wall of phantom TS2307s.
 * It reports rather than aborts: real type errors are still worth seeing in
 * the same run, and the drift verdict is repeated in the final summary.
 *
 * AGL-1728 added the generated plugin manifests to the same preflight for the
 * mirror-image reason. Those four ARE .ts files in apps/console and
 * apps/tenant, so this script does compile them — and compiles them clean
 * whether or not they still match plugins.config.json, since a plugin missing
 * from a manifest is not a type error. Both cases end in the same place: a
 * green typecheck read as proof that a generated file matches its source,
 * when the compiler never had any way to tell.
 *
 * ## A per-project `tsc -p .../tsconfig.lib.json` is NOT this gate (AGL-1725)
 *
 * Every lib's tsconfig.lib.json carries `"exclude": ["**\/*.spec.ts", ...]`.
 * So `tsc -p libs/<x>/tsconfig.lib.json --noEmit` can exit 0 while the spec
 * file you just wrote does not compile — only tsconfig.spec.json reads it, and
 * CI runs this script, which runs both. AGL-1725 shipped a type error in
 * libs/aglyn/src/lib/app-utils/author-css.spec.ts behind exactly that: real
 * verification, pointed at a config that excluded the file it was verifying.
 * Verify with `npm run typecheck` (optionally `node tools/scripts/typecheck.mjs
 * libs/aglyn` to filter by path prefix) and read the exit code bare.
 *
 * ## `--changed` — the same gate, scoped to what you touched (AGL-2486)
 *
 * AGL-1725's lesson recurred on 2026-08-22: a spec built a component without
 * two required props, the component's own tsconfig was clean because the spec
 * is not in it, and the whole-workspace gate was the only reader that saw it —
 * at PROMOTION time, hours later.
 *
 * The gap is not that the author skipped verification. It is that the obvious
 * scoped command is the WRONG scoped command. `tsc -p <project>/tsconfig.lib
 * .json` and `tsc -p <app>/tsconfig.json` both exclude `**\/*.spec.ts*`; only
 * the sibling `tsconfig.spec.json` reads them, and there are 40 of those in
 * this workspace. So the author runs a real check, gets a real green, and the
 * spec they just wrote was never compiled by anything.
 *
 * `--changed` closes it by resolving changed files to their owning project
 * directory and then running EVERY tsconfig in that directory — lib, app and
 * spec together — rather than the one whose name looks right. It is the
 * scoped command that has the same coverage as the unscoped one for the files
 * you touched, and it is what `npm run precheck` runs.
 */

import { execFile, execFileSync } from 'node:child_process'
import { readdirSync, existsSync } from 'node:fs'
import { availableParallelism, loadavg } from 'node:os'
import { dirname, join, relative } from 'node:path'
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

const argv = process.argv.slice(2)

/**
 * Resolves changed files to the tsconfigs that could possibly read them.
 *
 * Walks UP from each changed file to the nearest ancestor directory holding
 * any tsconfig*.json, then takes ALL of that directory's configs. Taking all
 * of them is the entire point (see the `--changed` note in the header): the
 * spec config is a sibling of the lib config, and picking by name is what
 * silently drops specs from a scoped check.
 *
 * Walking up rather than matching prefixes also handles the app case, where
 * `apps/console/app/(app)/manage/user/page.tsx` is many levels below the
 * configs that read it.
 */
export function configsForFiles(files, allConfigs) {
  const byDir = new Map()
  for (const c of allConfigs) {
    const d = dirname(c)
    if (!byDir.has(d)) byDir.set(d, [])
    byDir.get(d).push(c)
  }
  const picked = new Set()
  for (const f of files) {
    let d = dirname(f)
    for (;;) {
      if (byDir.has(d)) {
        for (const c of byDir.get(d)) picked.add(c)
        break
      }
      const up = dirname(d)
      if (up === d || d === '.' || d === '') break
      d = up
    }
  }
  return [...picked].sort()
}

/**
 * Changed files: staged, unstaged, untracked, and anything already committed
 * on this branch but not on the base. All four, because "did I break a spec"
 * has to be answerable before the commit AND before the push, and an agent
 * that committed three times still wants one verdict over the lot.
 */
function changedFiles(base) {
  const git = (args) => {
    try {
      return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).split('\n').filter(Boolean)
    } catch {
      return []
    }
  }
  const merged = new Set([
    ...git(['diff', '--name-only', '--diff-filter=ACMR']),
    ...git(['diff', '--cached', '--name-only', '--diff-filter=ACMR']),
    ...git(['ls-files', '--others', '--exclude-standard']),
    ...git(['diff', '--name-only', '--diff-filter=ACMR', `${base}...HEAD`]),
  ])
  return [...merged].filter((f) => /\.(ts|tsx|mts|cts)$/.test(f))
}

const allConfigs = findConfigs(root, [])
let configs
let scopeLabel

const changedIdx = argv.indexOf('--changed')
if (changedIdx >= 0) {
  const base = argv[changedIdx + 1]?.startsWith('--') || !argv[changedIdx + 1] ? 'origin/main' : argv[changedIdx + 1]
  const files = changedFiles(base)
  configs = configsForFiles(files, allConfigs)
  const specs = configs.filter((c) => c.endsWith('tsconfig.spec.json')).length
  scopeLabel =
    `--changed vs ${base}: ${files.length} changed .ts/.tsx file(s) -> ` +
    `${configs.length} tsconfig(s), ${specs} of them spec configs`
  if (files.length && configs.length === 0) {
    console.error(
      `typecheck --changed: ${files.length} changed file(s) resolved to NO tsconfig.\n` +
        '  They live outside every project (tools/ is .mjs, apps/docs is standalone).\n' +
        '  This proves nothing about types. Run `npm run typecheck` if that is unexpected.',
    )
  }
} else {
  const filters = argv.filter((a) => !a.startsWith('--'))
  configs = allConfigs.filter((c) => filters.length === 0 || filters.some((f) => c.startsWith(f)))
  scopeLabel = filters.length ? `filtered to ${filters.join(', ')}` : 'whole workspace'
}
console.log(`typecheck: ${configs.length}/${allConfigs.length} configs (${scopeLabel})`)

if (!existsSync(TSC)) {
  console.error('native tsc not found at', TSC, '- run npm install')
  process.exit(1)
}

/**
 * Preflight: generated files whose staleness this compiler cannot see.
 *
 * Each entry runs its own generator's `--check` before any tsc. They run
 * regardless of `filters` — a generated file no longer matching its source is
 * a workspace-level fact, and the input that invalidates it (tsconfig.base
 * .json, plugins.config.json) is no app's source, so there is no project to
 * scope it to.
 *
 * `summary` is repeated after the tsc results, because a wall of compiler
 * output scrolls the preflight off the screen and the whole point is that the
 * cause gets named rather than inferred.
 */
const GENERATED = [
  {
    // Skipped by findConfigs BY NAME, so tsc never reads them at all. When
    // they go stale the alias map fabricates "Cannot find module" (AGL-1723).
    script: 'sync-next-tsconfigs.mjs',
    summary:
      'apps/*/tsconfig.next.json are STALE — run `node tools/scripts/sync-next-tsconfigs.mjs`.\n' +
      'Any "Cannot find module" errors above may be fabricated by the stale alias map.',
  },
  {
    // The opposite failure, same consequence (AGL-1728). These four ARE .ts
    // files inside apps/console and apps/tenant, so tsc compiles them — and
    // compiles them clean whether or not they still describe
    // plugins.config.json, because nothing about a missing plugin entry is a
    // type error. A green typecheck is therefore a plausible, wrong answer to
    // "do these match their source", and the manifests are the only thing
    // telling the runtime loader what to activate.
    script: 'generate-plugin-manifests.mjs',
    summary:
      'The generated plugin manifests are STALE — run `node tools/scripts/generate-plugin-manifests.mjs`.\n' +
      'They compile clean either way; the runtime loader is what gets the wrong plugin set.',
  },
]

/** Runs one generator's `--check`. Reports; never throws. */
async function checkGenerated({ script }) {
  try {
    await run(
      process.execPath,
      [join(root, 'tools', 'scripts', script), '--check'],
      { cwd: root },
    )
    return true
  } catch (err) {
    console.error(String(err.stderr || err.stdout || err.message).trimEnd())
    return false
  }
}

const staleGenerated = (
  await Promise.all(
    GENERATED.map(async (g) => ((await checkGenerated(g)) ? null : g)),
  )
).filter(Boolean)

/**
 * How many `tsc` processes at once (AGL-2486).
 *
 * This was pinned at 4 and 4 is right for exactly one machine state. The
 * native (Go) compiler is CPU-bound and short-lived, so on an idle 10-core box
 * 4 leaves more than half the machine unused across a 2m12s phase; with six
 * agents on the box, 4 more compilers is what turns a slow run into a stalled
 * one. `TYPECHECK_CONCURRENCY` pins it explicitly where a caller knows better
 * (gate.sh passes its own adapted budget down, so the whole gate answers to
 * one reading of the load rather than each phase guessing separately).
 */
const CONCURRENCY = (() => {
  const pinned = Number(process.env.TYPECHECK_CONCURRENCY)
  if (Number.isFinite(pinned) && pinned >= 1) return Math.floor(pinned)
  const cores = availableParallelism()
  const headroom = cores - loadavg()[0]
  if (headroom >= cores * 0.7) return Math.max(4, Math.min(8, cores - 2))
  if (headroom >= cores * 0.3) return 4
  return 2
})()
console.log(`typecheck: concurrency ${CONCURRENCY} (${availableParallelism()} cores, load ${loadavg()[0].toFixed(2)})`)
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
for (const { summary } of staleGenerated) console.error(summary)
process.exit(failed || staleGenerated.length ? 1 : 0)
