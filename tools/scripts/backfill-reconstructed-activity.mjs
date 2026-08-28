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

// AGL-118 — reconstruct the activity entries that were never written, from the
// artifacts that survive.
//
// Three template surfaces created screens, layouts and components and appended
// nothing to `hosts/{hostId}/activity`, so a site whose pages all came from a
// template reads as a site nobody ever touched. The fix stops the loss; this
// recovers what is recoverable from what is already in Firestore.
//
// ── WHAT AN ARTIFACT PROVES, AND WHAT IT DOES NOT ──────────────────────────
//
// A synthesized audit row is a CLAIM ABOUT A PERSON, so this script asserts
// only what the document in hand actually establishes.
//
//   PROVEN   an artifact with `createdAt` proves that artifact was created,
//            and when.
//   PROVEN   `media.uploadedBy` names WHO uploaded that asset. It is the only
//            author field anywhere in a host's artifacts.
//   NOT      screens, layouts, components, templates and versions carry NO
//            author field of any kind. Nothing in those documents names a
//            person, so nothing in this script attributes them to one — an
//            org's owner is not "probably who did it", they are an inference
//            the artifact does not support, and a false attribution in an
//            audit trail is worse than an absent one.
//   NOT      the edits BETWEEN creation and now. `updatedAt` proves only that
//            a last write happened; it names neither how many there were nor
//            what they changed, so no entry is emitted for it.
//
// Versions are deliberately skipped even though they carry `createdAt`. A
// template-built page writes its screen, its first version and its route as
// ONE act, so emitting a row for the version too would invent a second event
// to make the timeline look fuller. Deletions are also out of scope for this
// pass: `deletedAt` would support them, but the console's soft-delete is
// PAIRED with a routing-map removal that leaves no timestamp, so a delete row
// would record half an act. Both are additive later if wanted.
//
// ── RECONSTRUCTED ROWS ARE MARKED AS SUCH ─────────────────────────────────
//
// Every row carries `reconstructed: true` and `reconstructedFrom`, the path of
// the artifact it was derived from — a FIELD, so a reader can partition the
// log by provenance instead of guessing at phrasing. The action text says so
// too, because the console's activity table renders the action and not the
// field: a marker only a query can see does not help the person reading the
// page. An audit trail that cannot tell you which rows are inferred is worth
// less than one with gaps, because the gaps are at least honest.
//
// ── IDEMPOTENT ────────────────────────────────────────────────────────────
//
// The entry id is derived from the artifact — `recon-<subcollection>-<id>` —
// and written with `set()`, so a second run overwrites the same documents
// rather than adding a second copy. Ordinary entries have Firestore auto-ids
// and can never collide with these.
//
// Dry-run by default (reads + prints the plan, writes nothing). Pass --commit
// to apply. Optional --host <id> limits to one site.
//
//   FIREBASE_PROJECT_ID=… FIREBASE_CLIENT_EMAIL=… FIREBASE_PRIVATE_KEY=… \
//     node tools/scripts/backfill-reconstructed-activity.mjs [--host <id>] [--commit]

import { existsSync, readFileSync } from 'node:fs'
import { cert, getApps, initializeApp } from 'firebase-admin/app'
import { getFirestore, Timestamp } from 'firebase-admin/firestore'

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

/**
 * The artifacts a row can be reconstructed from.
 *
 * `authorField` is the ONLY way an actor is ever set. It is null for every
 * subcollection but media, which is a fact about the data rather than a
 * conservative choice: no other artifact records who made it.
 *
 * `target.type` values match `HostActivityTarget` in
 * `libs/tenant/feature/instance/src/lib/hooks/use-host-activity-logger.ts`, so
 * a reconstructed row filters and deep-links exactly like a live one.
 */
const SOURCES = [
  { sub: 'screens', targetType: 'screen', noun: 'screen', authorField: null },
  { sub: 'layouts', targetType: 'layout', noun: 'layout', authorField: null },
  { sub: 'components', targetType: 'component', noun: 'component', authorField: null },
  { sub: 'templates', targetType: 'template', noun: 'template', authorField: null },
  { sub: 'media', targetType: 'media', noun: 'media asset', authorField: 'uploadedBy' },
]

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
  `\nReconstruct missing activity entries (AGL-118) — project=${projectId} ` +
    `${ONLY_HOST ? `host=${ONLY_HOST} ` : ''}` +
    `mode=${COMMIT ? 'COMMIT' : 'dry-run'}\n`,
)

/** A Firestore Timestamp, or null when the artifact cannot be placed in time. */
const createdAtOf = (data) => {
  const value = data.createdAt
  if (value instanceof Timestamp) return value
  if (value instanceof Date) return Timestamp.fromDate(value)
  if (typeof value === 'number') return Timestamp.fromMillis(value)
  return null
}

