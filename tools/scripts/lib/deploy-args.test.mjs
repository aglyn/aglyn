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
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import { ALLOW_DIRTY_FLAG, parseDeployArgs } from './deploy-args.mjs'

const SPEC = {
  command: 'deploy-firestore-rules',
  summary: 'Deploy cloud/firebase-firestore.rules to the live project.',
  flags: [ALLOW_DIRTY_FLAG],
}

/** Records what the parser printed and the code it exited with. */
function harness(argv, flags = SPEC.flags) {
  const record = { log: [], error: [], exit: undefined }
  const result = parseDeployArgs({
    ...SPEC,
    flags,
    argv,
    io: {
      log: (text) => record.log.push(text),
      error: (text) => record.error.push(text),
      // The real `process.exit` does not return; the harness records the code
      // and returns a sentinel so a parser that FAILS to stop is visible as a
      // returned value rather than a passing test.
      exit: (code) => {
        record.exit = code
        return 'EXITED'
      },
    },
  })
  return { ...record, result }
}

describe('a deploy script never deploys on an argument it did not understand', () => {
  it('THE BUG: `--help` exits 0 and parses as no flags at all', () => {
    // `deploy-firestore-rules.mjs --help` deployed the live Firestore rules on
    // 2026-08-28. The parser must stop, not fall through to the deploy.
    const run = harness(['--help'])
    assert.equal(run.exit, 0)
    assert.equal(run.result, 'EXITED')
    assert.match(run.log.join('\n'), /Usage: node tools\/scripts\/deploy-firestore-rules\.mjs/)
    assert.equal(run.error.length, 0)
  })

  it('`-h` is the same door', () => {
    assert.equal(harness(['-h']).exit, 0)
  })

  it('THE POINT: an unknown flag exits 2 and says nothing was deployed', () => {
    const run = harness(['--nonsense'])
    assert.equal(run.exit, 2)
    assert.equal(run.result, 'EXITED')
    assert.match(run.error.join('\n'), /NOTHING WAS DEPLOYED/)
    // The token itself, so the operator sees which one was refused.
    assert.match(run.error.join('\n'), /"--nonsense"/)
  })

  it('a TYPO of a real flag is refused, not silently ignored', () => {
    // The failure mode that matters: the operator believes `--dry-run` is in
    // effect. Ignoring it deploys for real while they think it did not.
    for (const typo of ['--dryrun', '--dry_run', '-n', '--allow_dirty', '--allowdirty']) {
      const run = harness([typo], [ALLOW_DIRTY_FLAG, { flag: '--dry-run', key: 'dryRun', describe: 'x' }])
      assert.equal(run.exit, 2, `${typo} should be refused`)
    }
  })

  it('CONTROL — the flags it DOES know still parse, and it does not exit', () => {
    // Without this, "refuse everything" passes every test above and ships a
    // deploy script that can never deploy.
    const run = harness(['--allow-dirty'])
    assert.equal(run.exit, undefined)
    assert.deepEqual(run.result, { allowDirty: true })
  })

  it('CONTROL — no arguments is a clean parse with defaults off', () => {
    const run = harness([])
    assert.equal(run.exit, undefined)
    assert.deepEqual(run.result, { allowDirty: false })
  })

  it('reads a `--file=` value, and defaults it to null', () => {
    const flags = [
      ALLOW_DIRTY_FLAG,
      { flag: '--file', key: 'filePath', value: 'string', describe: 'x' },
    ]
    assert.equal(harness(['--file=/tmp/x.json'], flags).result.filePath, '/tmp/x.json')
    assert.equal(harness([], flags).result.filePath, null)
  })

  it('`--` is a no-op rather than an unknown argument', () => {
    // npm passes it through on `npm run x -- --allow-dirty`.
    const run = harness(['--', '--allow-dirty'])
    assert.equal(run.exit, undefined)
    assert.deepEqual(run.result, { allowDirty: true })
  })

  it('the usage text names every flag it accepts', () => {
    const flags = [ALLOW_DIRTY_FLAG, { flag: '--dry-run', key: 'dryRun', describe: 'Show the plan.' }]
    const help = harness(['--help'], flags).log.join('\n')
    for (const one of flags) assert.match(help, new RegExp(one.flag.replace(/-/g, '\\-')))
    assert.match(help, /--help, -h/)
  })
})

describe('every deploy script actually USES the parser', () => {
  // ⚠️ THE WIRING CHECK. The parser above can be perfect and irrelevant: the
  // bug was in the call sites, and a call site that still reads
  // `process.argv.includes(...)` has all of this and none of its protection.
  const SCRIPTS = [
    'deploy-firestore-rules',
    'deploy-storage-rules',
    'deploy-database-rules',
    'deploy-firestore-indexes',
  ]
  const source = (name) =>
    readFileSync(
      fileURLToPath(new URL(`../${name}.mjs`, import.meta.url)),
      'utf8',
    )

  for (const name of SCRIPTS) {
    it(`${name} parses its arguments instead of scanning argv`, () => {
      const text = source(name)
      assert.match(text, /parseDeployArgs\(/, `${name} must call parseDeployArgs`)
      // The exact shape that caused the incident: a lone membership test on
      // argv, which cannot refuse anything because it never looks at the rest.
      assert.doesNotMatch(
        text,
        /process\.argv\.includes\(/,
        `${name} still reads argv directly, so an unknown flag is discarded`,
      )
    })
  }
})
