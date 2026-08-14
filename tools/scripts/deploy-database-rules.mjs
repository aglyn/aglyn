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

// Deploys cloud/firebase-database.rules.json using the root .env service
// account — the Realtime Database counterpart to deploy-firestore-rules.mjs /
// deploy-storage-rules.mjs, no `firebase login` needed. The key never touches
// disk.
//
// RTDB rules do NOT go through the firebaserules API the other two use. They
// are set by PUT-ing the rules JSON to the instance's `/.settings/rules.json`;
// the firebase-admin access token already carries the firebase.database scope.
// The instance URL comes from NEXT_PUBLIC_FIREBASE_DATABASE_URL (the same var
// the app uses) or FIREBASE_DATABASE_URL, falling back to the default
// `{projectId}-default-rtdb.firebaseio.com` instance.
//
//   node tools/scripts/deploy-database-rules.mjs
// (self-loads the service account from the repo's local .env files; already-set
// process.env still wins, so `source .env` first is optional.)

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { assertCleanDeploySource } from './lib/clean-deploy-source.mjs'
import {
  databaseRulesRequest,
  getServiceAccountToken,
  loadLocalEnv,
  readServiceAccount,
  resolveDatabaseUrl,
} from './lib/firebase-rules-api.mjs'

// Env loading, auth, and the RTDB `/.settings/rules.json` access (including
// the header-vs-query-param token fallback) are shared with the drift
// checker (check-rules-drift.mjs) via lib/firebase-rules-api.mjs — the
// reader must never diverge from the writer it verifies (AGL-1509).
loadLocalEnv()

// Dirty-tree refusal (AGL-1489): the deploy ships the worktree copy
// wholesale, so uncommitted edits — possibly another session's — would go
// live silently. `--allow-dirty` is the typed escape hatch.
const rulesJsonPath = fileURLToPath(
  new URL('../../cloud/firebase-database.rules.json', import.meta.url),
)
try {
  const verdict = assertCleanDeploySource(rulesJsonPath, {
    allowDirty: process.argv.includes('--allow-dirty'),
    fileLabel: 'cloud/firebase-database.rules.json',
  })
  if (verdict.warning) console.warn(verdict.warning)
} catch (error) {
  console.error(error.message)
  process.exit(1)
}

const serviceAccount = readServiceAccount()
if (!serviceAccount) {
  console.error('Missing FIREBASE_* service-account env vars (source .env).')
  process.exit(1)
}
const { projectId } = serviceAccount
const databaseUrl = resolveDatabaseUrl(projectId)

const content = readFileSync(rulesJsonPath, 'utf8')
// RTDB rules are JSON — parse locally so a malformed file fails fast with a
// clear error instead of a generic 400 from the API.
try {
  JSON.parse(content)
} catch (error) {
  console.error('firebase-database.rules.json is not valid JSON:', error.message)
  process.exit(1)
}

const token = await getServiceAccountToken(serviceAccount)

// Overwrite the live ruleset for the instance. A successful PUT echoes the
// stored rules; a failure returns an `error` field with a non-2xx status.
// databaseRulesRequest handles the header-vs-query-param token fallback.
const response = await databaseRulesRequest(databaseUrl, token, {
  method: 'PUT',
  body: content,
})
if (!response.ok) {
  const detail = await response.text()
  console.error(`Rules update failed (HTTP ${response.status}):`, detail)
  process.exit(1)
}
console.log(`Live: RTDB rules deployed to ${databaseUrl}`)
