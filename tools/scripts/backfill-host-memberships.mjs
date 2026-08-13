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

// Backfill the per-user host membership projection (AGL-844/856): for every
// host, mirror its `memberRoles` map into `users/{uid}/hostMemberships/{hostId}`
// with the host name denormalized, so existing users' switcher/routing can
// query their sites before any membership change re-fans them.
//
// Dry-run by default (reads + prints the plan). Pass --commit to apply.
// Idempotent: a set/merge that re-runs to the same value. Optional --host <id>.
//
//   FIREBASE_PROJECT_ID=… FIREBASE_CLIENT_EMAIL=… FIREBASE_PRIVATE_KEY=… \
//     node tools/scripts/backfill-host-memberships.mjs [--host <id>] [--commit]

import { existsSync, readFileSync } from 'node:fs'
import { cert, getApps, initializeApp } from 'firebase-admin/app'
import { FieldValue, getFirestore } from 'firebase-admin/firestore'

function loadLocalEnv() {
  const roots = ['.', 'apps/console', 'cloud']
  const names = [
    '.env',
    '.env.local',
    '.env.development',
    '.env.development.local',
    '.env.production',
    '.env.production.local',
  ]
  for (const file of roots.flatMap((r) => names.map((n) => `${r}/${n}`))) {
    if (!existsSync(file)) continue
    let text
    try {
      text = readFileSync(file, 'utf8')
    } catch {
      continue
    }
    for (const line of text.split('\n')) {
      const match = line.match(/^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*)$/)
      if (!match) continue
      const key = match[1]
      if (process.env[key] !== undefined) continue
      let value = match[2].trim()
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1)
      }
      process.env[key] = value
    }
  }
}
loadLocalEnv()

const args = process.argv.slice(2)
const COMMIT = args.includes('--commit')
const hostArgIndex = args.indexOf('--host')
const ONLY_HOST = hostArgIndex !== -1 ? args[hostArgIndex + 1] : ''

// MUST match nameSearchKey in libs/aglyn/src/lib/app-utils/name-search.ts.
const nameSearchKey = (name) =>
  (name ?? '').trim().replace(/\s+/g, ' ').toLowerCase()

const projectId = process.env.FIREBASE_PROJECT_ID
if (!projectId) {
  console.error('Missing FIREBASE_PROJECT_ID env var')
  process.exit(1)
}
if (!getApps().length) {
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n')
  if (!clientEmail || !privateKey) {
    console.error('Missing FIREBASE_CLIENT_EMAIL / FIREBASE_PRIVATE_KEY env vars')
    process.exit(1)
  }
  initializeApp({ credential: cert({ projectId, clientEmail, privateKey }) })
}
const firestore = getFirestore(process.env.FIRESTORE_DATABASE_ID)

console.log(
  `\nBackfill hostMemberships — project=${projectId} ` +
    `${ONLY_HOST ? `host=${ONLY_HOST} ` : ''}mode=${COMMIT ? 'COMMIT' : 'dry-run'}\n`,
)

const CHUNK = 400
let batch = firestore.batch()
let buffered = 0
let written = 0
const stamp = async (ref, value) => {
  written += 1
  if (!COMMIT) return
  batch.set(ref, value, { merge: true })
  if ((buffered += 1) >= CHUNK) {
    await batch.commit()
    batch = firestore.batch()
    buffered = 0
  }
}

const hostSnap = ONLY_HOST
  ? await firestore.collection('hosts').where('__name__', '==', ONLY_HOST).get()
  : await firestore.collection('hosts').get()

let hostsScanned = 0
let rows = 0
for (const hostDoc of hostSnap.docs) {
  hostsScanned += 1
  const host = hostDoc.data()
  const orgId = host.orgId
  const memberRoles = host.memberRoles ?? {}
  const displayName = typeof host.displayName === 'string' ? host.displayName : ''
  const subdomain = host.subdomain
  for (const [uid, role] of Object.entries(memberRoles)) {
    if (!role) continue
    rows += 1
    await stamp(
      firestore
        .collection('users')
        .doc(uid)
        .collection('hostMemberships')
        .doc(hostDoc.id),
      {
        ...(orgId ? { orgId } : {}),
        ...(subdomain ? { subdomain } : {}),
        displayName,
        nameLower: nameSearchKey(displayName),
        role,
        updatedAt: FieldValue.serverTimestamp(),
      },
    )
  }
}
if (COMMIT && buffered > 0) await batch.commit()

console.log(`hosts scanned=${hostsScanned}  projection rows=${rows}`)
console.log(
  `\n${COMMIT ? `Committed ${written} row(s).` : `Dry-run — ${written} row(s) planned. Re-run with --commit to apply.`}\n`,
)
process.exit(0)
