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

// READ-ONLY production probe for AGL-1061: how much data actually lives
// under the pre-AGL-237 `hosts/{hostId}/…` fallback paths?
//
//   node tools/scripts/count-legacy-host-collections.mjs
//
// AGL-1050 answered this for `datasets` (0, untruncated) off the AGL-1040
// dry run, and that is the ONLY collection it covers. Deleting the host
// branch of the nine `useOrgDataScope` call sites needs the same number for
// every collection those call sites can reach.
//
// Method: an exact `count()` aggregation per host per collection, rather
// than the collection-group scan AGL-1040 used. A collection-group scan
// capped at N docs answers "host docs among the first N", not "host docs" —
// its own `legacyScanTruncated` flag exists to say so. Aggregations have no
// such ceiling, and the whole point of this probe is a number nobody has to
// qualify.
//
// `campaigns` and `actions` are reported separately and are NOT legacy:
// those cards address `hosts/{hostId}/…` unconditionally today, so they are
// host-native storage rather than a fallback anyone is about to delete.
// Counting them alongside the others would argue against a change they have
// nothing to do with.

import { readFileSync } from 'node:fs'
import { cert, getApps, initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'

if (process.env.FIRESTORE_EMULATOR_HOST) {
  console.error(
    'Refusing to run against the emulator: this probe exists to answer a ' +
      'question about PRODUCTION data, and an emulator answer would be a ' +
      'confident zero that means nothing.',
  )
  process.exit(1)
}

/** Collections the org/host fallback can address (the AGL-1061 question). */
const FALLBACK_COLLECTIONS = [
  'datasets',
  'lists',
  'contacts',
  'contactSegments',
]

/** Host-native today — context, not candidates. */
const HOST_NATIVE_COLLECTIONS = ['campaigns', 'actions']

function loadEnv() {
  // The repo's root .env carries the service account these scripts use.
  try {
    for (const line of readFileSync('.env', 'utf8').split('\n')) {
      const match = /^([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line.trim())
      if (!match) continue
      const [, key, rawValue] = match
      if (process.env[key]) continue
      process.env[key] = rawValue.replace(/^["']|["']$/g, '')
    }
  } catch {
    // Env may already be exported; the credential check below is the gate.
  }
}

loadEnv()

const projectId = process.env.FIREBASE_PROJECT_ID
const clientEmail = process.env.FIREBASE_CLIENT_EMAIL
const privateKey = (process.env.FIREBASE_PRIVATE_KEY ?? '').replace(
  /\\n/g,
  '\n',
)
if (!projectId || !clientEmail || !privateKey) {
  console.error(
    'Missing FIREBASE_PROJECT_ID / FIREBASE_CLIENT_EMAIL / ' +
      'FIREBASE_PRIVATE_KEY — cannot reach production.',
  )
  process.exit(1)
}

if (!getApps().length) {
  initializeApp({ credential: cert({ projectId, clientEmail, privateKey }) })
}
const db = getFirestore(process.env.FIRESTORE_DATABASE_ID)

const countOf = async (ref) => (await ref.count().get()).data().count

const hosts = await db.collection('hosts').select().get()
console.log(`project ${projectId} — ${hosts.docs.length} hosts\n`)

const totals = Object.fromEntries(
  [...FALLBACK_COLLECTIONS, ...HOST_NATIVE_COLLECTIONS].map((name) => [
    name,
    0,
  ]),
)
/** host id → { collection: count } for anything non-zero. */
const offenders = {}

for (const host of hosts.docs) {
  for (const name of [...FALLBACK_COLLECTIONS, ...HOST_NATIVE_COLLECTIONS]) {
    const count = await countOf(host.ref.collection(name))
    if (!count) continue
    totals[name] += count
    offenders[host.id] = { ...(offenders[host.id] ?? {}), [name]: count }
  }
}

console.log('FALLBACK collections (the AGL-1061 question):')
for (const name of FALLBACK_COLLECTIONS) {
  console.log(`  hosts/*/${name.padEnd(16)} ${totals[name]}`)
}
console.log('\nHOST-NATIVE collections (context, not candidates):')
for (const name of HOST_NATIVE_COLLECTIONS) {
  console.log(`  hosts/*/${name.padEnd(16)} ${totals[name]}`)
}

const legacyTotal = FALLBACK_COLLECTIONS.reduce(
  (sum, name) => sum + totals[name],
  0,
)
console.log(
  `\nlegacy total: ${legacyTotal}` +
    (legacyTotal
      ? '  → the branch is a MIGRATION, not dead code. Hosts holding it:'
      : '  → nothing in production reads or writes these paths.'),
)
if (legacyTotal) {
  for (const [hostId, counts] of Object.entries(offenders)) {
    const legacy = Object.entries(counts).filter(([name]) =>
      FALLBACK_COLLECTIONS.includes(name),
    )
    if (legacy.length) console.log(`  ${hostId}: ${JSON.stringify(counts)}`)
  }
}

process.exit(0)
