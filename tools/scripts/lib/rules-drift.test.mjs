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

// Tests for the live-vs-HEAD rules drift check (AGL-1509 / AGL-1489).
//
// The e2e suite PLANTS THE DRIFT: it stands up a local stub of the
// firebaserules API (and the RTDB rules endpoint), feeds the real CLI a
// doctored "live" payload — including the literal AGL-1489 state, HEAD minus
// its `mediaTombstones` lines — and asserts the CLI's real exit codes (no
// pipes). Identical payloads must go green, a doctored one red, and an API
// failure must exit 2: cannot-check is never clean.
//
// The wiring suite asserts the workflow and package.json actually CALL the
// checker — a detector that exists but is not wired is the control we
// pretend to have (see feedback: verify a control is WIRED).

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { execFileSync, spawn } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  compareRules,
  describeDirection,
  normalizeRulesText,
  renderUnifiedDiff,
} from './rules-drift.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(here, '..', '..', '..')
const cliPath = join(repoRoot, 'tools', 'scripts', 'check-rules-drift.mjs')

describe('normalizeRulesText', () => {
  it('a trailing-newline-only difference normalizes away (the AGL-1489 storage case)', () => {
    assert.equal(normalizeRulesText('a\nb'), normalizeRulesText('a\nb\n'))
    assert.equal(normalizeRulesText('a\nb\n\n\n'), 'a\nb\n')
  })

  it('line endings normalize to LF', () => {
    assert.equal(normalizeRulesText('a\r\nb\r\n'), 'a\nb\n')
  })

  it('inner content differences survive normalization', () => {
    assert.notEqual(normalizeRulesText('a\n\nb\n'), normalizeRulesText('a\nb\n'))
  })

  it('empty stays empty', () => {
    assert.equal(normalizeRulesText(''), '')
    assert.equal(normalizeRulesText('\n\n'), '')
  })
})

describe('compareRules', () => {
  const head =
    'service cloud.firestore {\n' +
    "  allow write: if !(sub in ['webhooks', 'orders', 'mediaTombstones']);\n" +
    '}\n'

  it('identical modulo trailing newline is NOT drift', () => {
    const verdict = compareRules({
      liveText: head.replace(/\n$/, ''),
      headText: head,
    })
    assert.equal(verdict.drift, false)
  })

  it('the AGL-1489 shape — deny-list entry committed but not live — is drift, HEAD ahead', () => {
    const live = head.replace(", 'mediaTombstones'", '')
    const verdict = compareRules({ liveText: live, headText: head })
    assert.equal(verdict.drift, true)
    assert.equal(verdict.direction, 'diverged') // the line CHANGED, both sides differ
    const added = compareRules({
      liveText: 'service cloud.firestore {\n}\n',
      headText: 'service cloud.firestore {\n  match /x {}\n}\n',
    })
    assert.equal(added.drift, true)
    assert.equal(added.direction, 'head-ahead')
    assert.match(added.summary, /HEAD is ahead of live/)
    assert.match(added.summary, /not\s+deployed/)
  })

  it('live-only content — a console hot-fix — is drift, live ahead', () => {
    const verdict = compareRules({
      liveText: 'service cloud.firestore {\n  match /hotfix {}\n}\n',
      headText: 'service cloud.firestore {\n}\n',
    })
    assert.equal(verdict.drift, true)
    assert.equal(verdict.direction, 'live-ahead')
    assert.match(verdict.summary, /Live is ahead of HEAD/)
  })

  it('divergence names both sides', () => {
    const verdict = compareRules({
      liveText: 'a\nlive-only\n',
      headText: 'a\nhead-only\n',
    })
    assert.equal(verdict.drift, true)
    assert.equal(verdict.direction, 'diverged')
    assert.match(verdict.summary, /DIVERGED/)
  })

  it('RTDB JSON that deep-equals after parsing is formatting-only, not drift', () => {
    const verdict = compareRules({
      liveText: '{\n    "rules": {\n        ".read": false\n    }\n}',
      headText: '{ "rules": { ".read": false } }\n',
      jsonAware: true,
    })
    assert.equal(verdict.drift, false)
    assert.equal(verdict.formattingOnly, true)
  })

  it('RTDB JSON with a real value change is drift even when both parse', () => {
    const verdict = compareRules({
      liveText: '{ "rules": { ".read": true } }\n',
      headText: '{ "rules": { ".read": false } }\n',
      jsonAware: true,
    })
    assert.equal(verdict.drift, true)
  })
})

