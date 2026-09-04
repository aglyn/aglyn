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

// Tests for the promotion deploy guard (AGL-2580).
//
// THE POINT OF THIS SUITE IS THAT THE GATE CAN BE MADE TO FAIL, and that it
// stays quiet when nothing is owed. Both halves matter: a guard that never
// fires is theatre, and a guard that fires on every promotion is one people
// learn to override, which is the same thing a week later.
//
// The e2e cases drive the real CLI over a REAL range from this repository's
// history — the commit that last touched `cloud/functions` and its parent — so
// the range-to-target mapping is exercised against actual git output rather
// than a fixture that could drift from it. Only the Cloud Functions API is
// stubbed, and it is fed a deployment older than that commit: the assertion is
// the CLI's real exit code.

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { execFileSync, spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  CHECKER_EXIT,
  MANUAL_DEPLOY_TARGETS,
  describeResult,
  foldResults,
  pathMatchesTarget,
  targetsForChangedFiles,
} from './promotion-deploys.mjs'
import { FUNCTIONS_ENTRY_FILE, parseFunctionExports } from './functions-drift.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(here, '..', '..', '..')
const cliPath = join(repoRoot, 'tools', 'scripts', 'check-promotion-deploys.mjs')
const PROJECT = 'promotion-deploys-test'

const git = (args) =>
  execFileSync('git', args, {
    cwd: repoRoot,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  }).trim()

const targetById = (id) => MANUAL_DEPLOY_TARGETS.find((t) => t.id === id)

describe('which targets a range owes', () => {
  it('matches a rules file exactly and never by prefix', () => {
    const rules = targetById('rules')
    assert.equal(pathMatchesTarget(rules, 'cloud/firebase-firestore.rules'), true)
    assert.equal(pathMatchesTarget(rules, 'cloud/firebase-firestore.rules.bak'), false)
    assert.equal(pathMatchesTarget(rules, 'cloud/rules-tests/firestore.spec.mjs'), false)
  })

  it('matches the whole functions package, because the whole package is packed', () => {
    const functions = targetById('functions')
    for (const file of [
      'cloud/functions/src/index.ts',
      'cloud/functions/package-lock.json',
      'cloud/functions/tsconfig.json',
    ]) {
      assert.equal(pathMatchesTarget(functions, file), true, file)
    }
    assert.equal(pathMatchesTarget(functions, 'cloud/functions.md'), false)
  })

  it('owes nothing for a range that only touches app code', () => {
    assert.deepEqual(
      targetsForChangedFiles([
        'apps/console/app/page.tsx',
        'libs/aglyn/src/lib/app-utils/health-report.ts',
        'docs/RELEASING.md',
      ]),
      [],
    )
  })

  it('owes all three when one range touches all three — the 2026-09-04 shape', () => {
    const owed = targetsForChangedFiles([
      'cloud/firebase-firestore.rules',
      'cloud/functions/src/index.ts',
      'cloud/firebase-firestore.indexes.json',
      'apps/console/app/page.tsx',
    ])
    assert.deepEqual(
      owed.map((entry) => entry.target.id),
      ['rules', 'functions', 'indexes'],
    )
    assert.deepEqual(owed[0].files, ['cloud/firebase-firestore.rules'])
  })
})

describe('folding the checkers into one verdict', () => {
  const result = (id, code) => ({ target: targetById(id), code })

  it('is clean only when every checker was clean', () => {
    const folded = foldResults([result('rules', 0), result('functions', 0)])
    assert.equal(folded.exitCode, CHECKER_EXIT.CLEAN)
  })

  it('lets a missing deploy beat a cannot-check', () => {
    const folded = foldResults([result('rules', 2), result('functions', 1)])
    assert.equal(folded.exitCode, CHECKER_EXIT.NOT_DEPLOYED)
    assert.equal(folded.notDeployed.length, 1)
    assert.equal(folded.cannotCheck.length, 1)
  })

  it('NEVER folds a cannot-check into clean', () => {
    const folded = foldResults([result('rules', 0), result('functions', 2)])
    assert.equal(folded.exitCode, CHECKER_EXIT.CANNOT_CHECK)
  })

  it('treats an unexpected exit code as cannot-check, not as success', () => {
    const folded = foldResults([result('functions', 137)])
    assert.equal(folded.exitCode, CHECKER_EXIT.CANNOT_CHECK)
  })

  it('names the deploy command in the line a person will read', () => {
    assert.match(
      describeResult(result('functions', 1)),
      /NOT DEPLOYED Cloud Functions — run: npm --prefix cloud\/functions run deploy/,
    )
  })
})

