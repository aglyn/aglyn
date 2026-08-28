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
 * The guards phase, run CONCURRENTLY (AGL-2486).
 *
 * The out-of-nx guard surfaces are ~54 separate `npm run` scripts. `gate.sh`
 * ran them in a serial `for` loop, which measured 1m09s of almost pure
 * process-startup latency: sampled individually they are 0.4s-5.5s each and
 * every one of them is a pure node script that reads tracked files and writes
 * nothing.
 *
 * ## Why running them together is safe, and how that was established
 *
 * Six of the guard scripts import `writeFileSync`, which is the only shape
 * that could make concurrency unsafe — two guards writing the same baseline
 * would interleave. Every one of those writes is behind an explicit
 * `if (write)` branch driven by a `--write`/`--update` flag that NONE of the
 * package.json guard scripts pass:
 *
 *   check-aglyn-barrel, check-jsx-barrel, check-brand-literals,
 *   check-hardcoded-colours, check-dependency-egress   -- `if (write)` only
 *   check-plugin-budgets                               -- `mkdtempSync`, own dir
 *
 * `generate:docs-help:check`, `generate:plugin-manifests:check` and
 * `sync:next-tsconfigs:check` are the `--check` halves of generators: they
 * compare and report, they do not emit. `test:gate-script` shells
 * `gate.sh --self-test`, which builds its fixtures under its own `mktemp -d`.
 *
 * So the guards share exactly one resource: the CPU. That is what
 * `--concurrency` bounds.
 *
 * ## The list is DERIVED, never hand-maintained
 *
 * gate.sh has always derived the guard list from the CI workflow files rather
 * than keeping a copy, so a guard added to CI is gated without anyone
 * remembering to add it here. That derivation moves into this script intact,
 * including the refusal that matters: deriving ZERO guards is a FAILURE, not
 * an empty phase. The workflow files moving must break the run loudly rather
 * than quietly gate nothing.
 *
 * ## Usage
 *
 *   node tools/scripts/run-guards.mjs                  # all, auto concurrency
 *   node tools/scripts/run-guards.mjs --concurrency 6
 *   node tools/scripts/run-guards.mjs --list           # print names, run none
 *   node tools/scripts/run-guards.mjs --self-test      # assert the derivation
 *
 * Exit code is the number of failing guards, capped at 250, so a caller
 * reading it bare gets a count as well as a verdict.
 */

import { execFile } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { availableParallelism, loadavg } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(fileURLToPath(import.meta.url), '..', '..', '..')

/**
 * The workflow files the guard list is read out of. Both are gate inputs in
 * their own right: `check:standalone-installs` asserts against nx-ci.yml's
 * text, and tools-guards.yml triggers on itself.
 */
const WORKFLOWS = [
  '.github/workflows/nx-ci.yml',
  '.github/workflows/tools-guards.yml',
]

/**
 * `typecheck` is excluded because the gate runs it as its own phase — it is
 * the workspace's only type gate and it is not a guard.
 */
const NOT_A_GUARD = new Set(['typecheck'])

/**
 * Guards that sweep the WHOLE repository rather than any one project, so no
 * affected-scoping may ever drop them (AGL-2486).
 *
 * This set is the answer to the question `nx affected` structurally cannot
 * answer. `nx affected` reasons over the project graph: a file belongs to a
 * project, a project has dependents, a change marks them affected. Every
 * guard below takes a different shape — it walks TRACKED FILES, or compares a
 * generated artifact against a source that is no project's file, and its
 * verdict can flip because of a commit that marks nothing affected at all.
 *
 * This is not theoretical. Of the four failures the 2026-08-22 gate found on
 * main, THREE were from this class: a raw NUL byte in a console component
 * (`check:nul-bytes` sweeps every tracked file), a banned word in a new
 * fixture (`check:brand-literals` sweeps apps/ libs/ cloud/), and a stale
 * generated pricing table (`check:pricing-tables` compares a tools/ JSON file
 * against the entitlement source). An affected-scoped run that honoured the
 * project graph would have missed all three.
 *
 * Membership is therefore by REASON, and the reason is always the same one:
 * the input that invalidates the guard is not the guard's project's source.
 * The list is not exhaustive of "guards that should always run" — it is the
 * subset whose always-running is load-bearing enough to state. Everything not
 * named here still runs in a full gate; `--only` is the sole thing that skips
 * a guard, and `--only` refuses to skip these.
 */
