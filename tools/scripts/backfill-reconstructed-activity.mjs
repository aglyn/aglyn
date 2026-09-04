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
//            person, so nothing in this script reads an actor off them.
//   NOT      the edits BETWEEN creation and now. `updatedAt` proves only that
//            a last write happened; it names neither how many there were nor
//            what they changed, so no entry is emitted for it.
//   INFERRED where the host has EXACTLY ONE member and the artifact was made
//            while that member's account was active, the actor is inferred to
//            be that member — see below. Marked as inferred, always.
//
// ── THE ONE INFERENCE THIS MAKES, AND WHY IT IS ALLOWED ───────────────────
//
// Attributing an artifact to an org's owner because they own the org is not
// allowed and is not done: an org can hold many people who could each have
// done it, so "the owner probably did" is a guess with a name attached.
//
// A host whose `memberRoles` map holds exactly ONE entry is a different
// question. The set of people with access is EXHAUSTIVE and its size is one,
// so "who else could it have been" has the answer "nobody" rather than "we
// picked the likeliest". That is the whole distinction, and it is why the
// rule below refuses the moment a second member appears — it does not pick
// the more probable of two.
//
// ⛔ IT IS STILL NOT PROOF, and the marker is what keeps that true. STAFF
// writes bypass `memberRoles` entirely (`isStaff()` is the first disjunct of
// every host rule), and so does every Admin-SDK route, so a single-member map
// bounds the CUSTOMERS who could have written, not the writers. Every
// inferred row therefore carries `actorInferred` and the basis it was drawn
// from, and the staff view renders that marker beside the actor. An inferred
// actor that reaches a reader looking like a recorded one is the failure this
// exists to prevent; dropping the marker because the evidence feels
// conclusive is how that happens.
//
// ── THE WINDOW, AND WHAT IT ACTUALLY ESTABLISHES ──────────────────────────
//
// There is no per-session log to test containment against. Firebase Auth
// exposes `creationTime` / `lastSignInTime` / `lastRefreshTime` and no session
// list, and the `users/{uid}/devices` records cannot substitute: their
// `lastSeenAt` is stamped at sign-in and not maintained per request (a device
// on the reported account carries `lastSeenAt === createdAt`), so a device row
// bounds nothing.
//
// So the window is the account's ACTIVE LIFETIME — creation to last refresh —
// and the honest statement of what it buys is narrow: it rules out an
// artifact made before the account existed, or after it went permanently
// idle. It does NOT establish that the person was in session at that instant.
// It is a floor under the inference, not the inference itself; the exhaustive
// access set is what carries it.
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
import { getAuth } from 'firebase-admin/auth'
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
  { sub: 'layouts', targetType: 'layout', noun: 'shared layout', authorField: null },
  { sub: 'components', targetType: 'component', noun: 'reusable component', authorField: null },
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

/**
 * The account's ACTIVE LIFETIME, from Firebase Auth. Memoized: the same member
 * is asked about once per artifact otherwise.
 *
 * Returns null when the account is gone — a deleted user is not somebody to
 * attribute new rows to.
 */
const windowCache = new Map()
const activeWindowFor = async (uid) => {
  if (windowCache.has(uid)) return windowCache.get(uid)
  let window = null
  try {
    const user = await getAuth().getUser(uid)
    const email = typeof user.email === 'string' ? user.email : null
    const from = Date.parse(user.metadata.creationTime ?? '')
    // `lastRefreshTime` is the most recent evidence the account was live at
    // all; fall back to sign-in, then to now, so a missing field never makes
    // the window empty and silently refuses every artifact.
    const to = Date.parse(
      user.metadata.lastRefreshTime ??
        user.metadata.lastSignInTime ??
        new Date().toISOString(),
    )
    if (Number.isFinite(from) && Number.isFinite(to) && to >= from) {
      window = { fromMs: from, toMs: to, email }
    }
  } catch {
    window = null
  }
  windowCache.set(uid, window)
  return window
}

/**
 * The member to infer as actor for artifacts on this host, or null.
 *
 * Null the moment the access set is anything but a single person. Two members
 * is not "pick the likelier one" — it is a refusal.
 */