// --- the CLI, over a real range, with only the functions API stubbed --------

const declaredIds = parseFunctionExports(
  execFileSync('git', ['show', `HEAD:${FUNCTIONS_ENTRY_FILE}`], {
    cwd: repoRoot,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  }),
)

/** The last commit that touched the deployed package, and its parent. */
const functionsSha = git(['log', '-1', '--format=%H', 'HEAD', '--', 'cloud/functions'])
const functionsCommitMs =
  Number(git(['log', '-1', '--format=%ct', functionsSha])) * 1000
const functionsRange = `${functionsSha}^..${functionsSha}`

function deploymentAt(ms) {
  const updateTime = new Date(ms).toISOString()
  return declaredIds.map((id) => ({
    name: `projects/${PROJECT}/locations/${
      id === 'beforeSignupCreate' ? 'us-east1' : 'us-central1'
    }/functions/${id}`,
    state: 'ACTIVE',
    environment: 'GEN_2',
    updateTime,
  }))
}

async function withStub(body, run) {
  const requests = []
  const server = createServer((req, res) => {
    requests.push(req.url)
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify(body))
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${server.address().port}`
  try {
    return await run({ base, requests })
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
}

/**
 * Run the real CLI. Async (never spawnSync): the stub lives in THIS process,
 * and the CLI's child checker fetches against it, so a synchronous spawn would
 * deadlock. The env is built up rather than inherited so no real credential
 * can reach either process.
 */
function runCli({ base, args }) {
  const child = spawn(process.execPath, [cliPath, ...args], {
    cwd: repoRoot,
    env: {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      FIREBASE_PROJECT_ID: PROJECT,
      FUNCTIONS_CHECK_ACCESS_TOKEN: 'stub-token',
      CLOUD_FUNCTIONS_API_BASE: base ?? 'http://127.0.0.1:1',
    },
  })
  let out = ''
  child.stdout.setEncoding('utf8').on('data', (c) => (out += c))
  child.stderr.setEncoding('utf8').on('data', (c) => (out += c))
  return new Promise((resolve, reject) => {
    child.on('error', reject)
    child.on('close', (code) => resolve({ code, out }))
  })
}

describe('the CLI, over a real promotion range', () => {
  it('passes without a single network call when the range owes nothing', async () => {
    await withStub({ functions: [] }, async ({ base, requests }) => {
      const { code, out } = await runCli({ base, args: ['--range=HEAD..HEAD'] })
      assert.equal(code, 0, out)
      assert.match(out, /touches no manual deploy target/)
      assert.deepEqual(requests, [])
    })
  })

  it('EXITS 1 when the range changed cloud/functions and the deploy did not happen', async () => {
    await withStub(
      { functions: deploymentAt(functionsCommitMs - 86_400_000) },
      async ({ base }) => {
        const { code, out } = await runCli({
          base,
          args: [`--range=${functionsRange}`, '--only=functions'],
        })
        assert.equal(code, 1, out)
        assert.match(out, /Owed by this range: Cloud Functions/)
        assert.match(out, /NOT DEPLOYED Cloud Functions/)
        assert.match(out, /manual deploy\(s\) this range owes have not happened/)
      },
    )
  })

  it('passes the same range once the deploy has happened', async () => {
    await withStub(
      { functions: deploymentAt(functionsCommitMs + 3_600_000) },
      async ({ base }) => {
        const { code, out } = await runCli({
          base,
          args: [`--range=${functionsRange}`, '--only=functions'],
        })
        assert.equal(code, 0, out)
        assert.match(out, /Every manual deploy this range owes has happened/)
      },
    )
  })

  it('--list prints the ledger and verifies nothing', async () => {
    await withStub({ functions: [] }, async ({ base, requests }) => {
      const { code, out } = await runCli({
        base,
        args: [`--range=${functionsRange}`, '--list'],
      })
      assert.equal(code, 0, out)
      assert.match(out, /no deploy was verified/)
      assert.match(out, /if skipped:/)
      assert.deepEqual(requests, [])
    })
  })

  it('EXITS 2 on a range that does not resolve, and on one that is not a range', async () => {
    const bad = await runCli({ base: null, args: ['--range=refs/heads/no-such..HEAD'] })
    assert.equal(bad.code, 2, bad.out)
    assert.match(bad.out, /does not resolve/)

    const notARange = await runCli({ base: null, args: ['--range=HEAD'] })
    assert.equal(notARange.code, 2, notARange.out)
    assert.match(notARange.out, /must be '<base>\.\.<head>'/)
  })
})
