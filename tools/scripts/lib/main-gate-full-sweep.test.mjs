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
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

import { FULL_SWEEP_CRON, decideFullSweep } from './main-gate-full-sweep.mjs'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const workflow = (name) => readFileSync(join(repoRoot, '.github', 'workflows', name), 'utf8')

// --- the event rules ---------------------------------------------------------

test('every push to main is swept', () => {
  const { due, reason } = decideFullSweep({ eventName: 'push' })
  assert.equal(due, true)
  assert.match(reason, /every push/)
})

test('each push in a burst asks for its sweep; the concurrency group, not this rule, keeps only the newest', () => {
  // The rule answers per event. Collapsing a burst is the `full` job's
  // concurrency group, asserted against the workflow below.
  for (let i = 0; i < 6; i += 1) assert.equal(decideFullSweep({ eventName: 'push' }).due, true)
})

test('a manual dispatch that asked for the sweep gets it', () => {
  assert.equal(decideFullSweep({ eventName: 'workflow_dispatch', inputsFull: true }).due, true)
})

test('a manual dispatch that asked for the fast path only does not', () => {
  assert.equal(decideFullSweep({ eventName: 'workflow_dispatch', inputsFull: false }).due, false)
})

test('the hourly cron still re-sweeps the tip', () => {
  assert.equal(decideFullSweep({ eventName: 'schedule', schedule: FULL_SWEEP_CRON }).due, true)
})

test('the quarter-hourly cron does not', () => {
  assert.equal(decideFullSweep({ eventName: 'schedule', schedule: '7,22,37,52 * * * *' }).due, false)
})

test('an unrelated event does not fire the sweep', () => {
  assert.equal(decideFullSweep({ eventName: 'pull_request' }).due, false)
})

// --- the workflow shape the rule depends on (AGL-2836) -----------------------
//
// Asserted from here rather than inside the workflow, so a later edit that
// splits the sweep back into per-job groups is red on the push that makes it.

test('main-gate.yml calls the sweep as ONE job with one ref-keyed queue', () => {
  const yaml = workflow('main-gate.yml')
  const full = /\n {2}full:\n([\s\S]*?)(?=\n {2}[a-z][\w-]*:\n)/.exec(yaml)?.[1] ?? ''
  assert.match(full, /uses: \.\/\.github\/workflows\/main-gate-full\.yml/)
  assert.match(full, /group: main-gate-full-\$\{\{ github\.ref \}\}/)
  // `false` is the property: one sweep runs, the newest waiting push replaces
  // an older waiting one, and a running sweep is never cut off.
  assert.match(full, /cancel-in-progress: false/)
})

test('main-gate-full.yml has no per-job concurrency that would split the unit', () => {
  assert.doesNotMatch(workflow('main-gate-full.yml'), /^\s+concurrency:/m)
})

test('the fast verdict is reported without waiting for the sweep', () => {
  const yaml = workflow('main-gate.yml')
  const reportFast = /\n {2}report-fast:\n([\s\S]*?)(?=\n {2}[a-z][\w-]*:\n)/.exec(yaml)?.[1] ?? ''
  assert.match(reportFast, /needs: \[?fast\]?\n/)
})

test('a red pages #ci only from main', () => {
  const yaml = workflow('main-gate.yml')
  const slackSteps = [...yaml.matchAll(/- name: red -> Slack\n\s+if: ([^\n]+)/g)].map((match) => match[1])
  assert.ok(slackSteps.length >= 2, 'both reports alert')
  for (const condition of slackSteps) assert.match(condition, /github\.ref == 'refs\/heads\/main'/)
})