const REPO_WIDE = new Set([
  // Sweep every tracked file, or every file under apps/ libs/ cloud/.
  'check:nul-bytes',
  'check:brand-literals',
  'check:hardcoded-colours',
  'check:no-tax-identifiers',
  'check:residential-address',
  'check:personal-identifiers',
  'check:provider-key-exposure',
  'check:next-public-access',
  'check:contact-addresses',
  // Compare a GENERATED artifact against a source that is no project's file.
  'check:pricing-tables',
  'generate:docs-help:check',
  'generate:plugin-manifests:check',
  'sync:next-tsconfigs:check',
  'check:manifest-versions',
  // Walk every app's routes and every lib they reach; a cost only a bundler
  // or a graph walk can see, which a green typecheck and green tests miss.
  'check:app-router-graph',
  'check:jsx-barrel',
  'check:aglyn-barrel',
  'check:monaco-dompurify',
  // Assert against the workflow files and the package.json script table,
  // which belong to no nx project.
  'check:standalone-installs',
  'check:test-wiring',
  'check:lint-tools',
  'check:docs-self-host',
  // Reads every docs markdown page and every file under apps/docs/static/img.
  // An uncaptured screenshot is invalidated by a commit to the PAGE, and a
  // blank one by a commit to the IMAGE — neither of which is the guard's own
  // project source in the way an affected-scoped run would need.
  'check:docs-screenshots',
  'check:marketing-width-doctrine',
])

/** Reads the guard names out of the CI workflows. Never hand-maintained. */
export function deriveGuards(read = (p) => readFileSync(join(root, p), 'utf8')) {
  const names = new Set()
  for (const wf of WORKFLOWS) {
    let text
    try {
      text = read(wf)
    } catch {
      continue
    }
    for (const line of text.split('\n')) {
      const m = /^\s+- run: npm run ([a-z0-9:_-]+)\s*$/.exec(line)
      if (m && !NOT_A_GUARD.has(m[1])) names.add(m[1])
    }
  }
  return [...names].sort()
}

/**
 * How many guards to run at once.
 *
 * Same reasoning as gate.sh's own parallelism: the pin exists because six
 * concurrent agents once drove this box to load 245, and a guard SIGKILLed
 * for memory reads exactly like a guard that failed. Guards are far lighter
 * than jest workers — most are a single file walk — so the floor is higher
 * and the ceiling is bounded by cores rather than by memory.
 */
export function chooseConcurrency(cores, load1) {
  const headroom = cores - load1
  if (headroom >= cores * 0.7) return Math.min(8, Math.max(4, cores - 2))
  if (headroom >= cores * 0.3) return 4
  return 2
}

const argv = process.argv.slice(2)
const flag = (name) => argv.includes(name)
const value = (name, fallback) => {
  const i = argv.indexOf(name)
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback
}

/* ------------------------------------------------------------------ self-test */
if (flag('--self-test')) {
  let pass = 0
  let fail = 0
  const ok = (label, cond) => {
    if (cond) {
      console.log('ok  ', label)
      pass++
    } else {
      console.error('FAIL', label)
      fail++
    }
  }

  const derived = deriveGuards()
  ok(`derives a non-empty guard list (${derived.length})`, derived.length > 20)
  ok('derives check:nul-bytes', derived.includes('check:nul-bytes'))
  ok('derives test:eslint-rules', derived.includes('test:eslint-rules'))
  ok('never derives bare typecheck', !derived.includes('typecheck'))

  // The derivation must FAIL, not silently return nothing, when the workflow
  // files move. Proven by handing it a reader that finds neither file.
  const empty = deriveGuards(() => {
    throw new Error('ENOENT')
  })
  ok('a missing workflow file derives zero (caller must refuse)', empty.length === 0)

  // Every repo-wide name must actually be a real npm script, or the refusal
  // below would protect a guard that does not exist.
  const scripts = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).scripts
  const ghosts = [...REPO_WIDE].filter((g) => !scripts[g])
  ok(`every REPO_WIDE guard is a real npm script${ghosts.length ? ` (${ghosts})` : ''}`, ghosts.length === 0)

  // ...and must actually be derived from CI, or it is a guard nothing runs.
  const undriven = [...REPO_WIDE].filter((g) => !derived.includes(g))
  ok(`every REPO_WIDE guard is wired into CI${undriven.length ? ` (${undriven})` : ''}`, undriven.length === 0)

  // The three classes that produced 2026-08-22's failures must be protected
  // from `--only`. Asserted by name: this is the whole point of the set.
  for (const g of ['check:nul-bytes', 'check:brand-literals', 'check:pricing-tables']) {
    ok(`${g} is repo-wide (survives --only)`, REPO_WIDE.has(g))
  }

  // `--only` must be additive with REPO_WIDE, never subtractive from it.
  const selected = select(derived, ['check:lint-tools'])
  ok('--only keeps the named guard', selected.includes('check:lint-tools'))
  ok('--only still runs check:nul-bytes', selected.includes('check:nul-bytes'))
  ok('--only drops an unrelated non-repo-wide guard', !selected.includes('test:legal-drift'))
  ok('--only is smaller than the full sweep', selected.length < derived.length)

  // Concurrency adapts rather than being pinned in either direction.
  ok('an idle 10-core box gets >= 4 concurrency', chooseConcurrency(10, 0.5) >= 4)
  ok('a box at load 20 falls back to 2', chooseConcurrency(10, 20) === 2)
  ok('load is read, not ignored', chooseConcurrency(10, 0.5) > chooseConcurrency(10, 20))

  console.log(`\nrun-guards self-test: ${pass} passed, ${fail} failed`)
  process.exit(fail ? 1 : 0)
}

