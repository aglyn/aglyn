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
// HOW IT RUNS, in three phases, because this is a production write and a
// count is not a record:
//
//   1. PLAN  — reads every host, re-evaluates the three signals AT RUN TIME
//              (never from an earlier dry run: a site that gained its first
//              member since then has to be caught), and prints the intended
//              change host by host as `before -> after`. Nothing is written.
//   2. GUARD — refuses the whole run if any host would come out with fewer
//              capabilities than it went in with, or if a planned host would
//              not actually gain the opt-in. Closing a site is a regression,
//              not a grandfathering, and this change's worst outcome is a
//              live members site losing /signin — so it aborts, not warns.
//   3. APPLY + VERIFY — writes, then RE-READS each host and prints what the
//              database now holds. Plan and actual are printed separately on
//              purpose: a write that silently did not land would otherwise be
//              indistinguishable from one that did. Exits non-zero on any
//              mismatch.
//
// Dry-run by default (phases 1 and 2 only). Pass --commit to apply.
// Idempotent: a host already opted in is skipped and never rewritten, so
// re-running converges. Optional --host <id> limits to one site.
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

/*==========================================
 *
 * MARK - PHASE 1: PLAN (reads only)
 *
 * The whole plan is computed and PRINTED before a single write, so the
 * record shows what moved host by host rather than a count. Signals are
 * re-read here, in this invocation — a site that gained its first member
 * since an earlier dry run has to be caught by the run that writes.
 *
 *=========================================*/

let hostsScanned = 0
/** { label, hostId, ref, before, after, reasons } */
const plan = []
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

  const before = Array.isArray(host.enabledPlugins)
    ? host.enabledPlugins.map(String)
    : []
  if (before.includes(ACCOUNTS_PLUGIN_ID)) {
    alreadyOptedIn.push({ label, hostId, before })
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
  if (designated.length) reasons.push(`designates ${designated.join(', ')}`)

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
    leftClosed.push({ label, hostId })
    continue
  }

  // Union, never replace: another default-off capability could already be
  // listed here, and this backfill has no business removing it.
  const after = Array.from(new Set([...before, ACCOUNTS_PLUGIN_ID]))
  plan.push({ label, hostId, ref: hostDoc.ref, before, after, reasons })
}

/*==========================================
 *
 * MARK - PHASE 1b: THE ADDITIVE-ONLY GUARD
 *
 * This run may only ever ADD an opt-in. A host that would come out of it
 * with fewer capabilities than it went in with is not being grandfathered,
 * it is being regressed — and the failure mode of this whole change is a
 * live members site losing /signin, so that must abort rather than warn.
 *
 * Checked against the computed plan rather than trusted from the code
 * above, because the point is to catch a future edit to that code.
 *
 *=========================================*/

const regressions = []
for (const row of plan) {
  const after = new Set(row.after)
  const dropped = row.before.filter((id) => !after.has(id))
  if (dropped.length) {
    regressions.push(`${row.label} (${row.hostId}) would LOSE ${dropped.join(', ')}`)
  }
  if (!after.has(ACCOUNTS_PLUGIN_ID)) {
    regressions.push(
      `${row.label} (${row.hostId}) is planned but would not gain ${ACCOUNTS_PLUGIN_ID}`,
    )
  }
}
// The already-opted-in are not written at all, so nothing can take the
// capability off them. Stated as an assertion so a future edit that starts
// writing them has to satisfy it.
for (const row of alreadyOptedIn) {
  if (plan.some((entry) => entry.hostId === row.hostId)) {
    regressions.push(
      `${row.label} (${row.hostId}) is already opted in and must not be rewritten`,
    )
  }
}

console.log('=== PLAN (nothing written yet) ===\n')
console.log(`Hosts scanned:            ${hostsScanned}`)
console.log(`Already opted in:         ${alreadyOptedIn.length}`)
console.log(`To opt in:                ${plan.length}`)
console.log(`Left closed (no signal):  ${leftClosed.length}\n`)

if (plan.length) {
  console.log('INTENDED CHANGES, host by host:')
  for (const row of plan) {
    console.log(
      `  ${row.label} (${row.hostId})\n` +
        `      enabledPlugins: [${row.before.join(', ')}] -> [${row.after.join(', ')}]\n` +
        `      because: ${row.reasons.join('; ')}`,
    )
  }
  console.log('')
}

if (alreadyOptedIn.length) {
  console.log('Already opted in — NOT rewritten:')
  for (const row of alreadyOptedIn) {
    console.log(`  ${row.label} (${row.hostId}) — [${row.before.join(', ')}]`)
  }
  console.log('')
}

if (leftClosed.length) {
  console.log(
    'Left closed — these serve no /signin, /signup or /recover after this\n' +
      'ships. Read the list before committing: a name you recognise as a\n' +
      'members site here means a signal is missing, not that the site is idle.',
  )
  for (const row of leftClosed) console.log(`  ${row.label} (${row.hostId})`)
  console.log('')
}

if (regressions.length) {
  console.error('REFUSING TO WRITE — this run would close or narrow a host:\n')
  for (const line of regressions) console.error(`  ${line}`)
  console.error(
    '\nThat is a regression, not a grandfathering. Nothing was written.',
  )
  process.exit(1)
}

if (!COMMIT) {
  console.log('Dry run — nothing written. Re-run with --commit to apply.\n')
  process.exit(0)
}

/*==========================================
 *
 * MARK - PHASE 2: APPLY
 *
 *=========================================*/

let batch = firestore.batch()
let buffered = 0
for (const row of plan) {
  batch.update(row.ref, { enabledPlugins: row.after })
  if ((buffered += 1) >= 400) {
    // Swap in the fresh batch BEFORE awaiting the full one, so `batch` never
    // points at an in-flight commit (require-atomic-updates, AGL-1815).
    const full = batch
    batch = firestore.batch()
    buffered = 0
    await full.commit()
  }
}
if (buffered) await batch.commit()

/*==========================================
 *
 * MARK - PHASE 3: VERIFY (re-reads what actually landed)
 *
 * The plan is what we asked for; this is what the database now holds. They
 * are printed separately on purpose — a write that silently did not land
 * would otherwise be indistinguishable from one that did.
 *
 *=========================================*/

console.log('=== ACTUAL, re-read from Firestore ===\n')
const failures = []
for (const row of plan) {
  const fresh = await row.ref.get()
  const stored = Array.isArray(fresh.data()?.enabledPlugins)
    ? fresh.data().enabledPlugins.map(String)
    : []
  const ok = stored.includes(ACCOUNTS_PLUGIN_ID)
  const kept = row.before.every((id) => stored.includes(id))
  if (!ok || !kept) {
    failures.push(
      `${row.label} (${row.hostId}) — stored [${stored.join(', ')}]` +
        `${ok ? '' : `, missing ${ACCOUNTS_PLUGIN_ID}`}` +
        `${kept ? '' : ', DROPPED a pre-existing id'}`,
    )
  }
  console.log(
    `  ${row.label} (${row.hostId}) — enabledPlugins now [${stored.join(', ')}] ${ok && kept ? 'OK' : 'FAILED'}`,
  )
}
console.log('')

if (failures.length) {
  console.error('WRITES DID NOT LAND AS PLANNED:\n')
  for (const line of failures) console.error(`  ${line}`)
  process.exit(1)
}

console.log(`Committed ${plan.length} host(s). Nothing was closed or removed.\n`)
process.exit(0)
