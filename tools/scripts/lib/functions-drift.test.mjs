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

// Tests for the deployed-vs-promoted Cloud Functions drift check (AGL-2580).
//
// THE POINT OF THIS SUITE IS THAT THE GUARD CAN BE MADE TO FAIL. A drift check
// that cannot go red is worth nothing — it renders as a green tick over the
// exact condition it was written to catch, which is how the 2026-09-04
// incident lasted as long as it did. So the e2e cases stand up a stub of the
// Cloud Functions v2 API, hand it a deployment dated BEFORE the repo's real
// last `cloud/functions` commit, and assert the CLI's real exit code — read
// from the process, never through a pipe.
//
// The stub is a faithful double, not a convenient one. Every field below was
// read off `aglyn-main` on 2026-09-04: the `projects/…/locations/…/functions/…`
// resource name, a nanosecond-precision `updateTime`, `state: ACTIVE`,
// `environment: GEN_2` — and, the one that matters, TWO REGIONS. Eight
// functions are in `us-central1` and `beforeSignupCreate` is in `us-east1`,
// because an Identity Platform blocking function is pinned to the region
// Firebase Auth runs in. A checker that hardcoded one region would sweep clean
// while never looking at the function guarding signups, so the stub serves
// both and one case makes only the us-east1 function stale.

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { execFileSync, spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  FUNCTIONS_ENTRY_FILE,
  FUNCTIONS_SOURCE_PATH,
  classifyFunctionsDrift,
  functionId,
  functionRegion,
  parseFunctionExports,
  parseTimestamp,
  renderFunctionLines,
} from './functions-drift.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(here, '..', '..', '..')
const cliPath = join(repoRoot, 'tools', 'scripts', 'check-functions-drift.mjs')
const PROJECT = 'functions-drift-test'

const git = (args) =>
  execFileSync('git', args, {
    cwd: repoRoot,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  }).trim()

/** The real function ids this repo declares, read from the entry file. */
const declaredIds = parseFunctionExports(
  execFileSync('git', ['show', `HEAD:${FUNCTIONS_ENTRY_FILE}`], {
    cwd: repoRoot,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  }),
)

/** Committer time (ms) of the last commit touching the deployed package. */
const lastFunctionsCommitMs =
  Number(git(['log', '-1', '--format=%ct', 'HEAD', '--', FUNCTIONS_SOURCE_PATH])) * 1000

function deployedFunction(id, { region = 'us-central1', updateTime, state = 'ACTIVE' }) {
  return {
    name: `projects/${PROJECT}/locations/${region}/functions/${id}`,
    state,
    environment: 'GEN_2',
    updateTime,
    buildConfig: { build: `projects/${PROJECT}/locations/${region}/builds/stub` },
  }
}

/** A whole-project deployment stamped at one moment, the way one deploy is. */
function deploymentAt(isoTime, overrides = {}) {
  return declaredIds.map((id) =>
    deployedFunction(id, {
      region: id === 'beforeSignupCreate' ? 'us-east1' : 'us-central1',
      updateTime: isoTime,
      ...(overrides[id] ?? {}),
    }),
  )
}

const iso = (ms) => new Date(ms).toISOString().replace('Z', '123456789Z')

/**
 * Serve the v2 ListFunctions surface, including the shape that matters most:
 * `locations/-` aggregates across regions and reports `unreachable`.
 */