describe('describeDirection counts line multisets', () => {
  it('a duplicated line removed once still counts', () => {
    const direction = describeDirection('x\n', 'x\nx\n')
    assert.equal(direction.direction, 'head-ahead')
    assert.equal(direction.headOnlyLines, 1)
  })
})

describe('renderUnifiedDiff', () => {
  it('marks committed-but-not-live lines with + and live-only lines with -', () => {
    const diff = renderUnifiedDiff(
      'service {\n  live_only_line\n}\n',
      'service {\n  head_only_line\n}\n',
      { fileName: 'firebase-firestore.rules' },
    )
    assert.match(diff, /^\+ {2}head_only_line$/m)
    assert.match(diff, /^- {2}live_only_line$/m)
  })

  it('returns an empty diff for texts equal after normalization', () => {
    const diff = renderUnifiedDiff('a\n', 'a', {
      fileName: 'firebase-storage.rules',
    })
    assert.equal(diff, '')
  })
})

// --- e2e: the real CLI against a stubbed live API ------------------------

const PROJECT = 'drift-test'
const BUCKET = 'drift-test-bucket'

function headOf(file) {
  return execFileSync('git', ['show', `HEAD:${file}`], {
    cwd: repoRoot,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  })
}

/** Serve doctored "live" rules. Values are strings (200) or {status, body}. */
async function withStub({ firestore, storage, database }, run) {
  const releases = {
    [`/v1/projects/${PROJECT}/releases/cloud.firestore`]: 'fs1',
    [`/v1/projects/${PROJECT}/releases/firebase.storage/${BUCKET}`]: 'st1',
  }
  const rulesets = {
    [`/v1/projects/${PROJECT}/rulesets/fs1`]: firestore,
    [`/v1/projects/${PROJECT}/rulesets/st1`]: storage,
  }
  const server = createServer((req, res) => {
    const path = req.url.split('?')[0]
    const respond = (status, body, type = 'application/json') => {
      res.writeHead(status, { 'Content-Type': type })
      res.end(body)
    }
    const surface = releases[path]
    if (surface !== undefined) {
      const content = rulesets[`/v1/projects/${PROJECT}/rulesets/${surface}`]
      if (content && typeof content === 'object') {
        return respond(content.status, content.body ?? '{"error":"stub"}')
      }
      return respond(
        200,
        JSON.stringify({
          rulesetName: `projects/${PROJECT}/rulesets/${surface}`,
          updateTime: '2026-08-13T00:00:00Z',
        }),
      )
    }
    const ruleset = rulesets[path]
    if (ruleset !== undefined) {
      if (ruleset && typeof ruleset === 'object') {
        return respond(ruleset.status, ruleset.body ?? '{"error":"stub"}')
      }
      return respond(
        200,
        JSON.stringify({ source: { files: [{ name: 'r', content: ruleset }] } }),
      )
    }
    if (path === '/db/.settings/rules.json') {
      if (database && typeof database === 'object') {
        return respond(database.status, database.body ?? '{"error":"stub"}')
      }
      return respond(200, database)
    }
    respond(404, '{"error":"unexpected path ' + path + '"}')
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = server.address().port
  try {
    await run(port)
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
}

/**
 * Run the real CLI. Async (never spawnSync): the stub server lives in THIS
 * process, so a synchronous spawn would block the event loop and deadlock
 * the CLI's fetches against it.
 */
function runCli({ port, args = [], cwd = repoRoot, env = null }) {
  // RULES_CHECK_ACCESS_TOKEN short-circuits token minting, and the API-base +
  // database-URL overrides aim the whole fetch pipeline at the stub, so the
  // run is hermetic even though loadLocalEnv may read the repo's .env
  // (pre-set process.env always wins there).
  const child = spawn(process.execPath, [cliPath, ...args], {
    cwd,
    env: env ?? {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      FIREBASE_PROJECT_ID: PROJECT,
      FIREBASE_CLIENT_EMAIL: 'stub@drift-test.iam.gserviceaccount.com',
      FIREBASE_PRIVATE_KEY: 'stub',
      RULES_CHECK_ACCESS_TOKEN: 'stub-token',
      FIREBASE_RULES_API_BASE: `http://127.0.0.1:${port}`,
      NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET: BUCKET,
      NEXT_PUBLIC_FIREBASE_DATABASE_URL: `http://127.0.0.1:${port}/db`,
    },
  })
  let stdout = ''
  let stderr = ''
  child.stdout.setEncoding('utf8').on('data', (chunk) => (stdout += chunk))
  child.stderr.setEncoding('utf8').on('data', (chunk) => (stderr += chunk))
  return new Promise((resolve, reject) => {
    child.on('error', reject)
    child.on('close', (status) => resolve({ status, stdout, stderr }))
  })
}

describe('check-rules-drift CLI (planted drift, stubbed live API)', () => {
  const headFirestore = headOf('cloud/firebase-firestore.rules')
  const headStorage = headOf('cloud/firebase-storage.rules')
  const headDatabase = headOf('cloud/firebase-database.rules.json')

  it('live == HEAD on all three surfaces exits 0 — including a stripped trailing newline and reformatted RTDB JSON', async () => {
    await withStub(
      {
        firestore: headFirestore,
        // The exact AGL-1489 storage observation: byte-identical except the
        // trailing newline. Must NOT be drift.
        storage: headStorage.replace(/\s+$/, ''),
        // The console reserializes JSON; deep-equal formatting is not drift.
        database: JSON.stringify(JSON.parse(headDatabase), null, 4),
      },
      async (port) => {
        const result = await runCli({ port })
        assert.equal(
          result.status,
          0,
          `expected clean exit, got ${result.status}:\n${result.stdout}\n${result.stderr}`,
        )
        assert.match(result.stdout, /OK firestore/)
        assert.match(result.stdout, /OK storage/)
        assert.match(result.stdout, /OK database.*formatting/)
      },
    )
  })

  it('planted drift goes red (exit 1) and the diff names each side', async () => {
    // The literal AGL-1489 live state: HEAD minus its mediaTombstones lines.
    let doctoredFirestore = headFirestore
      .split('\n')
      .filter((line) => !line.includes('mediaTombstones'))
      .join('\n')
    if (
      normalizeRulesText(doctoredFirestore) === normalizeRulesText(headFirestore)
    ) {
      // HEAD no longer mentions mediaTombstones; drop the closing lines
      // instead so the drift stays planted.
      doctoredFirestore = headFirestore.split('\n').slice(0, -3).join('\n')
    }
    await withStub(
      {
        firestore: doctoredFirestore,
        // The reverse direction on storage: a console hot-fix live, in no
        // commit.
        storage: `${headStorage.replace(/\s+$/, '')}\n// live-only hotfix\n`,
        database: headDatabase,
      },
      async (port) => {
        const result = await runCli({ port })
        assert.equal(
          result.status,
          1,
          `expected drift exit 1, got ${result.status}:\n${result.stdout}\n${result.stderr}`,
        )
        assert.match(result.stderr, /DRIFT firestore/)
        assert.match(result.stderr, /HEAD is ahead of live/)
        // The missing deny-list entries appear as committed-but-not-live.
        assert.match(result.stderr, /^\+.*mediaTombstones/m)
        assert.match(result.stderr, /DRIFT storage/)
        assert.match(result.stderr, /Live is ahead of HEAD/)
        assert.match(result.stderr, /^-.*live-only hotfix/m)
        assert.match(result.stdout, /OK database/)
      },
    )
  })

  it('a live API failure exits 2 — cannot-check never masquerades as clean', async () => {
    await withStub(
      {
        firestore: { status: 500, body: '{"error":"stub outage"}' },
        storage: headStorage,
        database: headDatabase,
      },
      async (port) => {
        const result = await runCli({ port })
        assert.equal(
          result.status,
          2,
          `expected cannot-check exit 2, got ${result.status}:\n${result.stdout}\n${result.stderr}`,
        )
        assert.match(result.stderr, /CANNOT CHECK firestore/)
        assert.match(result.stdout, /OK storage/)
      },
    )
  })

  it('drift outranks cannot-check when both occur (exit 1, both reported)', async () => {
    await withStub(
      {
        firestore: { status: 500 },
        storage: `${headStorage}// live-only\n`,
        database: headDatabase,
      },
      async (port) => {
        const result = await runCli({ port })
        assert.equal(result.status, 1)
        assert.match(result.stderr, /CANNOT CHECK firestore/)
        assert.match(result.stderr, /DRIFT storage/)
      },
    )
  })

  it('a surface subset argument checks only that surface', async () => {
    await withStub({ database: headDatabase }, async (port) => {
      const result = await runCli({ port, args: ['database'] })
      assert.equal(result.status, 0, result.stderr)
      assert.match(result.stdout, /OK database/)
      assert.doesNotMatch(result.stdout, /firestore/)
    })
  })

  // --- the promotion window is not drift (AGL-1690) ----------------------
  //
  // Rules deploy from a checkout pinned to the PROMOTED SHA, so on `main` the
  // live ruleset is the one at the last promotion, not at HEAD. These pin the
  // baseline flag that makes that comparison possible: the promotion window
  // must be GREEN and itemised, while a ref that cannot be resolved must be
  // exit 2 rather than a silent fall back to HEAD.

  // The newest commit that touched the firestore rules, and its parent. The
  // parent stands in for "the promoted SHA" — live is at the parent, HEAD
  // carries one undeployed rules commit. Exactly the state that was failing.
  const lastRulesCommit = execFileSync(
    'git',
    ['log', '-1', '--format=%H', '--', 'cloud/firebase-firestore.rules'],
    { cwd: repoRoot, encoding: 'utf8' },
  ).trim()
  const promotedRef = `${lastRulesCommit}^`
  const showAt = (ref, file) =>
    execFileSync('git', ['show', `${ref}:${file}`], {
      cwd: repoRoot,
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
    })

  it('live at the promoted baseline is GREEN even though HEAD is ahead, and the pending commit is itemised', async () => {
    const promotedFirestore = showAt(promotedRef, 'cloud/firebase-firestore.rules')
    // Guard the premise: the chosen commit really does change this file, so
    // "green" below is not green-because-identical.
    assert.notEqual(
      normalizeRulesText(promotedFirestore),
      normalizeRulesText(headFirestore),
      'expected the last rules commit to change the firestore rules file',
    )
    await withStub(
      {
        firestore: promotedFirestore,
        storage: showAt(promotedRef, 'cloud/firebase-storage.rules'),
        database: showAt(promotedRef, 'cloud/firebase-database.rules.json'),
      },
      async (port) => {
        const result = await runCli({
          port,
          args: [`--baseline=${promotedRef}`],
        })
        assert.equal(
          result.status,
          0,
          `expected the promotion window to be clean, got ${result.status}:\n${result.stdout}\n${result.stderr}`,
        )
        assert.match(result.stdout, /OK firestore/)
        assert.doesNotMatch(result.stderr, /DRIFT/)
        // The signal survives the green: what is owed at the next promotion.
        assert.match(result.stdout, /PENDING DEPLOY/)
        assert.match(result.stdout, new RegExp(lastRulesCommit.slice(0, 7)))
      },
    )
  })

  it('a baseline that does not resolve exits 2 — never a silent fall back to HEAD', async () => {
    await withStub(
      { firestore: headFirestore, storage: headStorage, database: headDatabase },
      async (port) => {
        const result = await runCli({
          port,
          args: ['--baseline=refs/heads/no-such-ref-agl1690'],
        })
        assert.equal(
          result.status,
          2,
          `expected cannot-check exit 2, got ${result.status}:\n${result.stdout}\n${result.stderr}`,
        )
        assert.match(result.stderr, /does not resolve to a commit/)
        // Live matches HEAD here, so a fallback to HEAD would have printed a
        // clean run and exited 0. It must not have compared anything at all.
        assert.doesNotMatch(result.stdout, /OK firestore/)
      },
    )
  })

  it('RULES_DRIFT_BASELINE sets the baseline without a flag (the CI path)', async () => {
    await withStub(
      { firestore: headFirestore, storage: headStorage, database: headDatabase },
      async (port) => {
        const result = await runCli({
          port,
          env: {
            PATH: process.env.PATH,
            HOME: process.env.HOME,
            FIREBASE_PROJECT_ID: PROJECT,
            FIREBASE_CLIENT_EMAIL: 'stub@drift-test.iam.gserviceaccount.com',
            FIREBASE_PRIVATE_KEY: 'stub',
            RULES_CHECK_ACCESS_TOKEN: 'stub-token',
            FIREBASE_RULES_API_BASE: `http://127.0.0.1:${port}`,
            NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET: BUCKET,
            NEXT_PUBLIC_FIREBASE_DATABASE_URL: `http://127.0.0.1:${port}/db`,
            RULES_DRIFT_BASELINE: 'no-such-ref-agl1690',
          },
        })
        assert.equal(result.status, 2, result.stderr)
        assert.match(result.stderr, /no-such-ref-agl1690/)
      },
    )
  })

  it('missing credentials exit 2 with the exact secret-setup command', async () => {
    const bare = mkdtempSync(join(tmpdir(), 'agl1509-nocreds-'))
    try {
      // cwd outside the repo: loadLocalEnv finds no .env, and no FIREBASE_*
      // vars are passed — the CI-without-secrets state.
      const result = await runCli({
        cwd: bare,
        env: { PATH: process.env.PATH, HOME: process.env.HOME },
      })
      assert.equal(
        result.status,
        2,
        `expected exit 2, got ${result.status}:\n${result.stdout}\n${result.stderr}`,
      )
      assert.match(result.stderr, /Cannot check/)
      assert.match(result.stderr, /gh secret set FIREBASE_CLIENT_EMAIL/)
      assert.match(result.stderr, /gh secret set FIREBASE_PRIVATE_KEY/)
      assert.match(result.stderr, /NOT clean/)
    } finally {
      rmSync(bare, { recursive: true, force: true })
    }
  })
})

describe('the checker is wired (workflow + package.json)', () => {
  // Asserted at the DECLARATION: a workflow or script entry that quietly
  // drops the call is the unwired control this suite exists to catch.
  it('package.json exposes check:rules-drift and test:rules-drift', () => {
    const pkg = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8'))
    assert.equal(
      pkg.scripts['check:rules-drift'],
      'node tools/scripts/check-rules-drift.mjs',
    )
    assert.match(pkg.scripts['test:rules-drift'], /rules-drift\.test\.mjs/)
  })

  it('the rules-drift workflow runs the checker, on a schedule and on rules pushes, and fails loudly without secrets', () => {
    const workflow = readFileSync(
      join(repoRoot, '.github', 'workflows', 'rules-drift.yml'),
      'utf8',
    )
    assert.match(workflow, /check:rules-drift/)
    assert.match(workflow, /schedule:/)
    for (const file of [
      'cloud/firebase-firestore.rules',
      'cloud/firebase-storage.rules',
      'cloud/firebase-database.rules.json',
    ]) {
      assert.ok(
        workflow.includes(file),
        `workflow path filter is missing ${file}`,
      )
    }
    // The missing-secret guard must FAIL the job, not skip it — a skipped
    // check that looks green is the failure mode this tool exists to prevent.
    assert.match(workflow, /secrets\.FIREBASE_CLIENT_EMAIL/)
    assert.match(workflow, /secrets\.FIREBASE_PRIVATE_KEY/)
    assert.match(workflow, /gh secret set FIREBASE_CLIENT_EMAIL/)
    assert.match(workflow, /exit 2/)
  })

  it('the workflow also runs THIS self-test, before it trusts the comparison (AGL-1778)', () => {
    const workflow = readFileSync(
      join(repoRoot, '.github', 'workflows', 'rules-drift.yml'),
      'utf8',
    )
    // Until AGL-1778 the detector ran on every rules push and daily, and its
    // own self-test ran in no workflow at all — a live control that nothing
    // checked still detects. A comparator that has stopped comparing reports
    // "no drift", which is indistinguishable from convergence.
    const selfTest = workflow.indexOf('npm run test:rules-drift')
    const check = workflow.indexOf('npm run check:rules-drift')
    assert.ok(selfTest !== -1, 'rules-drift.yml must run npm run test:rules-drift')
    assert.ok(check !== -1, 'rules-drift.yml must run npm run check:rules-drift')
    // Order matters: a failing comparator must fail the job before its
    // verdict is printed, not after.
    assert.ok(
      selfTest < check,
      'the self-test must run BEFORE the drift comparison',
    )
    // This assertion is only worth anything because a SECOND workflow runs
    // this suite. Asserted solely from inside rules-drift.yml it would be
    // circular — removing the step would remove the check on the removal.
    //
    // AGL-1816: that second home used to be nx-ci.yml, which is
    // `disabled_manually` and runs on no runner, so the redundancy existed
    // only as text in a file that never executes. index-drift.yml is active,
    // and the two drift workflows now each run both self-tests.
    const indexDrift = readFileSync(
      join(repoRoot, '.github', 'workflows', 'index-drift.yml'),
      'utf8',
    )
    assert.match(indexDrift, /npm run test:rules-drift/)
  })

  it('the workflow compares against the PROMOTED baseline, with the history to resolve it (AGL-1690)', () => {
    const workflow = readFileSync(
      join(repoRoot, '.github', 'workflows', 'rules-drift.yml'),
      'utf8',
    )
    // Comparing against the checked-out branch is the bug: on `main` it
    // reports the promotion window as a failure.
    assert.match(workflow, /RULES_DRIFT_BASELINE:\s*origin\/production/)
    // Resolving origin/production and listing origin/production..HEAD both
    // need real history; a shallow clone would turn every run into exit 2.
    assert.match(workflow, /fetch-depth:\s*0/)
    // A skipped rules deploy must go red AT the promotion, not up to a day
    // later on the schedule.
    assert.match(workflow, /^ {6}- production$/m)
  })

  it('the CLI actually uses the shared comparison and shared auth', () => {
    const source = readFileSync(cliPath, 'utf8')
    assert.match(source, /from '\.\/lib\/rules-drift\.mjs'/)
    assert.match(source, /from '\.\/lib\/firebase-rules-api\.mjs'/)
    assert.match(source, /compareRules\(/)
  })
})
