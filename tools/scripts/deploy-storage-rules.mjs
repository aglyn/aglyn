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
//   set -a && source .env && set +a && \
//     node tools/scripts/deploy-storage-rules.mjs

import { readFileSync } from 'node:fs'
import { cert, initializeApp } from 'firebase-admin/app'

const projectId = process.env.FIREBASE_PROJECT_ID
const clientEmail = process.env.FIREBASE_CLIENT_EMAIL
const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n')
if (!projectId || !clientEmail || !privateKey) {
  console.error('Missing FIREBASE_* service-account env vars (source .env).')
  process.exit(1)
}
const bucket =
  process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET ||
  process.env.FIREBASE_STORAGE_BUCKET ||
  `${projectId}.appspot.com`

const app = initializeApp({
  credential: cert({ projectId, clientEmail, privateKey }),
})
const token = (await app.options.credential.getAccessToken()).access_token
const headers = {
  Authorization: `Bearer ${token}`,
  'Content-Type': 'application/json',
}
const project = `projects/${projectId}`
const content = readFileSync(
  new URL('../../cloud/firebase-storage.rules', import.meta.url),
  'utf8',
)

// 1) Create the ruleset — the API compiles it and rejects on errors.
const created = await (
  await fetch(`https://firebaserules.googleapis.com/v1/${project}/rulesets`, {
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
  await fetch(`https://firebaserules.googleapis.com/v1/${releaseName}`, {
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
