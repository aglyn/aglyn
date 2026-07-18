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
//   set -a && source .env && set +a && \
//     node tools/scripts/deploy-database-rules.mjs

import { readFileSync } from 'node:fs'
import { cert, initializeApp } from 'firebase-admin/app'

const projectId = process.env.FIREBASE_PROJECT_ID
const clientEmail = process.env.FIREBASE_CLIENT_EMAIL
const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n')
if (!projectId || !clientEmail || !privateKey) {
  console.error('Missing FIREBASE_* service-account env vars (source .env).')
  process.exit(1)
}
const databaseUrl = (
  process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL ||
  process.env.FIREBASE_DATABASE_URL ||
  `https://${projectId}-default-rtdb.firebaseio.com`
).replace(/\/+$/, '')

const content = readFileSync(
  new URL('../../cloud/firebase-database.rules.json', import.meta.url),
  'utf8',
)
// RTDB rules are JSON — parse locally so a malformed file fails fast with a
// clear error instead of a generic 400 from the API.
try {
  JSON.parse(content)
} catch (error) {
  console.error('firebase-database.rules.json is not valid JSON:', error.message)
  process.exit(1)
}

const app = initializeApp({
  credential: cert({ projectId, clientEmail, privateKey }),
})
const token = (await app.options.credential.getAccessToken()).access_token

// Overwrite the live ruleset for the instance. A successful PUT echoes the
// stored rules; a failure returns an `error` field with a non-2xx status.
// The RTDB REST endpoint accepts the OAuth token either as an Authorization
// header or the `?access_token=` query param depending on the instance/region
// — try the header first, fall back to the query param on an auth rejection.
async function putRules(viaQueryParam) {
  const url = viaQueryParam
    ? `${databaseUrl}/.settings/rules.json?access_token=${encodeURIComponent(token)}`
    : `${databaseUrl}/.settings/rules.json`
  return fetch(url, {
    method: 'PUT',
    headers: viaQueryParam
      ? { 'Content-Type': 'application/json' }
      : { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: content,
  })
}

let response = await putRules(false)
if (response.status === 401 || response.status === 403) {
  response = await putRules(true)
}
if (!response.ok) {
  const detail = await response.text()
  console.error(`Rules update failed (HTTP ${response.status}):`, detail)
  process.exit(1)
}
console.log(`Live: RTDB rules deployed to ${databaseUrl}`)
