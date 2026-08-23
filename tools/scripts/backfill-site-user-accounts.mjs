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

// AGL-2486 — grandfather the sites that are ALREADY using member accounts
// into the new per-site User Accounts opt-in (`hosts/{id}.enabledPlugins`).
//
// WHY THIS SCRIPT EXISTS. The capability is off by default, and "by default"
// has to include sites that already exist — the per-host field is absent on
// every host document on the platform, so without this run, the day the gate
// ships is the day every live members-only site loses `/signin`. Breaking a
// working members site is much worse than leaving a stray route on a
// marketing site, so the deploy order is: run this (with --commit), THEN
// promote.
//
// WHAT COUNTS AS "ALREADY USING IT". Three signals, any one of which is
// enough. Each is evidence a HUMAN set this up, which is the thing an absent
// field cannot distinguish from never having thought about it:
//
//   1. `hosts/{id}/siteMembers` is non-empty — somebody actually has an
//      account on this site. The strongest signal, and the one the issue
//      names.
//   2. `host.authScreens` designates any of the three slots — an admin went
//      to Setup and pointed a designed screen at /signin, /signup or
//      /recover. They cannot have done that by accident.
//   3. Any screen has `visibility` AUTHENTICATED or AUTHORIZED — the site
//      gates content on membership. Such a page's denial prompt sends people
//      to /signin, so leaving the routes closed would strand it even with no
//      member registered YET. This is the signal that catches a site
//      configured but not yet launched, and it is why "no siteMembers" alone
//      is not treated as "not using it".
//
// A host matching NONE of the three keeps member pages off — that is the
// whole point, and it is the case `aglyn-marketing` is in.
//
// It never deletes anything and never turns the capability OFF: the switch
// controls exposure, not data, so a host already carrying an opt-in (or any
// other value in `enabledPlugins`) is unioned with, never replaced.
//
// Dry-run by default (reads + prints the plan, writes nothing). Pass --commit
// to apply. Idempotent: a host already opted in is skipped, so re-running
// converges. Optional --host <id> limits to one site.
//
//   FIREBASE_PROJECT_ID=… FIREBASE_CLIENT_EMAIL=… FIREBASE_PRIVATE_KEY=… \
//     node tools/scripts/backfill-site-user-accounts.mjs [--host <id>] [--commit]

import { existsSync, readFileSync } from 'node:fs'
import { cert, getApps, initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'

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
const flag = (name) => args.includes(name)
const opt = (name, fallback) => {
  const i = args.indexOf(name)
  return i !== -1 ? args[i + 1] : fallback
}

const COMMIT = flag('--commit')
const ONLY_HOST = opt('--host', '')

// MUST match `ACCOUNTS_PLUGIN_ID` in
// `libs/aglyn/src/lib/plugin-manager/enabled-plugins.ts`.
const ACCOUNTS_PLUGIN_ID = 'accounts'
// MUST match `HostScreenVisibility` in
// `libs/aglyn/src/lib/foundation/definitions/platform.types.ts`.
// PRIVATE(8) | 1<<5 = 40, and AUTHORIZED = 40 | 1<<6 = 104.
const VISIBILITY_AUTHENTICATED = 40
const VISIBILITY_AUTHORIZED = 104
// MUST match the `authScreens` slots read by the tenant loader.
const AUTH_SCREEN_SLOTS = [
  'signinScreenId',
  'signupScreenId',
  'recoveryScreenId',
]

// ── Admin init ──────────────────────────────────────────────────────────────
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
const firestore = getFirestore(process.env.FIRESTORE_DATABASE_ID)

console.log(
  `\nBackfill per-site User Accounts opt-in (AGL-2486) — ` +
    `project=${projectId} ` +
    `${ONLY_HOST ? `host=${ONLY_HOST} ` : ''}` +
    `mode=${COMMIT ? 'COMMIT' : 'dry-run'}\n`,
)

let batch = firestore.batch()
let buffered = 0
const optIn = async (ref, next) => {
  if (!COMMIT) return
  batch.update(ref, { enabledPlugins: next })
  if ((buffered += 1) >= 400) {
    // Swap in the fresh batch BEFORE awaiting the full one, so `batch` never
    // points at an in-flight commit (require-atomic-updates, AGL-1815).
    const full = batch
    batch = firestore.batch()
    buffered = 0
    await full.commit()
  }
}

let hostsScanned = 0
const optedIn = []
const alreadyOptedIn = []
const leftClosed = []

const hostsQuery = ONLY_HOST
  ? firestore.collection('hosts').where('__name__', '==', ONLY_HOST)
  : firestore.collection('hosts')
const hostSnap = await hostsQuery.get()

for (const hostDoc of hostSnap.docs) {
  hostsScanned += 1
  const hostId = hostDoc.id
  const host = hostDoc.data() ?? {}
  const label = host.subdomain || host.cname || hostId

  const existing = Array.isArray(host.enabledPlugins)
    ? host.enabledPlugins.map(String)
    : []
  if (existing.includes(ACCOUNTS_PLUGIN_ID)) {
    alreadyOptedIn.push(label)
    continue
  }

  // `limit(1)` on the member collection: this asks "does anybody have an
  // account here", not "how many" — a count would read every document on a
  // site with thousands of members for an answer that never changes.
  const [memberSnap, screenSnap] = await Promise.all([
    hostDoc.ref.collection('siteMembers').limit(1).get(),
    hostDoc.ref.collection('screens').select('visibility', 'deletedAt').get(),
  ])

  const reasons = []
  if (!memberSnap.empty) reasons.push('has site members')

  const designated = AUTH_SCREEN_SLOTS.filter((slot) => {
    const value = host.authScreens?.[slot]
    return typeof value === 'string' && value.trim()
  })
  if (designated.length) {
    reasons.push(`designates ${designated.join(', ')}`)
  }

  const gated = screenSnap.docs.filter((doc) => {
    const data = doc.data() ?? {}
    if (data.deletedAt != null) return false
    return (
      data.visibility === VISIBILITY_AUTHENTICATED ||
      data.visibility === VISIBILITY_AUTHORIZED
    )
  })
  if (gated.length) reasons.push(`${gated.length} members-only screen(s)`)

  if (!reasons.length) {
    leftClosed.push(label)
    continue
  }

  // Union, never replace: another default-off capability could already be
  // listed here, and this backfill has no business removing it.
  const next = Array.from(new Set([...existing, ACCOUNTS_PLUGIN_ID]))
  optedIn.push({ label, hostId, reasons })
  await optIn(hostDoc.ref, next)
}

if (COMMIT && buffered) await batch.commit()

console.log(`Hosts scanned:            ${hostsScanned}`)
console.log(`Already opted in:         ${alreadyOptedIn.length}`)
console.log(`Opted in by this run:     ${optedIn.length}`)
console.log(`Left closed (no signal):  ${leftClosed.length}\n`)

if (optedIn.length) {
  console.log('Grandfathered into User Accounts:')
  for (const row of optedIn) {
    console.log(`  ${row.label} (${row.hostId}) — ${row.reasons.join('; ')}`)
  }
  console.log('')
}

if (leftClosed.length) {
  console.log(
    'Left closed — these serve no /signin, /signup or /recover after this ' +
      'ships. Read the list before committing: a name you recognise as a ' +
      'members site here means a signal is missing, not that the site is ' +
      'idle.',
  )
  for (const label of leftClosed) console.log(`  ${label}`)
  console.log('')
}

if (!COMMIT) {
  console.log('Dry run — nothing written. Re-run with --commit to apply.\n')
}

process.exit(0)
