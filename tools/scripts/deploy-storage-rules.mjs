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

// Deploys cloud/firebase-storage.rules using the root .env service account
// via the Firebase Rules REST API — the storage counterpart to
// deploy-firestore-rules.mjs (same createRuleset + release-update the CLI
// performs, no `firebase login` needed). The key never touches disk.
//
// Unlike Firestore's fixed `cloud.firestore` release, a storage release is
// scoped to a bucket: `firebase.storage/{bucket}`. The bucket is read from
// NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET (the same var the app routes use), or
// FIREBASE_STORAGE_BUCKET, falling back to `{projectId}.appspot.com`.
//
//   node tools/scripts/deploy-storage-rules.mjs
// (self-loads the service account from the repo's local .env files; already-set
// process.env still wins, so `source .env` first is optional.)

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { assertCleanDeploySource } from './lib/clean-deploy-source.mjs'
import {
  authHeaders,
  getServiceAccountToken,
  loadLocalEnv,
  readServiceAccount,
  resolveStorageBucket,
  rulesApiBase,
} from './lib/firebase-rules-api.mjs'

// Env loading, auth, and REST access are shared with the other deploy
// scripts AND the drift checker (check-rules-drift.mjs) via
// lib/firebase-rules-api.mjs — the reader must never diverge from the
// writer it verifies (AGL-1509).
loadLocalEnv()

// Dirty-tree refusal (AGL-1489): the deploy ships the worktree copy
// wholesale, so uncommitted edits — possibly another session's — would go
// live silently. `--allow-dirty` is the typed escape hatch.
const rulesPath = fileURLToPath(
  new URL('../../cloud/firebase-storage.rules', import.meta.url),
)
try {
  const verdict = assertCleanDeploySource(rulesPath, {
    allowDirty: process.argv.includes('--allow-dirty'),
    fileLabel: 'cloud/firebase-storage.rules',
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
const bucket = resolveStorageBucket(projectId)

const token = await getServiceAccountToken(serviceAccount)
const headers = authHeaders(token)
const project = `projects/${projectId}`
const content = readFileSync(rulesPath, 'utf8')

// 1) Create the ruleset — the API compiles it and rejects on errors.
const created = await (
  await fetch(`${rulesApiBase()}/v1/${project}/rulesets`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      source: { files: [{ name: 'firebase-storage.rules', content }] },
    }),
  })
).json()
if (!created.name) {
  console.error('Ruleset create failed:', JSON.stringify(created, null, 2))
  process.exit(1)
}
console.log('Ruleset created:', created.name)

// 2) Point the bucket's storage release at it. The release resource pattern
// is `projects/*/releases/**`, so the slash in the id needs no encoding.
const releaseName = `${project}/releases/firebase.storage/${bucket}`
const updated = await (
  await fetch(`${rulesApiBase()}/v1/${releaseName}`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({
      release: { name: releaseName, rulesetName: created.name },
    }),
  })
).json()
if (updated.error) {
  console.error('Release update failed:', JSON.stringify(updated.error))
  process.exit(1)
}
console.log(
  `Live: ${updated.rulesetName ?? created.name} at ${updated.updateTime}`,
)