const soleMemberOf = async (hostData) => {
  const roles = hostData.memberRoles
  // An ABSENT map is unknown, not empty. A host whose projection never ran
  // would otherwise read as "nobody has access", which is not a fact about
  // who could have written and must never be treated as one.
  if (!roles || typeof roles !== 'object') return null
  const uids = Object.keys(roles)
  if (uids.length !== 1) return null
  const uid = uids[0]
  const window = await activeWindowFor(uid)
  return window ? { uid, window } : null
}

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
let inferredActor = 0
let refusedNotSoleMember = 0
let refusedOutsideWindow = 0
const soleMemberHosts = new Set()
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
  // Resolved once per host: the access set is a property of the site, not of
  // each artifact under it.
  const sole = await soleMemberOf(hostDoc.data() ?? {})
  if (sole) soleMemberHosts.add(hostId)

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
      // RECORDED first, always. An artifact that names its own author is not
      // an inference and must never be re-decided by one.
      const recordedActor = source.authorField
        ? typeof data[source.authorField] === 'string' && data[source.authorField]
          ? data[source.authorField]
          : null
        : null
      // Then, and only for an artifact that names nobody, the sole-member
      // inference. It refuses on two distinct grounds and counts them apart,
      // because "the site has two members" and "this predates the account"
      // are different answers and collapsing them hides which rule bit.
      let inferred = null
      if (!recordedActor) {
        if (!sole) {
          refusedNotSoleMember += 1
        } else if (
          createdAt.toMillis() < sole.window.fromMs ||
          createdAt.toMillis() > sole.window.toMs
        ) {
          refusedOutsideWindow += 1
        } else {
          inferred = sole
        }
      }
      const actorId = recordedActor ?? inferred?.uid ?? null
      if (recordedActor) {
        withActor += 1
        actorsSeen.add(recordedActor)
      } else if (inferred) {
        inferredActor += 1
        actorsSeen.add(inferred.uid)
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
        // Follows the actor: a filled-in row carries the same two fields a
        // live entry does, so nothing downstream has to special-case it.
        actorEmail: recordedActor ? null : (inferred?.window.email ?? null),
        // EXACTLY the string a live create writes for the same act — see
        // `activity.noun` on each entry of RESOURCES in
        // `apps/console/app/api/hosts/resources/route.ts`. A reconstructed row
        // and a real one describe the same event in the same words, so a
        // filter, a report or a future migration has one spelling to know
        // rather than two. Provenance lives in the fields below, which is
        // where an audit trail keeps it.
        action: `Created ${source.noun}`,
        target: {
          type: source.targetType,
          id: artifact.id,
          ...(name ? { name } : {}),
        },
        createdAt,
        reconstructed: true,
        reconstructedFrom: `hosts/${hostId}/${source.sub}/${artifact.id}`,
        // The basis, as DATA and only as data. It is not rendered — no suffix
        // on the action, no chip on the row — because a page that shouts
        // "inferred" on every line is a page nobody reads. It stays on the
        // document because ordinary audit hygiene says a derived record
        // names what it was derived from, and because the day somebody
        // questions one of these rows this field is the entire answer.
        // Written only when true, so a recorded-author row and an ordinary
        // row are both simply without it.
        ...(inferred
          ? {
              actorInferred: true,
              actorInferredFrom: {
                basis: 'sole-host-member',
                hostId,
                // The size of the access set the inference rests on. Stored so
                // a later reader can see the rule was "exactly one", not "the
                // most likely of several".
                memberCount: 1,
                activeFromMs: inferred.window.fromMs,
                activeToMs: inferred.window.toMs,
              },
            }
          : {}),
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
      `${
        source.authorField
          ? `actor RECORDED on the artifact (${source.authorField})`
          : 'no author field — actor inferred only on a single-member host'
      }`,
  )
}
console.log('\nEntries by host:')
for (const [hostId, n] of [...perHost.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${String(n).padStart(4)}  ${hostId}`)
}
console.log(
  `\nhosts scanned          ${hostsScanned}` +
    `\nhosts with entries     ${hostsTouched.size}` +
    `\nsingle-member hosts    ${soleMemberHosts.size}  (the only sites an actor can be inferred on)` +
    `\nartifacts scanned      ${artifactsScanned}` +
    `\nentries planned        ${entriesPlanned}` +
    `\n  actor RECORDED       ${withActor}  (read off the artifact)` +
    `\n  actor INFERRED       ${inferredActor}  (sole host member, marked as inferred)` +
    `\n  no actor             ${withoutActor}` +
    `\n    refused, >1 member ${refusedNotSoleMember}` +
    `\n    refused, outside   ${refusedOutsideWindow}  (predates or postdates the account)` +
    `\n  distinct actors      ${actorsSeen.size}` +
    `\nskipped, no createdAt  ${skippedNoCreatedAt}` +
    `\nalready reconstructed  ${alreadyPresent}  (a re-run overwrites these)` +
    `\n\nmode=${COMMIT ? 'COMMIT — written' : 'DRY RUN — nothing written'}\n`,
)
