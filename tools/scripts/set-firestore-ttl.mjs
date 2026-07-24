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

// Configures Firestore TTL policies from the root .env service account via the
// Firestore Admin API — the same thing the Cloud console's Time-to-live tab
// does, without needing console access or `gcloud`.
//
// TTL is NOT in the Firebase console (AGL-794): it is a Firestore/Cloud
// feature, exposed under console.cloud.google.com → Firestore → Time-to-live,
// `gcloud firestore fields ttls update`, or this script. Looking for it in the
// Firebase console is a dead end.
//
//   set -a && source .env && set +a && \
//     node tools/scripts/set-firestore-ttl.mjs
//
//   # check without changing anything
//   ... node tools/scripts/set-firestore-ttl.mjs --dry-run
//
// Firestore deletes documents *after* the `expiresAt` instant, typically
// within 24h — it is a cleanup mechanism, not a correctness boundary. Nothing
// here depends on prompt deletion; the rate limiter keys each bucket by window
// start, so a stale document is simply never read again.

import { cert, initializeApp } from 'firebase-admin/app'

/** Collections whose documents expire, and the timestamp field to expire on. */
const TTL_POLICIES = [
  // AGL-794 — one document per (hashed key, window). Without a policy these
  // accumulate at roughly one per caller per minute, forever.
  { collection: 'rateLimits', field: 'expiresAt' },
]

const dryRun = process.argv.includes('--dry-run')

const projectId = process.env.FIREBASE_PROJECT_ID
const clientEmail = process.env.FIREBASE_CLIENT_EMAIL
const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n')
if (!projectId || !clientEmail || !privateKey) {
  console.error('Missing FIREBASE_* service-account env vars (source .env).')
  process.exit(1)
}

const app = initializeApp({
  credential: cert({ projectId, clientEmail, privateKey }),
})
const token = (await app.options.credential.getAccessToken()).access_token
const headers = {
  Authorization: `Bearer ${token}`,
  'Content-Type': 'application/json',
}

const base = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/collectionGroups`

let failed = false
for (const { collection, field } of TTL_POLICIES) {
  const name = `${base}/${collection}/fields/${field}`
  const label = `${collection}.${field}`

  const current = await (await fetch(name, { headers })).json()
  if (current.error) {
    console.error(`✗ ${label}: read failed —`, current.error.message)
    failed = true
    continue
  }
  // `state: ACTIVE` (or CREATING) means a policy already exists.
  const state = current.ttlConfig?.state
  if (state && state !== 'NEEDS_REPAIR') {
    console.log(`✓ ${label}: already configured (${state})`)
    continue
  }
  if (dryRun) {
    console.log(`… ${label}: WOULD enable TTL (currently none)`)
    continue
  }

  // An empty ttlConfig object is the enable signal; updateMask scopes the
  // patch so no other field configuration is touched.
  const response = await fetch(`${name}?updateMask=ttlConfig`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ ttlConfig: {} }),
  })
  const result = await response.json()
  if (!response.ok || result.error) {
    console.error(
      `✗ ${label}: enable failed —`,
      result.error?.message ?? response.status,
    )
    // The service account needs datastore.indexes.update (Cloud Datastore
    // Index Admin / Firestore Owner). A 403 here means permissions, not a
    // wrong field path.
    failed = true
    continue
  }
  // The response is a long-running operation; TTL becomes ACTIVE shortly.
  console.log(`✓ ${label}: TTL enabled (operation ${result.name ?? 'started'})`)
}

if (failed) process.exit(1)
console.log(
  dryRun ? 'Dry run complete.' : 'TTL policies applied. Verify with --dry-run.',
)
