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

// Tests for the deployed-vs-promoted Cloud Functions drift check (AGL-2580,
// AGL-3968).
//
// THE POINT OF THIS SUITE IS THAT THE GUARD CAN BE MADE TO FAIL. A drift check
// that cannot go red is worth nothing — it renders as a green tick over the
// exact condition it was written to catch. So the e2e cases stand up a stub of
// the Cloud Functions v2 API, hand it deployments stamped with REAL commits of
// this repo, and assert the CLI's real exit code — read from the process, never
// through a pipe.
//
// The case this suite exists for is 2026-10-17: a deploy that ran AFTER the
// last `cloud/functions` commit, from a checkout that did not carry it. Its
// `updateTime` is later than the commit, which is what a timestamp check
// trusted; its source stamp is older, which is what this check reads.
//
// The stub is a faithful double, not a convenient one. Every field below was
// read off `aglyn-main`: the `projects/…/locations/…/functions/…` resource
// name, a nanosecond-precision `updateTime`, `state: ACTIVE`,
// `environment: GEN_2`, the dotenv variables under
// `serviceConfig.environmentVariables` — and TWO REGIONS. The scheduled
// functions are in `us-central1` and `beforeSignupCreate` is in `us-east1`,
// because an Identity Platform blocking function is pinned to the region
// Firebase Auth runs in. A checker that hardcoded one region would sweep clean
// while never looking at the function guarding signups.

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { execFileSync, spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  DIRTY_STAMP_SUFFIX,
  FUNCTIONS_ENTRY_FILE,
  FUNCTIONS_SOURCE_PATH,
  FUNCTIONS_SOURCE_PATHSPECS,
  SOURCE_STAMP_ENV,
  classifyFunctionsDrift,
  functionId,
  functionRegion,
  parseFunctionExports,
  parseTimestamp,
  readSourceStamp,
  renderFunctionLines,
  withSourceStamp,
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
const declaredIds = parseFunctionExports(git(['show', `HEAD:${FUNCTIONS_ENTRY_FILE}`]))

const headSha = git(['rev-parse', 'HEAD'])

/** The last commit touching the deployed package, and when it was committed. */
const [lastFunctionsSha, lastFunctionsSeconds] = git([
  'log', '-1', '--format=%H %ct', 'HEAD', '--', ...FUNCTIONS_SOURCE_PATHSPECS,
]).split(' ')
const lastFunctionsCommitMs = Number(lastFunctionsSeconds) * 1000

/**
 * A real commit whose package differs from HEAD's: the parent of the last
 * commit that changed it. What a deploy from the PREVIOUS promotion carries.
 */
const olderSha = git(['rev-parse', `${lastFunctionsSha}^`])

function deployedFunction(
  id,
  { region = 'us-central1', updateTime, state = 'ACTIVE', stamp = headSha },
) {
  const environmentVariables = {
    AGLYN_CONSOLE_URL: 'https://app.example.com',
    FIREBASE_CONFIG: '{}',
    ...(stamp ? { [SOURCE_STAMP_ENV]: stamp } : {}),
  }
  return {
    name: `projects/${PROJECT}/locations/${region}/functions/${id}`,
    state,
    environment: 'GEN_2',
    updateTime,
    buildConfig: { build: `projects/${PROJECT}/locations/${region}/builds/stub` },
    serviceConfig: { environmentVariables },
  }
}

/** A whole-project deployment from one checkout, the way one deploy is. */
function deployment({ updateTime, stamp = headSha }, overrides = {}) {
  return declaredIds.map((id) =>
    deployedFunction(id, {
      region: id === 'beforeSignupCreate' ? 'us-east1' : 'us-central1',
      updateTime,
      stamp,
      ...(overrides[id] ?? {}),
    }),
  )
}

const iso = (ms) => new Date(ms).toISOString().replace('Z', '123456789Z')
const afterLastCommit = iso(lastFunctionsCommitMs + 3_600_000)

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

  it('reads the source stamp from the function environment, or null', () => {
    assert.equal(readSourceStamp(deployedFunction('a', { stamp: 'abc123' })), 'abc123')
    assert.equal(readSourceStamp(deployedFunction('a', { stamp: null })), null)
    assert.equal(readSourceStamp({ name: 'x' }), null)
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

describe('writing the stamp into the dotenv', () => {
  it('appends the stamp and keeps every other line', () => {
    assert.equal(
      withSourceStamp('# comment\nAGLYN_CONSOLE_URL=https://a\n', 'abc'),
      `# comment\nAGLYN_CONSOLE_URL=https://a\n${SOURCE_STAMP_ENV}=abc\n`,
    )
  })

  it('replaces an earlier stamp rather than adding a second one', () => {
    assert.equal(
      withSourceStamp(`A=1\n${SOURCE_STAMP_ENV}=old\nB=2\n`, 'new'),
      `A=1\nB=2\n${SOURCE_STAMP_ENV}=new\n`,
    )
  })

  it('removes the stamp when there is none to write, so an old sha never carries forward', () => {
    assert.equal(withSourceStamp(`A=1\n${SOURCE_STAMP_ENV}=old\n`, null), 'A=1\n')
    assert.equal(withSourceStamp('', null), '')
  })

  it('runs as a functions predeploy hook, so every deploy stamps', () => {
    const firebase = JSON.parse(readFileSync(join(repoRoot, 'cloud', 'firebase.json'), 'utf8'))
    assert.ok(
      firebase.functions.predeploy.some((step) => step.includes('run stamp-source')),
      firebase.functions.predeploy.join('\n'),
    )
    const pkg = JSON.parse(
      readFileSync(join(repoRoot, 'cloud', 'functions', 'package.json'), 'utf8'),
    )
    assert.equal(pkg.scripts['stamp-source'], 'node scripts/stamp-source.mjs')
  })
})

describe('classification', () => {
  const same = () => ({ known: true, same: true, missing: [], extra: [] })

  it('grades a deployment whose stamped tree equals the baseline as current', () => {
    const verdict = classifyFunctionsDrift({
      deployed: deployment({ updateTime: '2026-09-04T17:00:00Z', stamp: 'aaaa' }),
      declared: declaredIds,
      baselineSha: 'bbbb',
      compareSource: same,
    })
    assert.equal(verdict.drifted, false)
    assert.equal(verdict.current.length, declaredIds.length)
  })

  // The 2026-10-17 scenario, from the metadata production reported. #1702's
  // functions commit 85a289caa5 was committed at 01:19Z; the deploy that ran at
  // 02:54Z was of beta.263, which did not carry it. Deploy time is LATER than
  // the commit, so a timestamp comparison called it matched.
  it('reports drift for a deploy NEWER than the commit but stamped with older source (10/17)', () => {
    const calls = []
    const verdict = classifyFunctionsDrift({
      deployed: deployment({
        updateTime: '2026-10-17T02:54:00.123456789Z',
        stamp: '3a4b5c6d7e8f90123456789012345678901234ab',
      }),
      declared: declaredIds,
      baselineSha: '85a289caa5000000000000000000000000000000',
      compareSource: (sha) => {
        calls.push(sha)
        return {
          known: true,
          same: false,
          missing: ['85a289caa5 fix(auth): sso-domain-policy plus-tag exemption'],
          extra: [],
        }
      },
    })
    assert.ok(
      Date.parse('2026-10-17T02:54:00Z') > Date.parse('2026-10-17T01:19:00Z'),
      'the deploy really is newer than the commit',
    )
    assert.equal(verdict.drifted, true)
    assert.equal(verdict.current.length, 0)
    assert.equal(verdict.stale.length, declaredIds.length)
    assert.match(verdict.stale[0].detail, /runs 3a4b5c6d7/)
    assert.match(verdict.stale[0].detail, /missing 1 commit\(s\): 85a289caa5/)
    // One git comparison per distinct stamp, not one per function.
    assert.deepEqual(calls, ['3a4b5c6d7e8f90123456789012345678901234ab'])
  })

  it('never grades an UNSTAMPED function as a match, however recent its deploy', () => {
    const verdict = classifyFunctionsDrift({
      deployed: deployment({ updateTime: '2099-01-01T00:00:00Z', stamp: null }),
      declared: declaredIds,
      baselineSha: 'bbbb',
      compareSource: same,
    })
    assert.equal(verdict.drifted, true)
    assert.equal(verdict.unstamped.length, declaredIds.length)
    assert.match(verdict.unstamped[0].detail, /unknown — no source stamp/)
    assert.match(verdict.unstamped[0].detail, /Redeploy to stamp/)
  })

  it('reports a deploy from a dirty checkout, without asking git about it', () => {
    const verdict = classifyFunctionsDrift({
      deployed: deployment({ updateTime: '2026-09-04T17:00:00Z', stamp: `aaaa${DIRTY_STAMP_SUFFIX}` }),
      declared: declaredIds,
      baselineSha: 'bbbb',
      compareSource: () => assert.fail('a dirty stamp names no comparable commit'),
    })
    assert.equal(verdict.dirty.length, declaredIds.length)
  })

  it('reports a stamp this clone does not have as UNKNOWN SOURCE', () => {
    const verdict = classifyFunctionsDrift({
      deployed: deployment({ updateTime: '2026-09-04T17:00:00Z', stamp: 'cccc' }),
      declared: declaredIds,
      baselineSha: 'bbbb',
      compareSource: () => ({ known: false, same: false, missing: [], extra: [] }),
    })
    assert.equal(verdict.unknownSource.length, declaredIds.length)
    assert.equal(verdict.drifted, true)
  })

  it('reports a deploy carrying unpromoted commits as AHEAD', () => {
    const verdict = classifyFunctionsDrift({
      deployed: deployment({ updateTime: '2026-09-04T17:00:00Z', stamp: 'dddd' }),
      declared: declaredIds,
      baselineSha: 'bbbb',
      compareSource: () => ({ known: true, same: false, missing: [], extra: ['dddd main only'] }),
    })
    assert.equal(verdict.ahead.length, declaredIds.length)
  })

  it('catches one function in a NON-default region running older source', () => {
    const deployed = deployment(
      { updateTime: '2026-09-04T17:00:00Z', stamp: 'aaaa' },
      { beforeSignupCreate: { stamp: 'old0' } },
    )
    const verdict = classifyFunctionsDrift({
      deployed,
      declared: declaredIds,
      baselineSha: 'aaaa',
      compareSource: (sha) =>
        sha === 'aaaa'
          ? same()
          : { known: true, same: false, missing: ['aaaa x'], extra: [] },
    })
    assert.equal(verdict.stale.length, 1)
    assert.equal(verdict.stale[0].id, 'beforeSignupCreate')
    assert.equal(verdict.stale[0].region, 'us-east1')
  })

  it('reports an export the project has never deployed', () => {
    const verdict = classifyFunctionsDrift({
      deployed: deployment({ updateTime: '2026-09-04T17:00:00Z' }).filter(
        (fn) => !fn.name.endsWith('/consoleFastCrons'),
      ),
      declared: declaredIds,
      compareSource: same,
    })
    assert.equal(verdict.neverDeployed.length, 1)
    assert.equal(verdict.neverDeployed[0].id, 'consoleFastCrons')
    assert.equal(verdict.drifted, true)
  })

  it('reports a deployed function the promoted source no longer exports', () => {
    const verdict = classifyFunctionsDrift({
      deployed: [
        ...deployment({ updateTime: '2026-09-04T17:00:00Z' }),
        deployedFunction('consoleRetiredJob', { updateTime: '2026-09-04T17:00:00Z' }),
      ],
      declared: declaredIds,
      compareSource: same,
    })
    assert.equal(verdict.orphaned.length, 1)
    assert.equal(verdict.orphaned[0].id, 'consoleRetiredJob')
  })

  it('does not call everything an orphan when the export list is empty', () => {
    const verdict = classifyFunctionsDrift({
      deployed: deployment({ updateTime: '2026-09-04T17:00:00Z' }),
      declared: [],
      compareSource: same,
    })
    assert.equal(verdict.orphaned.length, 0)
  })

  it('refuses to grade a half-finished deployment on its stamp', () => {
    const deployed = deployment(
      { updateTime: '2026-09-04T17:00:00Z' },
      { consoleFastCrons: { state: 'FAILED' } },
    )
    const verdict = classifyFunctionsDrift({ deployed, declared: declaredIds, compareSource: same })
    assert.equal(verdict.notActive.length, 1)
    assert.equal(verdict.notActive[0].id, 'consoleFastCrons')
    assert.equal(verdict.drifted, true)
  })

  it('renders one aligned line per function, oldest deploy first', () => {
    const lines = renderFunctionLines([
      { id: 'b', region: 'us-east1', updateTime: '2026-09-02T00:00:00Z', updatedAtMs: 2 },
      {
        id: 'aa',
        region: 'us-central1',
        updateTime: '2026-09-01T00:00:00Z',
        updatedAtMs: 1,
        stamp: '0123456789abcdef',
      },
    ])
    assert.match(lines[0], /^ {2}aa {2}us-central1 .* source 012345678$/)
    assert.match(lines[1], /^ {2}b {3}us-east1/)
  })
})

describe('the CLI, end to end against a stubbed Cloud Functions API', () => {
  const listBody = (functions, extra = {}) => ({ functions, ...extra })

  it('exits 0 when every function is stamped with the baseline source', async () => {
    await withStub(
      () => listBody(deployment({ updateTime: afterLastCommit })),
      async ({ base, requests }) => {
        const { code, out } = await runCli({ base })
        assert.equal(code, 0, out)
        assert.match(out, /Every function the API could see runs HEAD's cloud\/functions/)
        assert.match(out, /All deployed functions match HEAD/)
        // The region wildcard, not a hardcoded region: this is the assertion
        // that keeps us-east1 in view.
        assert.ok(requests.every((url) => url.includes('/locations/-/functions')), requests.join(' '))
      },
    )
  })

  it('exits 0 for a stamp that is a different commit with the same package tree', async () => {
    // HEAD and the last functions commit differ as commits (usually) but carry
    // the same package: content, not identity, decides.
    await withStub(
      () => listBody(deployment({ updateTime: afterLastCommit, stamp: lastFunctionsSha })),
      async ({ base }) => {
        const { code, out } = await runCli({ base })
        assert.equal(code, 0, out)
      },
    )
  })

  it('EXITS 1 for the 10/17 shape: deployed after the last commit, from source without it', async () => {
    await withStub(
      () => listBody(deployment({ updateTime: afterLastCommit, stamp: olderSha })),
      async ({ base }) => {
        const { code, out } = await runCli({ base })
        assert.equal(code, 1, out)
        assert.doesNotMatch(out, /All deployed functions match/)
        assert.match(out, /DRIFT/)
        assert.match(out, /STALE consoleFastCrons \[us-central1\]/)
        assert.match(out, new RegExp(`missing \\d+ commit\\(s\\): ${lastFunctionsSha.slice(0, 7)}`))
        assert.match(out, /npm --prefix cloud\/functions run deploy/)
      },
    )
  })

  it('EXITS 1 and says "unknown — no source stamp" for a deploy made before stamping existed', async () => {
    await withStub(
      () => listBody(deployment({ updateTime: afterLastCommit, stamp: null })),
      async ({ base }) => {
        const { code, out } = await runCli({ base })
        assert.equal(code, 1, out)
        assert.match(out, /UNSTAMPED consoleFastCrons/)
        assert.match(out, /unknown — no source stamp/)
        assert.doesNotMatch(out, /All deployed functions match/)
      },
    )
  })

  it('EXITS 1 for a stamped sha this clone does not have', async () => {
    await withStub(
      () => listBody(deployment({ updateTime: afterLastCommit, stamp: 'f'.repeat(40) })),
      async ({ base }) => {
        const { code, out } = await runCli({ base })
        assert.equal(code, 1, out)
        assert.match(out, /UNKNOWN SOURCE consoleFastCrons/)
      },
    )
  })

  it('EXITS 1 for a deploy from a dirty checkout', async () => {
    await withStub(
      () =>
        listBody(deployment({ updateTime: afterLastCommit, stamp: `${headSha}${DIRTY_STAMP_SUFFIX}` })),
      async ({ base }) => {
        const { code, out } = await runCli({ base })
        assert.equal(code, 1, out)
        assert.match(out, /DIRTY consoleFastCrons/)
      },
    )
  })

  it('EXITS 1 for older source in us-east1 while every other region is current', async () => {
    await withStub(
      () =>
        listBody(
          deployment({ updateTime: afterLastCommit }, { beforeSignupCreate: { stamp: olderSha } }),
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
          deployment({ updateTime: afterLastCommit }).filter(
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
    const fresh = deployment({ updateTime: afterLastCommit })
    await withStub(
      (req) =>
        req.url.includes('pageToken=')
          ? listBody(fresh.slice(1))
          : listBody(
              [
                {
                  ...fresh[0],
                  serviceConfig: { environmentVariables: { [SOURCE_STAMP_ENV]: olderSha } },
                },
              ],
              { nextPageToken: 'page-2' },
            ),
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
          deployment({ updateTime: afterLastCommit }).filter(
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
      () => listBody(deployment({ updateTime: afterLastCommit })),
      async ({ base }) => {
        const { code, out } = await runCli({ base, args: ['--baseline=refs/heads/no-such-ref'] })
        assert.equal(code, 2, out)
        assert.match(out, /does not resolve/)
      },
    )
  })

  it('compares against --baseline, not HEAD, when one is given', async () => {
    // Stamped with HEAD and judged against the older commit: the deploy now
    // carries commits the baseline does not.
    await withStub(
      () => listBody(deployment({ updateTime: afterLastCommit })),
      async ({ base }) => {
        const { code, out } = await runCli({ base, args: [`--baseline=${olderSha}`] })
        assert.equal(code, 1, out)
        assert.match(out, /AHEAD consoleFastCrons/)
      },
    )
  })
})

/*
 * A dependency tree is not source (AGL-2695). One was tracked under
 * `cloud/functions` by accident, and the commits on either side of it — the
 * one that added it and the one that removed it — each looked like a reason
 * to redeploy.
 */
describe('what counts as a change to the deployed package', () => {
  it('excludes what cannot change what runs', () => {
    assert.deepEqual(
      [...FUNCTIONS_SOURCE_PATHSPECS],
      [
        'cloud/functions',
        ':(exclude)cloud/functions/node_modules',
        ':(exclude)cloud/functions/.gitignore',
      ],
    )
    const withModules = git([
      'log', '-1', '--format=%H', 'HEAD', '--', FUNCTIONS_SOURCE_PATH,
    ]).trim()
    const withoutModules = git([
      'log', '-1', '--format=%H', 'HEAD', '--', ...FUNCTIONS_SOURCE_PATHSPECS,
    ]).trim()
    // Both resolve; the exclusion may or may not move the answer depending on
    // where HEAD sits, but it must never widen it.
    assert.ok(withModules.length === 40)
    assert.ok(withoutModules.length === 40)
  })
})
