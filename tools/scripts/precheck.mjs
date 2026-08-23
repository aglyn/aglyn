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
 * `npm run precheck` — what an agent runs BEFORE committing (AGL-2486).
 *
 * ## The hole this exists to close
 *
 * On 2026-08-22 the promotion gate came back red with four failures that had
 * been sitting on `main` for hours. Every one of them was invisible to the
 * per-project check its author had run, and two whole CLASSES explain all
 * four:
 *
 *   1. THE SPEC-TSCONFIG GAP. A spec built a component without two required
 *      props. Its project's `tsconfig.lib.json` carries
 *      `"exclude": ["**\/*.spec.ts", ...]`, so `tsc -p .../tsconfig.lib.json`
 *      exited 0 — a real check, pointed at a config that excluded the file it
 *      was verifying. Only the sibling `tsconfig.spec.json` reads specs, and
 *      the workspace has 40 of those. This is AGL-1725 recurring, which is
 *      what makes it a tooling gap rather than an author's oversight: the
 *      obvious scoped command is the wrong scoped command, so being careful
 *      does not save you.
 *
 *   2. THE REPO-WIDE SWEEPS. Three of the four — a raw NUL byte, a banned
 *      brand word in a fixture, a stale generated pricing table — come from
 *      guards that walk every tracked file or compare a generated artifact
 *      against a source belonging to no project. Nothing project-scoped can
 *      see them, in either direction: an author scoping to their project
 *      misses them, and so does `nx affected`.
 *
 * So this runs exactly those two things, scoped the only ways that are sound:
 * the type check follows the CHANGED FILES to every tsconfig that could read
 * them (spec configs included, by construction), and the guards are the
 * repo-wide sweeps in full, because there is no correct way to narrow them.
 *
 * ## What it does NOT prove
 *
 * Stated loudly at the end of every run, because a green check is only
 * evidence of what it read:
 *
 *   - no tests ran            -> `npx nx test <project> --maxWorkers=2`
 *   - no lint ran             -> `npx nx lint <project>`
 *   - no PRODUCTION build ran -> only `tools/gate.sh` does that
 *   - the ~34 project-shaped guards did not run
 *
 * It is a pre-commit filter for the classes that reach the gate, not a gate.
 * The gate is `tools/gate.sh`, and nothing here replaces it.
 */

import { spawn } from 'node:child_process'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(fileURLToPath(import.meta.url), '..', '..', '..')
const argv = process.argv.slice(2)
const base = (() => {
  const i = argv.indexOf('--base')
  return i >= 0 && argv[i + 1] ? argv[i + 1] : 'origin/main'
})()

/** Runs one step, streaming its output. Status read bare off `close`. */
function step(label, cmd, args) {
  return new Promise((resolve) => {
    const started = Date.now()
    console.log(`\n\x1b[1m>>> ${label}\x1b[0m`)
    const child = spawn(cmd, args, { cwd: root, stdio: 'inherit' })
    child.on('close', (code) => {
      const ms = Date.now() - started
      console.log(`<<< ${label} EXIT=${code} (${(ms / 1000).toFixed(1)}s)`)
      resolve({ label, code: code ?? 1, ms })
    })
  })
}

const started = Date.now()

// Sequential, not concurrent: both steps are internally parallel already and
// stacking them doubles the load reading each one adapts to. The whole run is
// under a minute; the ordering also puts the type errors first, which is what
// an author is most often here for.
const results = []
results.push(
  await step('typecheck (changed files, spec configs included)', process.execPath, [
    join(root, 'tools', 'scripts', 'typecheck.mjs'),
    '--changed',
    base,
  ]),
)
results.push(
  await step('guards (repo-wide sweeps)', process.execPath, [
    join(root, 'tools', 'scripts', 'run-guards.mjs'),
    '--repo-wide',
  ]),
)

const failed = results.filter((r) => r.code !== 0)
console.log(`\n${'='.repeat(72)}`)
for (const r of results) console.log(`${r.code === 0 ? 'PASS' : 'FAIL'}  ${r.label}  (${(r.ms / 1000).toFixed(1)}s)`)
console.log(`precheck: ${failed.length} failing step(s) in ${((Date.now() - started) / 1000).toFixed(1)}s`)

// Never printed as a footnote to a green. The point of naming the gaps is that
// somebody reads them at the moment they are deciding they are done.
console.log(
  '\nprecheck did NOT run: tests, lint, PRODUCTION builds, or the ~34\n' +
    'project-shaped guards. It covers the two classes that reach the promotion\n' +
    'gate — the spec-tsconfig gap and the repo-wide sweeps. For the rest:\n' +
    '  npx nx test <project> --maxWorkers=2      npx nx lint <project>\n' +
    '  tools/gate.sh --affected                  (adds lint, tests, prod builds)',
)

process.exit(failed.length ? 1 : 0)