async function withStub(handler, run) {
  const requests = []
  const server = createServer((req, res) => {
    requests.push(req.url)
    const body = handler(req)
    if (body?.httpStatus) {
      res.writeHead(body.httpStatus, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ error: { message: body.message ?? 'denied' } }))
      return
    }
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
 * so a synchronous spawn would deadlock the CLI's fetches against it.
 *
 * The env is built up rather than inherited, so a real credential can never
 * reach the child. A run that silently talked to the live project would be
 * asserting about production, and its verdict would change under it with no
 * commit anywhere.
 */
function runCli({ base, args = [] }) {
  const child = spawn(process.execPath, [cliPath, ...args], {
    cwd: repoRoot,
    env: {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      FIREBASE_PROJECT_ID: PROJECT,
      FUNCTIONS_CHECK_ACCESS_TOKEN: 'stub-token',
      CLOUD_FUNCTIONS_API_BASE: base,
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

describe('parsing the deployed shape', () => {
  it('reads the region and id out of a v2 resource name', () => {
    const name = 'projects/aglyn-main/locations/us-east1/functions/beforeSignupCreate'
    assert.equal(functionRegion(name), 'us-east1')
    assert.equal(functionId(name), 'beforeSignupCreate')
  })

  it('parses nanosecond-precision timestamps, which Date.parse truncates', () => {
    assert.equal(
      parseTimestamp('2026-09-01T00:09:35.307980766Z'),
      Date.parse('2026-09-01T00:09:35.307Z'),
    )
    assert.equal(parseTimestamp(''), null)
    assert.equal(parseTimestamp('not a time'), null)
  })

  it('takes only top-level export const names from the entry file', () => {
    const names = parseFunctionExports(
      [
        "import { onSchedule } from 'firebase-functions/scheduler'",
        'export const consoleFastCrons = onSchedule(',
        'export const beforeSignupCreate = beforeUserCreated(async () => {',
        '  export const notTopLevel = 1',
        "export * from './signups-lock'",
        'export type Something = string',
      ].join('\n'),
    )
    assert.deepEqual(names, ['beforeSignupCreate', 'consoleFastCrons'])
  })

  it('finds the real exports this repo deploys, in both regions', () => {
    assert.ok(declaredIds.includes('consoleFastCrons'))
    assert.ok(declaredIds.includes('beforeSignupCreate'))
  })
})

describe('classification', () => {
  const commit = { sha: 'abcdef1234567890', timestampMs: Date.parse('2026-09-04T16:01:52Z'), subject: 'x' }

  it('grades a deployment made after the commit as current', () => {
    const verdict = classifyFunctionsDrift({
      deployed: deploymentAt('2026-09-04T17:00:00Z'),
      declared: declaredIds,
      commit,
    })
    assert.equal(verdict.drifted, false)
    assert.equal(verdict.current.length, declaredIds.length)
  })

  it('grades a deployment made before the commit as stale', () => {
    const verdict = classifyFunctionsDrift({
      deployed: deploymentAt('2026-09-01T00:09:35Z'),
      declared: declaredIds,
      commit,
    })
    assert.equal(verdict.drifted, true)
    assert.equal(verdict.stale.length, declaredIds.length)
  })

  it('catches a stale function in a NON-default region on its own', () => {
    const deployed = deploymentAt('2026-09-04T17:00:00Z', {
      beforeSignupCreate: { updateTime: '2026-09-01T00:09:24Z' },
    })
    const verdict = classifyFunctionsDrift({ deployed, declared: declaredIds, commit })
    assert.equal(verdict.stale.length, 1)
    assert.equal(verdict.stale[0].id, 'beforeSignupCreate')
    assert.equal(verdict.stale[0].region, 'us-east1')
  })

  it('reports an export the project has never deployed', () => {
    const verdict = classifyFunctionsDrift({
      deployed: deploymentAt('2026-09-04T17:00:00Z').filter(
        (fn) => !fn.name.endsWith('/consoleFastCrons'),
      ),
      declared: declaredIds,
      commit,
    })
    assert.equal(verdict.neverDeployed.length, 1)
    assert.equal(verdict.neverDeployed[0].id, 'consoleFastCrons')
    assert.equal(verdict.drifted, true)
  })

  it('reports a deployed function the promoted source no longer exports', () => {
    const verdict = classifyFunctionsDrift({
      deployed: [
        ...deploymentAt('2026-09-04T17:00:00Z'),
        deployedFunction('consoleRetiredJob', { updateTime: '2026-09-04T17:00:00Z' }),
      ],
      declared: declaredIds,
      commit,
    })
    assert.equal(verdict.orphaned.length, 1)
    assert.equal(verdict.orphaned[0].id, 'consoleRetiredJob')
  })

  it('does not call everything an orphan when the export list is empty', () => {
    const verdict = classifyFunctionsDrift({
      deployed: deploymentAt('2026-09-04T17:00:00Z'),
      declared: [],
      commit,
    })
    assert.equal(verdict.orphaned.length, 0)
  })

  it('refuses to grade a half-finished deployment on its timestamp', () => {
    const deployed = deploymentAt('2026-09-04T17:00:00Z', {
      consoleFastCrons: { state: 'FAILED' },
    })
    const verdict = classifyFunctionsDrift({ deployed, declared: declaredIds, commit })
    assert.equal(verdict.notActive.length, 1)
    assert.equal(verdict.notActive[0].id, 'consoleFastCrons')
    assert.equal(verdict.drifted, true)
  })

  it('renders one aligned line per function, oldest deploy first', () => {
    const lines = renderFunctionLines([
      { id: 'b', region: 'us-east1', updateTime: '2026-09-02T00:00:00Z', updatedAtMs: 2 },
      { id: 'aa', region: 'us-central1', updateTime: '2026-09-01T00:00:00Z', updatedAtMs: 1 },
    ])
    assert.match(lines[0], /^ {2}aa {2}us-central1/)
    assert.match(lines[1], /^ {2}b {3}us-east1/)
  })
})

describe('the CLI, end to end against a stubbed Cloud Functions API', () => {
  const listBody = (functions, extra = {}) => ({ functions, ...extra })

  it('exits 0 when every function was deployed after the last commit', async () => {
    await withStub(
      () => listBody(deploymentAt(iso(lastFunctionsCommitMs + 3_600_000))),
      async ({ base, requests }) => {
        const { code, out } = await runCli({ base })
        assert.equal(code, 0, out)
        assert.match(out, /Every function the API could see is at or after/)
        // The region wildcard, not a hardcoded region: this is the assertion
        // that keeps us-east1 in view.
        assert.ok(requests.every((url) => url.includes('/locations/-/functions')), requests.join(' '))
      },
    )
  })

  it('EXITS 1 when a function is older than the commit that changed it', async () => {
    await withStub(
      () => listBody(deploymentAt(iso(lastFunctionsCommitMs - 86_400_000))),
      async ({ base }) => {
        const { code, out } = await runCli({ base })
        assert.equal(code, 1, out)
        assert.match(out, /DRIFT/)
        assert.match(out, /STALE consoleFastCrons \[us-central1\]/)
        assert.match(out, /npm --prefix cloud\/functions run deploy/)
      },
    )
  })

  it('EXITS 1 for a stale function in us-east1 while every other region is current', async () => {
    await withStub(
      () =>
        listBody(
          deploymentAt(iso(lastFunctionsCommitMs + 3_600_000), {
            beforeSignupCreate: { updateTime: iso(lastFunctionsCommitMs - 86_400_000) },
          }),
        ),
      async ({ base }) => {
        const { code, out } = await runCli({ base })
        assert.equal(code, 1, out)
        assert.match(out, /STALE beforeSignupCreate \[us-east1\]/)
      },
    )
  })

  it('EXITS 1 when an exported function is missing from the project entirely', async () => {
    await withStub(
      () =>
        listBody(
          deploymentAt(iso(lastFunctionsCommitMs + 3_600_000)).filter(
            (fn) => !fn.name.endsWith('/consoleFastCrons'),
          ),
        ),
      async ({ base }) => {
        const { code, out } = await runCli({ base })
        assert.equal(code, 1, out)
        assert.match(out, /NEVER DEPLOYED consoleFastCrons/)
      },
    )
  })

  it('follows nextPageToken rather than judging the first page alone', async () => {
    const fresh = deploymentAt(iso(lastFunctionsCommitMs + 3_600_000))
    await withStub(
      (req) =>
        req.url.includes('pageToken=')
          ? listBody(fresh.slice(1))
          : listBody([{ ...fresh[0], updateTime: iso(lastFunctionsCommitMs - 86_400_000) }], {
              nextPageToken: 'page-2',
            }),
      async ({ base }) => {
        const { code, out } = await runCli({ base })
        // The stale one is on page 1 and the rest on page 2: a checker that
        // stopped at the first page would still red here, so the assertion
        // that carries the paging claim is the COUNT of graded functions.
        assert.equal(code, 1, out)
        assert.match(out, new RegExp(`of ${fresh.length} function\\(s\\)`))
      },
    )
  })

  it('EXITS 2, not 0, when a region could not be reached and nothing else drifted', async () => {
    await withStub(
      () =>
        listBody(
          deploymentAt(iso(lastFunctionsCommitMs + 3_600_000)).filter(
            (fn) => !fn.name.includes('/us-east1/'),
          ),
          { unreachable: ['us-east1'] },
        ),
      async ({ base }) => {
        const { code, out } = await runCli({ base })
        assert.equal(code, 2, out)
        assert.match(out, /us-east1/)
      },
    )
  })

  it('EXITS 2 on a 403, and says which credential causes one', async () => {
    await withStub(
      () => ({ httpStatus: 403, message: 'Permission denied on cloudfunctions.functions.list' }),
      async ({ base }) => {
        const { code, out } = await runCli({ base })
        assert.equal(code, 2, out)
        assert.match(out, /Firebase service account/)
      },
    )
  })

  it('EXITS 2 on a baseline ref that does not resolve, never falling back to HEAD', async () => {
    await withStub(
      () => listBody(deploymentAt(iso(lastFunctionsCommitMs + 3_600_000))),
      async ({ base }) => {
        const { code, out } = await runCli({ base, args: ['--baseline=refs/heads/no-such-ref'] })
        assert.equal(code, 2, out)
        assert.match(out, /does not resolve/)
      },
    )
  })
})
