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

// Fails when a test file has no runner, or a `test` target has no tests
// (AGL-2376, AGL-2377).
//
//   npm run check:test-wiring
//
// See tools/scripts/lib/test-wiring.mjs for what each failure means and why
// `passWithNoTests` is banned rather than used.

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  UNTESTED_PROJECTS,
  evaluateTestWiring,
  formatFailure,
} from './lib/test-wiring.mjs'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

/**
 * Ask git, never the filesystem (AGL-2116). A filesystem walk of this repo
 * sweeps `apps/console/.next/**`, where a Turbopack chunk happens to inline
 * the string `cloud/hosts-list-constraint.spec.mjs` — so the answer would
 * depend on whether the person running it had built the console.
 */
const ls = (...patterns) =>
  execFileSync('git', ['ls-files', '-z', ...patterns], {
    cwd: repoRoot,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  })
    .split('\0')
    .filter(Boolean)
    .filter((file) => !file.split('/').includes('node_modules'))

const read = (file) => readFileSync(join(repoRoot, file), 'utf8')

// Every tracked test file no jest rootDir covers. jest only ever roots at an
// nx project, and neither tools/ nor cloud/ is one.
//
// ⚠️ BOTH depths, deliberately. git's `**` pathspec requires at least one
// intervening directory, so `cloud/**/*.spec.mjs` matches
// `cloud/rules-tests/x.spec.mjs` and does NOT match `cloud/rules-tenant.spec.mjs`
// — which is where all five of the orphans AGL-2376 was filed over actually
// live. The first version of this file had only the `**` form and reported
// green over every one of them.
const standaloneTestFiles = ls(
  'tools/*.test.mjs',
  'tools/*.spec.mjs',
  'tools/**/*.test.mjs',
  'tools/**/*.spec.mjs',
  'cloud/*.test.mjs',
  'cloud/*.spec.mjs',
  'cloud/**/*.test.mjs',
  'cloud/**/*.spec.mjs',
).sort()

// Everything that can actually execute one. NOT apps/ or libs/ — a source
// comment naming a spec must not satisfy this.
const runnerText = [
  JSON.stringify(JSON.parse(read('package.json')).scripts ?? {}),
  ...ls('tools/scripts/*.sh', 'tools/**/*.sh').map(read),
  ...ls('.github/workflows/*.yml', '.github/workflows/*.yaml').map(read),
].join('\n')

const projects = ls('**/project.json').map((file) => {
  const dir = dirname(file)
  const json = JSON.parse(read(file))
  const target = json.targets?.test
  const testFileCount = ls(
    `${dir}/**/*.spec.ts`,
    `${dir}/**/*.spec.tsx`,
    `${dir}/**/*.spec.js`,
    `${dir}/**/*.spec.jsx`,
    `${dir}/**/*.test.ts`,
    `${dir}/**/*.test.tsx`,
    `${dir}/**/*.test.js`,
    `${dir}/**/*.test.jsx`,
  ).length
  return {
    project: json.name ?? dir,
    dir,
    hasTestTarget: target !== undefined,
    testFileCount,
    passWithNoTests: target?.options?.passWithNoTests === true,
  }
})

const result = evaluateTestWiring({ standaloneTestFiles, runnerText, projects })

if (result.ok) {
  const withTests = projects.filter((p) => p.hasTestTarget).length
  console.log(
    `Every one of ${standaloneTestFiles.length} standalone test file(s) has a runner; ` +
      `${withTests} project(s) with a \`test\` target all contain tests; ` +
      `${UNTESTED_PROJECTS.length} project(s) declared untested and still are.`,
  )
  process.exit(0)
}

console.error(formatFailure(result))
process.exit(1)
