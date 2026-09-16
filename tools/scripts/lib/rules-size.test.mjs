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

// Self-test for the rules source-size guard (AGL-3027).
//
// The forced reds rebuild the real incident: the v1.0.0-beta.125 Firestore
// rules at 262,161 bytes, which every other check passed and the deploy
// refused, and the 262,087-byte copy the Rules API accepted. The CLI half runs
// the script against throwaway checkouts, so the exit code a workflow reads is
// asserted, not only the verdict object.

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

import {
  DATABASE_RULES_LIMIT_BYTES,
  RULES_API_SOURCE_LIMIT_BYTES,
  RULES_SOURCES,
  WARN_MARGIN_BYTES,
  formatRulesSize,
  judgeRulesSize,
  measureRulesSource,
} from './rules-size.mjs'

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const CLI = join(REPO_ROOT, 'tools', 'scripts', 'check-rules-size.mjs')

const FIRESTORE = RULES_SOURCES.find((source) => source.path === 'cloud/firebase-firestore.rules')
const DATABASE = RULES_SOURCES.find((source) => source.path === 'cloud/firebase-database.rules.json')

/** The two sizes AGL-3027 measured against the live Rules API. */
const REFUSED_BETA_125 = 262_161
const ACCEPTED_LESS_ONE_COMMENT = 262_087

test('each service keeps its own limit: 256 KiB for the Rules API, 10 MiB for the Realtime Database', () => {
  assert.equal(RULES_API_SOURCE_LIMIT_BYTES, 262_144)
  assert.equal(DATABASE_RULES_LIMIT_BYTES, 10_485_760)
  assert.equal(WARN_MARGIN_BYTES, 2_048)
  const limitOf = Object.fromEntries(RULES_SOURCES.map((source) => [source.path, source.limitBytes]))
  assert.deepEqual(limitOf, {
    'cloud/firebase-firestore.rules': RULES_API_SOURCE_LIMIT_BYTES,
    'cloud/firebase-storage.rules': RULES_API_SOURCE_LIMIT_BYTES,
    'cloud/firebase-database.rules.json': DATABASE_RULES_LIMIT_BYTES,
  })
})