/**
 * Narrows the guard list for an affected-scoped run.
 *
 * The narrowing is a UNION with REPO_WIDE, never an intersection: a caller
 * asking for two guards gets those two plus every repo-wide sweep. There is
 * no flag that turns the sweeps off, because the sweeps are the class that a
 * scoped run is worst at and that has actually broken main.
 */
export function select(derived, only, repoWideOnly = false) {
  if (repoWideOnly) return derived.filter((g) => REPO_WIDE.has(g))
  if (!only || only.length === 0) return derived
  const keep = new Set(only.filter((g) => derived.includes(g)))
  for (const g of derived) if (REPO_WIDE.has(g)) keep.add(g)
  return derived.filter((g) => keep.has(g))
}

/* ---------------------------------------------------------------------- main */
const derived = deriveGuards()
if (derived.length === 0) {
  console.error(
    'run-guards: derived ZERO guards from the CI workflows.\n' +
      `  looked in: ${WORKFLOWS.join(', ')}\n` +
      '  The workflow files moved or their step syntax changed. FIX THE QUERY —\n' +
      '  do not drop the phase. An empty guard sweep exits green and proves nothing.',
  )
  process.exit(250)
}

const only = value('--only', '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)
const repoWideOnly = flag('--repo-wide')
const guards = select(derived, only, repoWideOnly)

if (flag('--list')) {
  for (const g of guards) console.log(g)
  process.exit(0)
}

const requested = value('--concurrency', 'auto')
const concurrency =
  requested === 'auto'
    ? chooseConcurrency(availableParallelism(), loadavg()[0])
    : Math.max(1, Number(requested) || 1)

console.log(
  `guards: ${guards.length} of ${derived.length} derived` +
    (repoWideOnly
      ? ' (REPO-WIDE SWEEPS ONLY — this is not the full guard phase)'
      : only.length
        ? ` (--only ${only.join(',')} + ${REPO_WIDE.size} repo-wide sweeps)`
        : ' (full sweep)') +
    `, concurrency ${concurrency}` +
    (requested === 'auto' ? ` (auto; load ${loadavg()[0].toFixed(2)} on ${availableParallelism()} cores)` : ''),
)

const results = []
const queue = [...guards]

/**
 * One guard. The child's status is read BARE off the callback — nothing is
 * piped, filtered or tee'd, for the same reason gate.sh's `run()` keeps the
 * command and `code=$?` adjacent: a trailing filter returns its own status.
 */
function runGuard(name) {
  return new Promise((resolve) => {
    const started = Date.now()
    execFile(
      'npm',
      ['run', '--silent', name],
      { cwd: root, maxBuffer: 1 << 26, env: { ...process.env, FORCE_COLOR: '0' } },
      (err, stdout, stderr) => {
        resolve({
          name,
          code: err ? (typeof err.code === 'number' ? err.code : 1) : 0,
          ms: Date.now() - started,
          output: `${stdout || ''}${stderr || ''}`,
        })
      },
    )
  })
}

async function worker() {
  for (;;) {
    const name = queue.shift()
    if (!name) return
    const r = await runGuard(name)
    results.push(r)
    console.log(`${r.code === 0 ? 'PASS' : 'FAIL'} ${name} (${(r.ms / 1000).toFixed(1)}s)`)
  }
}

const started = Date.now()
await Promise.all(Array.from({ length: concurrency }, worker))

const failures = results.filter((r) => r.code !== 0)
/**
 * A failing guard's output is TAILED, not printed whole.
 *
 * `test:hardcoded-colours` fails with an 8KB JSON dump of all 333 measured
 * occurrences on a single line. Four such failures buried the phase's own
 * verdict under 40KB of noise, which is the same readability failure as a
 * green check nobody reads: the answer is present and nobody finds it. The
 * tail is where node's test runner and every check script put the summary.
 */
const TAIL_LINES = 40
const TAIL_COLS = 400
if (failures.length) {
  console.error('\n=== failing guards ===')
  for (const f of failures) {
    const lines = f.output.trimEnd().split('\n')
    const shown = lines.slice(-TAIL_LINES).map((l) => (l.length > TAIL_COLS ? `${l.slice(0, TAIL_COLS)}… [+${l.length - TAIL_COLS} chars]` : l))
    console.error(`\n--- ${f.name} (exit ${f.code}) ---`)
    if (lines.length > TAIL_LINES) console.error(`[… ${lines.length - TAIL_LINES} earlier lines; rerun \`npm run ${f.name}\` for all of it]`)
    console.error(shown.join('\n'))
  }
}

results.sort((a, b) => b.ms - a.ms)
console.log(
  `\nguards: ${results.length - failures.length}/${results.length} clean in ` +
    `${((Date.now() - started) / 1000).toFixed(1)}s ` +
    `(slowest: ${results.slice(0, 3).map((r) => `${r.name} ${(r.ms / 1000).toFixed(1)}s`).join(', ')})`,
)
if (existsSync(join(root, '.git')) && failures.length) {
  console.error(`\n${failures.length} guard(s) FAILED: ${failures.map((f) => f.name).join(', ')}`)
}
process.exit(Math.min(250, failures.length))
