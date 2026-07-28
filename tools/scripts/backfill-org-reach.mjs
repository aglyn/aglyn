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

// Backfill the `orgWide` mirror on `users/{uid}/orgs/{orgId}` (AGL-1032):
// for every org member, stamp whether their membership reaches the whole org
// or only a list of sites, so the console can route a site collaborator to
// their site without a second read of the member doc.
//
// Dry-run by default (reads + prints the plan). Pass --commit to apply.
// Idempotent: only rows whose stored value differs are written, so a second
// run plans zero. Optional --org <id>.
//
//   node tools/scripts/backfill-org-reach.mjs [--org <id>] [--commit]
//
// Without this, existing collaborators keep the org chrome until something
// else changes their membership: the console reads an ABSENT flag as
// org-wide, deliberately, because a missing field must never lock a real
// member out of their workspace (rows predating the mirror have none).
// That default is what makes this backfill the fix rather than the schema.
//
// Only UPDATES rows that exist. The reverse index is created and deleted with
// the membership; a merge onto a removed member's path would resurrect a
// half-row with no orgName or slug, which the console renders as a nameless
// workspace nobody can open. A member with no row is REPORTED instead — that
// is the AGL-1047 fixture bug (a member doc without the index entry leaves
// the account staring at "Create your first site"), and it wants a human.

import { existsSync, readFileSync } from 'node:fs'
import { cert, getApps, initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'

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
const orgArgIndex = args.indexOf('--org')
const ONLY_ORG = orgArgIndex !== -1 ? args[orgArgIndex + 1] : ''

/**
 * MUST match `isOrgWideMember` in
 * libs/aglyn/src/lib/app-utils/organizations.ts. The legacy clause is the
 * load-bearing half: a membership predating `allHosts` carries neither the
 * flag nor a hostAccess map, and reading that as "scoped, with access to
 * nothing" would hide the console from real members at backfill time.
 */
const isOrgWideMember = (member) => {
  if (!member) return false
  const role = member.role
  if (role === 'owner' || role === 'admin') return true
  if (member.allHosts === true) return true
  return (
    member.allHosts === undefined &&
    !Object.keys(member.hostAccess ?? {}).length
  )
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
    console.error(
      'Missing FIREBASE_CLIENT_EMAIL / FIREBASE_PRIVATE_KEY env vars',
    )
    process.exit(1)
  }
  initializeApp({ credential: cert({ projectId, clientEmail, privateKey }) })
}
const db = getFirestore()

const orgs = ONLY_ORG
  ? [await db.collection('orgs').doc(ONLY_ORG).get()]
  : (await db.collection('orgs').select().get()).docs

console.log(
  `project ${projectId} — ${orgs.length} org(s), ` +
    (COMMIT ? 'COMMITTING' : 'dry run'),
)

let planned = 0
let unchanged = 0
let scoped = 0
const missingRows = []

for (const org of orgs) {
  if (!org.exists) {
    console.error(`unknown org: ${org.id}`)
    continue
  }
  const members = await org.ref.collection('members').get()
  for (const member of members.docs) {
    const orgWide = isOrgWideMember(member.data())
    if (!orgWide) scoped += 1
    const rowRef = db
      .collection('users')
      .doc(member.id)
      .collection('orgs')
      .doc(org.id)
    const row = await rowRef.get()
    if (!row.exists) {
      missingRows.push(`${org.id}/${member.id}`)
      continue
    }
    if (row.get('orgWide') === orgWide) {
      unchanged += 1
      continue
    }
    planned += 1
    console.log(
      `  ${org.id}/${member.id}: ${String(row.get('orgWide'))} → ${orgWide}` +
        (orgWide ? '' : '  (site collaborator)'),
    )
    if (COMMIT) await rowRef.set({ orgWide }, { merge: true })
  }
}

console.log(
  `\n${COMMIT ? 'wrote' : 'would write'} ${planned}; ${unchanged} already ` +
    `correct; ${scoped} scoped membership(s) seen`,
)
if (missingRows.length) {
  console.log(
    `\n${missingRows.length} member(s) have NO users/{uid}/orgs row — they ` +
      'cannot reach the workspace at all, mirror or not:',
  )
  for (const entry of missingRows) console.log(`  ${entry}`)
}
if (!COMMIT && planned) console.log('\nre-run with --commit to apply')
