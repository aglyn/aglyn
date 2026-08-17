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

// AGL-1400 — stamp `kind: 'template'` on the screens that are already treated
// as collection ENTRY templates, so "is a template" becomes a property of the
// screen instead of a derivation from a pointer on another document.
//
// WHAT IT STAMPS is exactly the set `billableScreenIds` excludes today: a
// screen some collection designates through `entryScreenId`, the legacy
// `templateScreenId`, or a `listScreenId` on a collection with no list route of
// its own (catalog-kind or slugless — where AGL-1387's condition stops). A LIST
// template on a slugged content collection is deliberately NOT stamped: it is
// reachable at `/{collectionSlug}`, AGL-1387 made it count, and stamping it
// would both un-bill it and stop `/{slug}` serving it.
//
// So the count after this run equals the count before it, host for host. That
// is the property to check: the backfill moves WHERE the fact lives, not what
// anybody pays. Commerce's `pdpScreenId`/`collectionScreenId` (AGL-1270) are
// left alone for the same reason — they are billable today and re-pricing them
// is a separate decision.
//
// Dry-run by default (reads + prints the plan, writes nothing). Pass --commit
// to apply. Idempotent: a screen already carrying `kind: 'template'` is
// skipped, so re-running converges. Optional --host <id> limits to one site.
//
//   FIREBASE_PROJECT_ID=… FIREBASE_CLIENT_EMAIL=… FIREBASE_PRIVATE_KEY=… \
//     node tools/scripts/backfill-template-screen-kind.mjs [--host <id>] [--commit]

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

// MUST match `libs/aglyn/src/lib/app-utils/screen-route.ts`.
const SCREEN_KIND_TEMPLATE = 'template'
const SCREEN_KIND_EMAIL = 'email'
// MUST match `apps/console/constants/collection-templates.ts`.
const POINTER_FIELDS = ['listScreenId', 'entryScreenId', 'templateScreenId']

const screenIdOf = (value) =>
  typeof value === 'string' && value.trim() ? value.trim() : undefined

// ── Admin init (same pattern as backfill-name-lower.mjs) ────────────────────
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
  `\nBackfill screen kind:'template' (AGL-1400) — project=${projectId} ` +
    `${ONLY_HOST ? `host=${ONLY_HOST} ` : ''}` +
    `mode=${COMMIT ? 'COMMIT' : 'dry-run'}\n`,
)

let batch = firestore.batch()
let buffered = 0
let written = 0
const stamp = async (ref) => {
  written += 1
  if (!COMMIT) return
  batch.update(ref, { kind: SCREEN_KIND_TEMPLATE })
  if ((buffered += 1) >= 400) {
    // Swap in the fresh batch BEFORE awaiting the full one: `batch` never
    // points at an in-flight commit, which is also what satisfies
    // require-atomic-updates (AGL-1815).
    const full = batch
    batch = firestore.batch()
    buffered = 0
    await full.commit()
  }
}

let hostsScanned = 0
let hostsChanged = 0
let screensScanned = 0
const skipped = []
const listTemplatesLeftAlone = []
const storeTemplatesLeftAlone = []

const hostsQuery = ONLY_HOST
  ? firestore.collection('hosts').where('__name__', '==', ONLY_HOST)
  : firestore.collection('hosts')
const hostSnap = await hostsQuery.get()

for (const hostDoc of hostSnap.docs) {
  hostsScanned += 1
  const hostId = hostDoc.id

  const [collectionSnap, screenSnap, storeSnap] = await Promise.all([
    hostDoc.ref
      .collection('collections')
      .select('slug', 'kind', ...POINTER_FIELDS)
      .get(),
    hostDoc.ref.collection('screens').select('kind', 'deletedAt', 'displayName').get(),
    hostDoc.ref.collection('settings').doc('store').get(),
  ])

  // Which pointer designated each screen, for the plan the operator reads.
  const designatedBy = new Map()
  const listRouteScreenIds = new Set()
  for (const row of collectionSnap.docs) {
    const data = row.data()
    for (const field of POINTER_FIELDS) {
      const screenId = screenIdOf(data[field])
      if (!screenId) continue
      const existing = designatedBy.get(screenId) ?? []
      existing.push(`${row.id}.${field}`)
      designatedBy.set(screenId, existing)
    }
    // AGL-1387: only a slugged CONTENT collection has a `/{slug}` list route.
    const slug = typeof data.slug === 'string' ? data.slug : ''
    const listScreenId = screenIdOf(data.listScreenId)
    if (slug && data.kind !== 'catalog' && listScreenId) {
      listRouteScreenIds.add(listScreenId)
    }
  }
  for (const field of ['pdpScreenId', 'collectionScreenId']) {
    const screenId = screenIdOf(storeSnap.get(field))
    if (screenId) storeTemplatesLeftAlone.push(`${hostId}/${screenId} (${field})`)
  }

  let changedHere = 0
  for (const screenDoc of screenSnap.docs) {
    screensScanned += 1
    const pointers = designatedBy.get(screenDoc.id)
    if (!pointers) continue
    const kind = screenDoc.get('kind')
    const name = String(screenDoc.get('displayName') ?? screenDoc.id)
    const claimsToBeAPage =
      screenDoc.get('deletedAt') == null && kind !== SCREEN_KIND_EMAIL
    if (listRouteScreenIds.has(screenDoc.id) && claimsToBeAPage) {
      // A page today, billable today, and `/{slug}` serves it. Untouched.
      listTemplatesLeftAlone.push(
        `${hostId}/${screenDoc.id} “${name}” (${pointers.join(', ')})`,
      )
      continue
    }
    if (kind === SCREEN_KIND_TEMPLATE) continue // already converged
    if (kind === SCREEN_KIND_EMAIL || screenDoc.get('deletedAt') != null) {
      // Neither is a page and neither is billable, with or without this stamp.
      // Overwriting `kind` on an email document would move it off the Emails
      // page, and a soft-deleted screen is already gone — left for a human.
      skipped.push(
        `${hostId}/${screenDoc.id} “${name}” — kind=${kind ?? '(none)'}` +
          `${screenDoc.get('deletedAt') != null ? ' deletedAt set' : ''}` +
          ` (${pointers.join(', ')})`,
      )
      continue
    }
    changedHere += 1
    console.log(
      `  ${hostId}/${screenDoc.id} “${name}” kind=${kind ?? '(none)'} → ` +
        `'${SCREEN_KIND_TEMPLATE}'  [${pointers.join(', ')}]`,
    )
    await stamp(screenDoc.ref)
  }
  if (changedHere) hostsChanged += 1
}

if (COMMIT && buffered > 0) await batch.commit()

console.log(`\nhosts:   scanned=${hostsScanned} changed=${hostsChanged}`)
console.log(`screens: scanned=${screensScanned} stamped=${written}`)
if (listTemplatesLeftAlone.length) {
  console.log(`\nLIST templates left as pages (AGL-1387 — they serve /{slug}):`)
  for (const line of listTemplatesLeftAlone) console.log(`  ${line}`)
}
if (storeTemplatesLeftAlone.length) {
  console.log(`\nStore templates left alone (AGL-1270 — billable today):`)
  for (const line of storeTemplatesLeftAlone) console.log(`  ${line}`)
}
if (skipped.length) {
  console.log(`\nSkipped (email / soft-deleted, already excluded):`)
  for (const line of skipped) console.log(`  ${line}`)
}
console.log(
  `\n${COMMIT ? `Committed ${written} update(s).` : `Dry-run — ${written} update(s) planned. Re-run with --commit to apply.`}\n`,
)
process.exit(0)