const nameOf = (data) =>
  typeof data.displayName === 'string' && data.displayName
    ? data.displayName
    : typeof data.fileName === 'string' && data.fileName
      ? data.fileName
      : undefined

let batch = firestore.batch()
let buffered = 0
const write = async (ref, entry) => {
  if (!COMMIT) return
  batch.set(ref, entry)
  if ((buffered += 1) >= 400) {
    // Swap in the fresh batch BEFORE awaiting the full one, so `batch` never
    // points at an in-flight commit (require-atomic-updates).
    const full = batch
    batch = firestore.batch()
    buffered = 0
    await full.commit()
  }
}

let hostsScanned = 0
const hostsTouched = new Set()
let artifactsScanned = 0
let entriesPlanned = 0
let withActor = 0
let withoutActor = 0
let skippedNoCreatedAt = 0
let alreadyPresent = 0
const perSub = new Map()
const perHost = new Map()
const actorsSeen = new Set()

const hostsQuery = ONLY_HOST
  ? firestore.collection('hosts').where('__name__', '==', ONLY_HOST)
  : firestore.collection('hosts')
const hostSnap = await hostsQuery.get()

for (const hostDoc of hostSnap.docs) {
  hostsScanned += 1
  const hostId = hostDoc.id
  const activityRef = hostDoc.ref.collection('activity')

  for (const source of SOURCES) {
    const snap = await hostDoc.ref.collection(source.sub).get()
    for (const artifact of snap.docs) {
      artifactsScanned += 1
      const data = artifact.data()
      const createdAt = createdAtOf(data)
      if (!createdAt) {
        skippedNoCreatedAt += 1
        continue
      }
      // The artifact names an actor or it does not. Nothing else may supply
      // one — not the host's owner, not the org roster, not the only person
      // with a role on the site.
      const actorId = source.authorField
        ? typeof data[source.authorField] === 'string' && data[source.authorField]
          ? data[source.authorField]
          : null
        : null
      if (actorId) {
        withActor += 1
        actorsSeen.add(actorId)
      } else {
        withoutActor += 1
      }

      const entryId = `recon-${source.sub}-${artifact.id}`
      const ref = activityRef.doc(entryId)
      // Counted, not skipped: `set()` overwrites, so a re-run converges. This
      // only tells the operator how much of the plan is a repeat.
      if ((await ref.get()).exists) alreadyPresent += 1

      const name = nameOf(data)
      const entry = {
        actorId,
        actorEmail: null,
        // The marker is in the text as well as the field: the console's
        // activity table renders `action`, so a provenance flag only a query
        // can reach would leave the page itself unable to say which rows are
        // inferred.
        action: `Created ${source.noun} (reconstructed)`,
        target: {
          type: source.targetType,
          id: artifact.id,
          ...(name ? { name } : {}),
        },
        createdAt,
        reconstructed: true,
        reconstructedFrom: `hosts/${hostId}/${source.sub}/${artifact.id}`,
      }
      await write(ref, entry)

      entriesPlanned += 1
      hostsTouched.add(hostId)
      perSub.set(source.sub, (perSub.get(source.sub) ?? 0) + 1)
      perHost.set(hostId, (perHost.get(hostId) ?? 0) + 1)
    }
  }
}

if (COMMIT && buffered) await batch.commit()

console.log('Entries by artifact type:')
for (const source of SOURCES) {
  const n = perSub.get(source.sub) ?? 0
  console.log(
    `  ${String(n).padStart(4)}  ${source.sub.padEnd(11)} ` +
      `${source.authorField ? `actor from \`${source.authorField}\`` : 'NO actor — the artifact names none'}`,
  )
}
console.log('\nEntries by host:')
for (const [hostId, n] of [...perHost.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${String(n).padStart(4)}  ${hostId}`)
}
console.log(
  `\nhosts scanned          ${hostsScanned}` +
    `\nhosts with entries     ${hostsTouched.size}` +
    `\nartifacts scanned      ${artifactsScanned}` +
    `\nentries planned        ${entriesPlanned}` +
    `\n  attributed           ${withActor}  (distinct actors: ${actorsSeen.size})` +
    `\n  no actor             ${withoutActor}  (artifact names no author)` +
    `\nskipped, no createdAt  ${skippedNoCreatedAt}` +
    `\nalready reconstructed  ${alreadyPresent}  (a re-run overwrites these)` +
    `\n\nmode=${COMMIT ? 'COMMIT — written' : 'DRY RUN — nothing written'}\n`,
)
