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

// Backfill the personal profile doc `users/{uid}` for accounts created before
// anything seeded it (AGL-1127).
//
// Nothing wrote that doc: sign-up collected a required first/last name and
// dropped it, SSO JIT provisioned the membership only, and `users/{uid}` was
// born the first time someone saved Manage Account → Basic info. Measured on
// production 2026-07-30: 1 of 3 accounts had one.
//
// The name comes from the ORG ROSTER (`orgs/{id}/members/{uid}.displayName`),
// not from Firebase Auth — SSO accounts live in a GCIP tenant pool that
// project-level `getUser`/`listUsers` cannot see at all (AGL-1122), and the
// roster is the one place their display name is readable without per-pool
// logic. It is also what every console surface already shows for them.
//
// The seeding now built into the sign-in path makes this redundant over time:
// the session-cookie mint seeds every account on its next sign-in. This is for
// closing the gap NOW, without waiting for each user to come back.
//
// Dry-run by default (reads + prints the plan, writes nothing). Pass --commit
// to apply. Idempotent and never destructive: only fields that are ABSENT or
// blank are filled, so a name edited in Basic info is never overwritten.
//
//   FIREBASE_PROJECT_ID=… FIREBASE_CLIENT_EMAIL=… FIREBASE_PRIVATE_KEY=… \
//     node tools/scripts/backfill-user-profiles.mjs [--commit]

import { existsSync, readFileSync } from 'node:fs'
import { cert, getApps, initializeApp } from 'firebase-admin/app'
import { FieldValue, getFirestore } from 'firebase-admin/firestore'

// Load admin creds from the repo's local env files so this script is
// self-contained. Already-set process.env wins.
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
  const files = roots.flatMap((r) => names.map((n) => `${r}/${n}`))
  for (const file of files) {
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

// MUST match `splitDisplayName` in
// libs/shared/util/tools/src/lib/split-display-name.ts — the runtime seed and
// this backfill have to land the same split or a user's name changes shape
// depending on which one got there first.
const splitDisplayName = (displayName) => {
  const cleaned = String(displayName ?? '')
    .replace(/\s+/g, ' ')
    .trim()
  if (!cleaned) return { firstName: '', lastName: '' }
  const boundary = cleaned.indexOf(' ')
  if (boundary === -1) return { firstName: cleaned, lastName: '' }
  return {
    firstName: cleaned.slice(0, boundary),
    lastName: cleaned.slice(boundary + 1),
  }
}

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
  `\nBackfill users/{uid} profiles — project=${projectId} ` +
    `mode=${COMMIT ? 'COMMIT' : 'dry-run'}\n`,
)

// Every uid on every org roster, with the best display name any roster row
// carries for them (a member of several orgs may be named in only one).
const rosterNames = new Map()
const orgs = await firestore.collection('orgs').get()
for (const org of orgs.docs) {
  const members = await org.ref.collection('members').get()
  for (const member of members.docs) {
    const name = String(member.get('displayName') ?? '').trim()
    if (name && !rosterNames.get(member.id)) rosterNames.set(member.id, name)
    else if (!rosterNames.has(member.id)) rosterNames.set(member.id, '')
  }
}

const blank = (value) => typeof value !== 'string' || !value.trim()

let scanned = 0
let created = 0
let filled = 0
let skipped = 0

for (const [uid, displayName] of rosterNames) {
  scanned += 1
  const ref = firestore.collection('users').doc(uid)
  const snapshot = await ref.get()
  const { firstName, lastName } = splitDisplayName(displayName)

  const seed = {}
  if (firstName && blank(snapshot.get('firstName'))) seed.firstName = firstName
  if (lastName && blank(snapshot.get('lastName'))) seed.lastName = lastName

  if (snapshot.exists && !Object.keys(seed).length) {
    skipped += 1
    console.log(`  skip    ${uid} — profile already complete`)
    continue
  }
  if (!snapshot.exists) {
    seed.createdAt = FieldValue.serverTimestamp()
    created += 1
  }
  if (Object.keys(seed).some((key) => key !== 'createdAt')) filled += 1

  const fields = Object.keys(seed)
    .filter((key) => key !== 'createdAt')
    .join(', ')
  console.log(
    `  ${snapshot.exists ? 'fill  ' : 'create'}  ${uid} — ` +
      `${fields || 'no name on any roster'}` +
      `${displayName ? ` (from "${displayName}")` : ''}`,
  )
  if (COMMIT) await ref.set(seed, { merge: true })
}

console.log(
  `\nScanned ${scanned} roster uid(s): ${created} doc(s) created, ` +
    `${filled} name(s) filled, ${skipped} already complete.` +
    `${COMMIT ? '' : '\nDry run — nothing was written. Pass --commit to apply.'}\n`,
)