test('every source is a file this repo deploys, named by the script that deploys it', () => {
  // Anti-vacuity: a renamed rules file must fail here, not leave the guard
  // measuring a path nothing reads.
  const deployScripts = {
    'cloud/firebase-firestore.rules': 'tools/scripts/deploy-firestore-rules.mjs',
    'cloud/firebase-storage.rules': 'tools/scripts/deploy-storage-rules.mjs',
    'cloud/firebase-database.rules.json': 'tools/scripts/deploy-database-rules.mjs',
  }
  assert.equal(RULES_SOURCES.length, 3)
  for (const source of RULES_SOURCES) {
    assert.ok(existsSync(join(REPO_ROOT, source.path)), `${source.path} does not exist`)
    const script = deployScripts[source.path]
    assert.ok(script, `${source.path} has no deploy script in this test's table`)
    assert.ok(
      readFileSync(join(REPO_ROOT, script), 'utf8').includes(source.path.replace(/^cloud\//, '')),
      `${script} no longer deploys ${source.path}`,
    )
    for (const field of ['service', 'limitSource', 'refusal', 'remedy']) {
      assert.ok(source[field], `${source.path} has no ${field}`)
    }
  }
})

test('the beta.125 Firestore rules are over, by 17 bytes', () => {
  const judgement = judgeRulesSize({ bytes: REFUSED_BETA_125, limitBytes: FIRESTORE.limitBytes })
  assert.equal(judgement.verdict, 'over')
  assert.equal(judgement.bytesLeft, -17)
})

test('the 262,087-byte copy the API accepted is under, and warns', () => {
  const judgement = judgeRulesSize({ bytes: ACCEPTED_LESS_ONE_COMMENT, limitBytes: FIRESTORE.limitBytes })
  assert.equal(judgement.verdict, 'near')
  assert.equal(judgement.bytesLeft, 57)
})

test('the limit itself is refused, because the API wants a source SMALLER than 256 KiB', () => {
  assert.equal(judgeRulesSize({ bytes: 262_144, limitBytes: 262_144 }).verdict, 'over')
  const oneUnder = judgeRulesSize({ bytes: 262_143, limitBytes: 262_144 })
  assert.equal(oneUnder.verdict, 'near')
  assert.equal(oneUnder.bytesLeft, 1)
})

test('the warning starts exactly at the margin, and not a byte before', () => {
  const limitBytes = RULES_API_SOURCE_LIMIT_BYTES
  assert.equal(judgeRulesSize({ bytes: limitBytes - WARN_MARGIN_BYTES, limitBytes }).verdict, 'near')
  assert.equal(judgeRulesSize({ bytes: limitBytes - WARN_MARGIN_BYTES - 1, limitBytes }).verdict, 'ok')
  // The margin is a parameter, not a constant baked into the arithmetic.
  assert.equal(judgeRulesSize({ bytes: 90, limitBytes: 100, warnMarginBytes: 5 }).verdict, 'ok')
  assert.equal(judgeRulesSize({ bytes: 95, limitBytes: 100, warnMarginBytes: 5 }).verdict, 'near')
})

test('size is UTF-8 bytes, not characters', () => {
  // The rules comments are full of em dashes, three bytes each. Counting
  // characters would under-read the file by hundreds of bytes.
  assert.equal(measureRulesSource('—'), 3)
  assert.equal(measureRulesSource(Buffer.from('— x', 'utf8')), 5)
  const dashes = '—'.repeat(87_382)
  assert.equal(dashes.length, 87_382)
  assert.equal(
    judgeRulesSize({ bytes: measureRulesSource(dashes), limitBytes: RULES_API_SOURCE_LIMIT_BYTES }).verdict,
    'over',
  )
})

test('a size that cannot be judged is an error, not a verdict', () => {
  assert.throws(() => judgeRulesSize({ bytes: -1, limitBytes: 10 }), TypeError)
  assert.throws(() => judgeRulesSize({ bytes: Number.NaN, limitBytes: 10 }), TypeError)
  assert.throws(() => judgeRulesSize({ bytes: 1, limitBytes: 0 }), TypeError)
})

test('the OVER report names the file, the size, the overage and the silent refusal', () => {
  const lines = formatRulesSize(
    FIRESTORE,
    judgeRulesSize({ bytes: REFUSED_BETA_125, limitBytes: FIRESTORE.limitBytes }),
  )
  assert.match(lines[0], /^OVER {2}cloud\/firebase-firestore\.rules: 262,161 of 262,144 bytes, 17 over the limit$/)
  const text = lines.join('\n')
  assert.match(text, /400 INVALID_ARGUMENT/)
  assert.match(text, /Comments count toward the limit/)
  assert.match(
    formatRulesSize(FIRESTORE, judgeRulesSize({ bytes: 262_144, limitBytes: 262_144 }))[0],
    /exactly at the limit$/,
  )
})

test('the NEAR report states the bytes left', () => {
  const lines = formatRulesSize(
    FIRESTORE,
    judgeRulesSize({ bytes: ACCEPTED_LESS_ONE_COMMENT, limitBytes: FIRESTORE.limitBytes }),
  )
  assert.match(lines[0], /^NEAR {2}cloud\/firebase-firestore\.rules: 262,087 of 262,144 bytes, only 57 left$/)
})

test('the Realtime Database report does not tell anyone to trim comments out of JSON', () => {
  const text = formatRulesSize(
    DATABASE,
    judgeRulesSize({ bytes: DATABASE.limitBytes + 1, limitBytes: DATABASE.limitBytes }),
  ).join('\n')
  assert.match(text, /Rules larger than limit of 10485760/)
  assert.doesNotMatch(text, /INVALID_ARGUMENT|Comments count/)
})

/* ------------------------------------------------------------------ the CLI */

/**
 * A throwaway checkout holding the three rules sources at the given sizes,
 * each defaulting to a size far under its limit. `null` leaves a source out.
 */
function checkout(sizes = {}) {
  const root = mkdtempSync(join(tmpdir(), 'aglyn-rules-size-'))
  mkdirSync(join(root, 'cloud'))
  for (const source of RULES_SOURCES) {
    const bytes = source.path in sizes ? sizes[source.path] : 1_000
    if (bytes === null) continue
    writeFileSync(join(root, source.path), Buffer.alloc(bytes, 'x'))
  }
  return root
}

function runCli(root, env = {}) {
  const result = spawnSync(process.execPath, [CLI, '--root', root], {
    encoding: 'utf8',
    env: { ...process.env, GITHUB_ACTIONS: '', ...env },
  })
  return { code: result.status, out: `${result.stdout}${result.stderr}` }
}

test('CLI: every source under its limit exits 0 and reports all three', (t) => {
  const root = checkout()
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const { code, out } = runCli(root)
  assert.equal(code, 0, out)
  for (const source of RULES_SOURCES) assert.match(out, new RegExp(`ok {4}${source.path.replace(/\./g, '\\.')}: `))
  assert.match(out, /all 3 rules sources are under their limits\.$/m)
})

test('CLI: the beta.125 size exits 1 and names the file', (t) => {
  const root = checkout({ 'cloud/firebase-firestore.rules': REFUSED_BETA_125 })
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const { code, out } = runCli(root)
  assert.equal(code, 1, out)
  assert.match(out, /OVER {2}cloud\/firebase-firestore\.rules: 262,161 of 262,144 bytes, 17 over the limit/)
  assert.match(out, /1 of 3 rules source\(s\) at or over the limit/)
})

test('CLI: a source near its limit warns and still exits 0', (t) => {
  const root = checkout({ 'cloud/firebase-storage.rules': RULES_API_SOURCE_LIMIT_BYTES - 100 })
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const { code, out } = runCli(root)
  assert.equal(code, 0, out)
  assert.match(out, /NEAR {2}cloud\/firebase-storage\.rules: 262,044 of 262,144 bytes, only 100 left/)
  assert.match(out, /1 NEAR the limit, see above\./)
})

test('CLI: in GitHub Actions a verdict is also an annotation on the file', (t) => {
  const root = checkout({
    'cloud/firebase-firestore.rules': REFUSED_BETA_125,
    'cloud/firebase-storage.rules': RULES_API_SOURCE_LIMIT_BYTES - 100,
  })
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const { code, out } = runCli(root, { GITHUB_ACTIONS: 'true' })
  assert.equal(code, 1, out)
  assert.match(out, /^::error file=cloud\/firebase-firestore\.rules,title=[^:]+::OVER .*17 over the limit/m)
  assert.match(out, /^::warning file=cloud\/firebase-storage\.rules,title=[^:]+::NEAR .*only 100 left/m)
  // Outside Actions the same run writes no workflow commands.
  assert.doesNotMatch(runCli(root).out, /^::/m)
})

test('CLI: a missing source exits 2, never 0', (t) => {
  const root = checkout({ 'cloud/firebase-database.rules.json': null })
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const { code, out } = runCli(root)
  assert.equal(code, 2, out)
  assert.match(out, /CANNOT CHECK {2}cloud\/firebase-database\.rules\.json/)
})

test('CLI: an argument it does not understand exits 2 instead of measuring the wrong checkout', () => {
  const result = spawnSync(process.execPath, [CLI, '--roots', '/tmp'], { encoding: 'utf8' })
  assert.equal(result.status, 2)
  assert.match(result.stderr, /cannot use argument `--roots`/)
})
