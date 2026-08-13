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

// Fails when the LIVE Firebase security rules drift from HEAD (AGL-1509).
//
// Rules deploy manually (deploy-*-rules.mjs), outside the git pipeline, so a
// merged commit touching cloud/firebase-*.rules is NOT evidence the ruleset
// shipped: AGL-1489 found production Firestore rules a day behind HEAD with
// `mediaTombstones` missing from the deny-lists, and only a manual sweep
// noticed. This script IS that sweep, runnable: it fetches the live rules for
// all three surfaces and diffs each against `git show HEAD:cloud/...`.
//
//   npm run check:rules-drift              # all three surfaces
//   npm run check:rules-drift -- storage   # a subset: firestore|storage|database
//
// Auth: the deploy scripts' exact pattern, shared via lib/firebase-rules-api
// — service account from the root .env (FIREBASE_PROJECT_ID,
// FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY; self-loaded, already-set env
// wins). RULES_CHECK_ACCESS_TOKEN skips minting (e.g.
// `RULES_CHECK_ACCESS_TOKEN=$(gcloud auth print-access-token)`).
//
// Exit codes — cannot-check must NEVER masquerade as clean:
//   0  every checked surface matches HEAD
//   1  drift on at least one surface (unified diff printed, direction named)
//   2  at least one surface could not be checked (missing creds, auth,
//      network) and none drifted; drift wins when both occur — both are red,
//      and drift is the more actionable signal
//
// Trailing-newline-only and line-ending-only differences are NOT drift, and
// RTDB JSON that deep-equals after parsing is formatting-only — see
// lib/rules-drift.mjs for why crying wolf would defeat the check.

import { basename } from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import {
  fetchLiveDatabaseRules,
  fetchLiveRulesetContent,
  getServiceAccountToken,
  loadLocalEnv,
  readServiceAccount,
  resolveDatabaseUrl,
  resolveStorageBucket,
} from './lib/firebase-rules-api.mjs'
import { compareRules, renderUnifiedDiff } from './lib/rules-drift.mjs'

loadLocalEnv()

const repoRoot = fileURLToPath(new URL('../..', import.meta.url))

const SURFACES = {
  firestore: {
    file: 'cloud/firebase-firestore.rules',
    jsonAware: false,
    fetchLive: ({ token, projectId }) =>
      fetchLiveRulesetContent({ token, projectId, releaseId: 'cloud.firestore' }),
    describeLive: ({ projectId }) =>
      `release cloud.firestore (project ${projectId})`,
  },
  storage: {
    file: 'cloud/firebase-storage.rules',
    jsonAware: false,
    fetchLive: ({ token, projectId }) =>
      fetchLiveRulesetContent({
        token,
        projectId,
        releaseId: `firebase.storage/${resolveStorageBucket(projectId)}`,
      }),
    describeLive: ({ projectId }) =>
      `release firebase.storage/${resolveStorageBucket(projectId)}`,
  },
  database: {
    file: 'cloud/firebase-database.rules.json',
    jsonAware: true,
    fetchLive: ({ token, projectId }) =>
      fetchLiveDatabaseRules({
        token,
        databaseUrl: resolveDatabaseUrl(projectId),
      }),
    describeLive: ({ projectId }) =>
      `${resolveDatabaseUrl(projectId)}/.settings/rules.json`,
  },
}

const args = process.argv.slice(2).filter((a) => a !== '--')
const selected = args.length > 0 ? args : Object.keys(SURFACES)
for (const name of selected) {
  if (!SURFACES[name]) {
    console.error(
      `Unknown surface '${name}'. Valid: ${Object.keys(SURFACES).join(', ')}.`,
    )
    process.exit(2)
  }
}

const projectId = process.env.FIREBASE_PROJECT_ID
const serviceAccount = readServiceAccount()
const tokenOverride = process.env.RULES_CHECK_ACCESS_TOKEN
if (!projectId || (!serviceAccount && !tokenOverride)) {
  console.error(
    [
      'Cannot check: missing Firebase service-account credentials.',
      '',
      'This check compares LIVE security rules against HEAD; without',
      'credentials it cannot see live, and reporting success here would be',
      'the silent-drift failure mode it exists to prevent (AGL-1489).',
      '',
      'Locally: the repo .env supplies FIREBASE_PROJECT_ID,',
      'FIREBASE_CLIENT_EMAIL and FIREBASE_PRIVATE_KEY (self-loaded).',
      'In CI: create the repo secrets once —',
      "  gh secret set FIREBASE_CLIENT_EMAIL --body '<client_email from the service-account JSON>'",
      '  gh secret set FIREBASE_PRIVATE_KEY --body "$(jq -r .private_key service-account.json)"',
      'Alternatively set RULES_CHECK_ACCESS_TOKEN (e.g. gcloud auth',
      'print-access-token) together with FIREBASE_PROJECT_ID.',
      '',
      'Exiting 2 (cannot-check). Cannot-check is NOT clean.',
    ].join('\n'),
  )
  process.exit(2)
}

let token
try {
  token = tokenOverride || (await getServiceAccountToken(serviceAccount))
} catch (error) {
  console.error(`Cannot check: minting an access token failed: ${error.message}`)
  process.exit(2)
}

function headContent(file) {
  return execFileSync('git', ['show', `HEAD:${file}`], {
    cwd: repoRoot,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
}

let sawDrift = false
let sawCannotCheck = false

for (const name of selected) {
  const surface = SURFACES[name]
  let head
  try {
    head = headContent(surface.file)
  } catch (error) {
    console.error(
      `CANNOT CHECK ${name}: git show HEAD:${surface.file} failed: ${error.message}`,
    )
    sawCannotCheck = true
    continue
  }
  let live
  try {
    live = await surface.fetchLive({ token, projectId })
  } catch (error) {
    console.error(
      `CANNOT CHECK ${name} (${surface.describeLive({ projectId })}): ${error.message}`,
    )
    sawCannotCheck = true
    continue
  }
  const verdict = compareRules({
    liveText: live.content,
    headText: head,
    jsonAware: surface.jsonAware,
  })
  const liveId = live.rulesetName ? ` [live ${live.rulesetName}]` : ''
  if (!verdict.drift) {
    const note = verdict.formattingOnly
      ? ' (JSON formatting differs, content identical)'
      : ''
    console.log(`OK ${name}: live matches HEAD:${surface.file}${note}${liveId}`)
    continue
  }
  sawDrift = true
  console.error(`DRIFT ${name}: live differs from HEAD:${surface.file}${liveId}`)
  console.error(`  ${verdict.summary}`)
  console.error(
    '  Diff is live -> HEAD: `+` lines are committed but NOT live; `-` lines are live but in no commit.',
  )
  console.error(
    renderUnifiedDiff(live.content, head, { fileName: basename(surface.file) }),
  )
}

if (sawDrift) {
  console.error(
    '\nDrift detected. To converge: review the diff, then run the matching',
  )
  console.error(
    'tools/scripts/deploy-*-rules.mjs (HEAD ahead) or commit the live edits',
  )
  console.error('first (live ahead). Never blind-deploy over a divergence.')
  process.exit(1)
}
if (sawCannotCheck) {
  console.error('\nAt least one surface could not be checked — exiting 2, not 0.')
  process.exit(2)
}
console.log('All checked surfaces match HEAD.')
