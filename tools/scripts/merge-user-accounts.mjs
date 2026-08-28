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

// Fold one account's records into another's, when one human ended up holding
// two.
//
// Both uids are ARGUMENTS. Nothing about a particular person is compiled in:
// this repository is public, and production uids were scrubbed out of it once
// already (AGL-2029). A script that named an account would put one back.
//
//   FIREBASE_PROJECT_ID=… FIREBASE_CLIENT_EMAIL=… FIREBASE_PRIVATE_KEY=… \
//     node tools/scripts/merge-user-accounts.mjs --from <losingUid> --to <survivingUid> [--commit]
//
// Dry-run by default. `--commit` applies.
//
// ## Discovery is a SWEEP, never a list
//
// The obvious way to write this is a list of the places a uid lives —
// `orgs/{orgId}/members/{uid}`, `ownerUid`, `memberRoles`, and so on. That
// way is wrong, and its failure mode is silent: the reference it forgets is
// left pointing at a retired account, and nothing reports it because nothing
// looked. A uid inside a document id or a map KEY is the one a list misses,
// because those are the two shapes a field-name list cannot express.
//
// So this walks EVERY document in EVERY collection and subcollection at run
// time and matches the uid as a value, as a document id, as a map key and as
// an array element. It is slower and it is the point: a reference that exists
// is a reference that gets found, including in a collection written after
// this script was.
//
// ## What it deliberately does NOT move
//
//  - **`createdByUid` on an org.** This is what stops "hand the workspace to
//    an alt account, create another, take it back" from beating the
//    free-workspace cap. It records who spent the allowance, which is a fact
//    about the past that a merge has no business editing. Reported, never
//    written — and the guard below fails the run if a rewrite is ever planned
//    for it.
//  - **`adminAudit` rows.** An audit log is a record of what happened. A
//    merge that rewrote it would make it a record of what we would prefer to
//    have happened. The retired uid stays resolvable because the losing
//    account is disabled rather than deleted, so a row naming it still
//    resolves to a real record.
//
// Both are printed under "left deliberately" so the report distinguishes them
// from work that was missed, and neither counts as outstanding on a re-run.
//
// ## What it CANNOT see, and why the report says so out loud
//
// The sweep matches the uid as a substring, so three kinds of reference
// survive it. None is a bug to be fixed later — each is structurally out of
// reach — and all three are printed under "CANNOT BE MOVED BY A SWEEP" on
// every run, dry or not. A merge script whose limits go undocumented reads as
// complete, and the next pair of accounts may be one where these matter.
//
//  1. **A uid hashed into a document id.** `rateLimits` keys on
//     `sha256(key)`, `apiIdempotency` on `sha256(scope)`, and
//     `marketplaceReports` on `sha256(uid:listing:review)`. A substring match
//     cannot invert a digest. The first two expire on their own; the third
//     also carries `reporterUid` in the clear, so the sweep still finds that
//     row by its field even though it can never recognize the id.
//  2. **A composite document id that embeds the uid unhashed** — the
//     `lockdowns/user--{uid}` shape. These the sweep DOES find, and it still
//     refuses to rewrite them: only the code that built the key knows how to
//     rebuild it, and guessing mints a document nothing reads. They are
//     reported as needing a bespoke move.
//  3. **Anything outside this Firestore project.** Stripe customer and
//     subscription metadata (`actorUid`, `buyerUid`, `createdBy`,
//     `aglyn_actor_uid`, `profileId`, `client_reference_id`), GA4 `user_id`,
//     Realtime Database presence rooms, Cloud Storage prefixes, and issue
//     tracker bodies. The Storage prefix is at least COUNTED, because a
//     bucket listing is cheap and "empty" is worth proving rather than
//     assuming; the rest are named so the report is a checklist and not a
//     silence.
//
// Custom claims on OTHER accounts are checked too — an impersonation session
// carries the staff uid that opened it — and are reported rather than edited,
// because rewriting one would forge a session record.
//
// ## Order of operations: write, read back, and only then remove
//
// Every move is write-new → re-read-new → delete-old, in that order, per
// record. The reverse order is how a merge loses data: a delete that succeeds
// followed by a write that fails leaves nothing behind. A write that succeeds
// followed by a delete that fails leaves a duplicate, which is recoverable
// and which the next run cleans up.
//
// ## Auth accounts are DISABLED, never deleted
//
// Deleting an Auth account is irreversible and takes a sign-in route with it.
// Disabling is reversible in one click, and unlinking the shared provider is
// reversible by signing in with that provider again. The account keeps
// existing, so audit rows that name it keep resolving.
//
// Pools matter here: this project runs a project-level pool AND GCIP tenants
// for enterprise SSO, a uid is unique only WITHIN a pool, and custom claims
// are per-pool — `setCustomUserClaims` against the project pool cannot touch
// a tenant user. Each uid's pool is resolved by searching every pool rather
// than assumed, for the reason `auth-pools.ts` documents.
//
// ## Sign-in must survive
//
// The run aborts before any write if the surviving account is disabled, has
// no sign-in provider, or cannot be found in any pool. A merge that leaves
// the owner unable to authenticate is worse than the duplication it fixes.
//
// Idempotent: a second run reports zero outstanding work, which is the proof
// that the first one finished.

import { existsSync, readFileSync } from 'node:fs'
import { cert, getApps, initializeApp } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
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
const flag = (name) => args.includes(name)
const opt = (name, fallback = '') => {
  const i = args.indexOf(name)
  return i !== -1 ? (args[i + 1] ?? fallback) : fallback
}

const COMMIT = flag('--commit')
const LOSER = opt('--from')
const SURVIVOR = opt('--to')
const KEEP_LOSER_ENABLED = flag('--keep-loser-enabled')
const KEEP_SHARED_PROVIDER = flag('--keep-shared-provider')

if (!LOSER || !SURVIVOR) {
  console.error(
    'Usage: node tools/scripts/merge-user-accounts.mjs --from <losingUid> --to <survivingUid> [--commit]\n' +
      '       --keep-loser-enabled     do not disable the losing Auth account\n' +
      '       --keep-shared-provider   do not unlink providers asserting an address the survivor holds',
  )
  process.exit(1)
}
if (LOSER === SURVIVOR) {
  console.error('--from and --to are the same uid; nothing to merge.')
  process.exit(1)
}

/**
 * Fields whose whole purpose is to record the past. A merge reports them and
 * moves on; see the header for why each one is untouchable.
 */
const NEVER_REWRITTEN_FIELDS = new Set(['createdByUid'])
/** Collections whose rows are a historical record, not current state. */
const NEVER_REWRITTEN_COLLECTIONS = new Set(['adminAudit'])

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
const auth = getAuth()

/** Addresses are personal data; the console record does not need them whole. */
const maskAddress = (value) =>
  String(value ?? '').replace(/([^@\s]{1})[^@\s]*(@[^\s]*)/g, '$1***$2')

console.log(
  `\nMerge accounts — project=${projectId} ` +
    `from=${LOSER} to=${SURVIVOR} mode=${COMMIT ? 'COMMIT' : 'dry-run'}\n`,
)

/*==========================================
 *
 * MARK - PHASE 0: THE POOLS, AND CAN THE SURVIVOR STILL SIGN IN?
 *
 * Before anything is planned. A merge that leaves the owner unable to
 * authenticate is a worse outcome than the duplication it set out to fix,
 * so the run refuses rather than reporting the problem afterwards.
 *
 *=========================================*/

async function everyPool() {
  const pools = [null]
  try {
    let token
    do {
      const page = await auth.tenantManager().listTenants(100, token)
      for (const tenant of page.tenants) pools.push(tenant.tenantId)
      token = page.pageToken
    } while (token)
  } catch (error) {
    console.error(`  ! could not list GCIP tenants: ${error.message}`)
  }
  return pools
}

const authForPool = (pool) =>
  pool ? auth.tenantManager().authForTenant(pool) : auth

/** Every pool holding this uid. More than one is possible and is reported. */
async function findAcrossPools(uid, pools) {
  const found = []
  for (const pool of pools) {
    try {
      found.push({ pool, record: await authForPool(pool).getUser(uid) })
    } catch {
      /* absent from this pool, which is the normal case */
    }
  }
  return found
}

const pools = await everyPool()
console.log(`Auth pools: ${pools.map((p) => p ?? '(project)').join(', ')}\n`)

const survivorFound = await findAcrossPools(SURVIVOR, pools)
const loserFound = await findAcrossPools(LOSER, pools)

for (const [label, uid, found] of [
  ['SURVIVOR', SURVIVOR, survivorFound],
  ['LOSING  ', LOSER, loserFound],
]) {
  if (!found.length) {
    console.log(`${label} ${uid} — no Auth record in any pool`)
    continue
  }
  for (const { pool, record } of found) {
    console.log(
      `${label} ${uid} @ ${pool ?? '(project)'} — ${maskAddress(record.email)} ` +
        `disabled=${record.disabled} providers=[${record.providerData
          .map((p) => p.providerId)
          .join(' ')}] claims=${JSON.stringify(record.customClaims ?? {})}`,
    )
  }
}
console.log('')

const blockers = []
if (!survivorFound.length) {
  blockers.push(`surviving uid ${SURVIVOR} has no Auth record in any pool`)
} else {
  for (const { pool, record } of survivorFound) {
    if (record.disabled) {
      blockers.push(
        `surviving account is DISABLED in pool ${pool ?? '(project)'}`,
      )
    }
    if (!record.providerData.length) {
      blockers.push(
        `surviving account has no sign-in provider in pool ${pool ?? '(project)'}`,
      )
    }
  }
}
if (blockers.length) {
  console.error('REFUSING — sign-in would not survive this merge:')
  for (const b of blockers) console.error('  -', b)
  process.exit(1)
}

/*==========================================
 *
 * MARK - PHASE 1: SWEEP (reads only)
 *
 * Every document in the database, matched four ways. See the header for why
 * this is a sweep and not a list of known field names.
 *
 *=========================================*/

/** Plain data objects only: timestamps, GeoPoints and refs are not maps. */
const isPlainMap = (value) =>
  value !== null &&
  typeof value === 'object' &&
  !Array.isArray(value) &&
  typeof value.toDate !== 'function' &&
  value._seconds === undefined &&
  typeof value.latitude !== 'number' &&
  typeof value.path !== 'string'

/**
 * Every place `uid` appears inside a document's data, as a dotted field path
 * plus the shape it was found in. Recurses through maps and arrays because a
 * uid nested two levels down is still a reference that has to be repointed.
 */
function referencesWithin(value, uid, path = '', out = []) {
  if (typeof value === 'string') {
    if (value === uid) out.push({ path, kind: 'value' })
    return out
  }
  if (Array.isArray(value)) {
    value.forEach((item, i) =>
      referencesWithin(item, uid, `${path}[${i}]`, out),
    )
    return out
  }
  if (isPlainMap(value)) {
    for (const [key, inner] of Object.entries(value)) {
      const child = path ? `${path}.${key}` : key
      if (key === uid)
        out.push({ path: child, kind: 'mapKey', parent: path, key })
      referencesWithin(inner, uid, child, out)
    }
  }
  return out
}

/** Bounded concurrency: a sweep is thousands of round trips, not a few. */
async function inParallel(items, width, fn) {
  const queue = [...items]
  await Promise.all(
    Array.from({ length: width }, async () => {
      while (queue.length) await fn(queue.shift())
    }),
  )
}

/** Everything the losing uid still owns, by shape. */
const ownedDocs = [] // document ids that ARE the losing uid
const fieldRewrites = [] // field values / array items / map keys
const leftDeliberately = [] // found, and policy says do not touch
let documentsScanned = 0
let collectionsScanned = 0

async function sweep(collectionRef, path, rootCollectionId) {
  collectionsScanned += 1
  const snapshot = await collectionRef.get()
  await inParallel(snapshot.docs, 12, async (doc) => {
    documentsScanned += 1
    const docPath = `${path}/${doc.id}`
    const data = doc.data() ?? {}

    if (doc.id === LOSER) {
      ownedDocs.push({ ref: doc.ref, path: docPath, data })
    } else if (doc.id.includes(LOSER)) {
      // A composite id — `${uid}_${something}` and friends. Never rewritten
      // automatically: only the code that built the key knows how to rebuild
      // it, and guessing would mint a document nothing reads.
      leftDeliberately.push({
        path: docPath,
        what: 'document id EMBEDS the uid (composite key)',
        why: 'only the writer of this key knows its format — needs a bespoke move',
        needsAttention: true,
      })
    }

    for (const hit of referencesWithin(data, LOSER)) {
      const leafField = hit.path
        .split('.')
        .pop()
        .replace(/\[\d+\]$/, '')
      if (NEVER_REWRITTEN_COLLECTIONS.has(rootCollectionId)) {
        leftDeliberately.push({
          path: docPath,
          what: `${hit.path} (${hit.kind})`,
          why: 'audit rows record what happened and are never rewritten',
        })
      } else if (NEVER_REWRITTEN_FIELDS.has(leafField)) {
        leftDeliberately.push({
          path: docPath,
          what: `${hit.path} (${hit.kind})`,
          why: 'records who spent the workspace allowance — deliberately never moved',
        })
      } else {
        fieldRewrites.push({
          ref: doc.ref,
          docPath,
          path: hit.path,
          path2: hit.path,
          kind: hit.kind,
          parent: hit.parent,
          key: hit.key,
        })
      }
    }

    for (const sub of await doc.ref.listCollections()) {
      await sweep(sub, `${docPath}/${sub.id}`, rootCollectionId)
    }
  })
}

const rootCollections = await firestore.listCollections()
await inParallel(rootCollections, 6, (c) => sweep(c, c.id, c.id))

console.log(
  `Swept ${documentsScanned} documents across ${collectionsScanned} collections.\n`,
)

/*==========================================
 *
 * MARK - PHASE 1b: THE PLAN
 *
 * A document whose id IS the losing uid moves to the same path under the
 * surviving uid, subtree and all. Where the destination already exists the
 * survivor's own values win: it is the account of record, and a merge that
 * overwrote them would be importing the retired account's staleness.
 *
 *=========================================*/

/** Every document under a ref, as {relative path, data}. Depth-first. */
async function subtreeOf(ref, prefix = '') {
  const out = []
  for (const sub of await ref.listCollections()) {
    for (const doc of (await sub.get()).docs) {
      const rel = `${prefix}${sub.id}/${doc.id}`
      out.push({ rel, data: doc.data() ?? {}, ref: doc.ref })
      out.push(...(await subtreeOf(doc.ref, `${rel}/`)))
    }
  }
  return out
}

const moves = []
for (const owned of ownedDocs) {
  const destPath = owned.path.replace(
    new RegExp(`(^|/)${LOSER}($|/)`),
    `$1${SURVIVOR}$2`,
  )
  const destRef = firestore.doc(destPath)
  const destSnap = await destRef.get()
  const fieldsTaken = {}
  const fieldsDeclined = []
  for (const [key, value] of Object.entries(owned.data)) {
    if (destSnap.exists && destSnap.get(key) !== undefined) {
      fieldsDeclined.push(key)
    } else {
      fieldsTaken[key] = value
    }
  }
  const children = []
  for (const child of await subtreeOf(owned.ref)) {
    const childDest = firestore.doc(`${destPath}/${child.rel}`)
    children.push({
      rel: child.rel,
      from: child.ref,
      to: childDest,
      data: child.data,
      collides: (await childDest.get()).exists,
    })
  }
  moves.push({
    ...owned,
    destPath,
    destRef,
    destExists: destSnap.exists,
    fieldsTaken,
    fieldsDeclined,
    children,
  })
}

console.log('== DOCUMENTS OWNED BY THE LOSING UID ==')
if (!moves.length) console.log('  (none)')
for (const move of moves) {
  console.log(`  ${move.path}`)
  console.log(
    `    -> ${move.destPath} (destination ${move.destExists ? 'EXISTS — merging absent fields only' : 'is new'})`,
  )
  const taken = Object.keys(move.fieldsTaken)
  console.log(
    `       fields taken   : ${taken.length ? taken.join(', ') : '(none)'}`,
  )
  console.log(
    `       fields declined: ${move.fieldsDeclined.length ? move.fieldsDeclined.join(', ') + ' (survivor already has a value)' : '(none)'}`,
  )
  for (const child of move.children) {
    console.log(
      `       subtree ${child.rel}${child.collides ? '  !! COLLIDES — will be left in place' : ''}`,
    )
  }
}

console.log('\n== FIELD / KEY REFERENCES TO REWRITE ==')
if (!fieldRewrites.length) console.log('  (none)')
const byCollection = {}
for (const r of fieldRewrites) {
  const root = r.docPath.split('/')[0]
  byCollection[root] = (byCollection[root] ?? 0) + 1
  console.log(`  ${r.docPath}\n      ${r.kind} at ${r.path} -> ${SURVIVOR}`)
}

console.log('\n== COUNTS PER COLLECTION ==')
const moveCounts = {}
for (const move of moves) {
  const root = move.path.split('/')[0]
  moveCounts[root] = (moveCounts[root] ?? 0) + 1 + move.children.length
}
const allRoots = new Set([
  ...Object.keys(byCollection),
  ...Object.keys(moveCounts),
])
if (!allRoots.size) console.log('  (nothing to move)')
for (const root of [...allRoots].sort()) {
  console.log(
    `  ${root}: ${moveCounts[root] ?? 0} document(s) re-homed, ${byCollection[root] ?? 0} reference(s) rewritten`,
  )
}

console.log('\n== LEFT DELIBERATELY (not outstanding work) ==')
if (!leftDeliberately.length) console.log('  (none)')
for (const item of leftDeliberately) {
  console.log(`  ${item.path}\n      ${item.what}\n      reason: ${item.why}`)
}

const needsHuman = leftDeliberately.filter((i) => i.needsAttention)

/*==========================================
 *
 * MARK - PHASE 1c: GUARDS
 *
 * Checked against the computed plan rather than trusted from the code that
 * built it, so that a future edit to that code is caught here.
 *
 *=========================================*/

const violations = []
for (const rewrite of fieldRewrites) {
  const leaf = rewrite.path
    .split('.')
    .pop()
    .replace(/\[\d+\]$/, '')
  if (NEVER_REWRITTEN_FIELDS.has(leaf)) {
    violations.push(`plan would rewrite ${leaf} at ${rewrite.docPath}`)
  }
  if (NEVER_REWRITTEN_COLLECTIONS.has(rewrite.docPath.split('/')[0])) {
    violations.push(`plan would rewrite an audit row at ${rewrite.docPath}`)
  }
}
for (const move of moves) {
  if (!move.destPath.includes(SURVIVOR)) {
    violations.push(
      `destination ${move.destPath} does not name the surviving uid`,
    )
  }
}
if (violations.length) {
  console.error('\nREFUSING — the plan violates a rule it must not:')
  for (const v of violations) console.error('  -', v)
  process.exit(1)
}

/*==========================================
 *
 * MARK - PHASE 1d: WHAT THE SWEEP CANNOT SEE
 *
 * A sweep matches the uid as a substring. Three kinds of reference survive
 * that and are reported here instead, because a merge that stayed quiet about
 * them would read as complete when it is not.
 *
 *=========================================*/

console.log('\n== CANNOT BE MOVED BY A SWEEP ==')

// 1. Another account's custom claims can NAME this uid — impersonation
//    tokens carry the staff uid that started the session. Claims are
//    per-pool, so every pool is asked.
const claimHolders = []
for (const pool of pools) {
  const poolAuth = authForPool(pool)
  let token
  do {
    const page = await poolAuth.listUsers(1000, token)
    for (const user of page.users) {
      if (user.uid === LOSER) continue
      const claims = JSON.stringify(user.customClaims ?? {})
      if (claims.includes(LOSER)) {
        claimHolders.push(`${user.uid} @ ${pool ?? '(project)'} — ${claims}`)
      }
    }
    token = page.pageToken
  } while (token)
}
if (claimHolders.length) {
  console.log('  custom claims on OTHER accounts naming the losing uid:')
  for (const holder of claimHolders) console.log(`    ${holder}`)
  console.log(
    '    these are short-lived session claims; they expire on their own and are\n' +
      '    not rewritten, because editing them would forge a session record',
  )
} else {
  console.log('  custom claims on other accounts: none name the losing uid')
}

// 2. Cloud Storage is keyed by a path prefix, not a document.
try {
  const { getStorage } = await import('firebase-admin/storage')
  // The admin app is initialized without a default bucket, so it has to be
  // named — same as `storageBucket()` in `erase.ts` and the media routes.
  // The two suffixes are the old and new Firebase defaults; a project created
  // before the rename still answers on `.appspot.com`, so guessing one and
  // reporting "empty" on a miss would be a false all-clear.
  const candidates = [
    process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
    `${projectId}.firebasestorage.app`,
    `${projectId}.appspot.com`,
  ].filter(Boolean)
  let bucket = null
  for (const name of candidates) {
    const candidate = getStorage().bucket(name)
    const [exists] = await candidate.exists()
    if (exists) {
      bucket = candidate
      break
    }
  }
  if (!bucket) {
    console.log(
      `  Cloud Storage — no bucket found among ${candidates.join(', ')}`,
    )
  } else {
    const [files] = await bucket.getFiles({ prefix: `users/${LOSER}/` })
    console.log(
      files.length
        ? `  Cloud Storage ${bucket.name}/users/${LOSER}/ — ${files.length} object(s), NOT moved by this script`
        : `  Cloud Storage ${bucket.name}/users/${LOSER}/ — empty`,
    )
  }
} catch (error) {
  console.log(
    `  Cloud Storage users/${LOSER}/ — could not read (${error.message})`,
  )
}

// 3. Stores that hash the uid into the key, or live outside this project.
//    Listed by name so the report is a checklist rather than a silence.
console.log(
  '  hashed into a document id (a substring match cannot find these):\n' +
    '    rateLimits/…            sha256(key) windows — expire on their own\n' +
    '    apiIdempotency/…        sha256(scope) replay guards — expire on their own\n' +
    '    marketplaceReports/…    sha256(uid:listing:review) — carries reporterUid in\n' +
    '                            the clear, so the sweep finds the row by its field\n' +
    '  outside this Firestore project entirely:\n' +
    '    Stripe customer/subscription metadata (actorUid, buyerUid, createdBy,\n' +
    '      aglyn_actor_uid, profileId, client_reference_id)\n' +
    '    GA4 user_id, Realtime Database presence rooms, external issue tracker bodies\n' +
    '  each is either self-expiring or a historical record; none gates sign-in',
)

const outstanding =
  moves.length +
  fieldRewrites.length +
  moves.reduce((n, m) => n + m.children.length, 0)

console.log(
  `\nOUTSTANDING WORK: ${outstanding} record(s)` +
    `${needsHuman.length ? ` + ${needsHuman.length} needing a bespoke move` : ''}`,
)

if (!COMMIT) {
  console.log(
    '\nDry run. Nothing was written. Re-run with --commit to apply.\n' +
      'Auth changes that --commit WOULD make:\n' +
      `  - disable ${LOSER} in its pool${KEEP_LOSER_ENABLED ? ' (SKIPPED: --keep-loser-enabled)' : ''}\n` +
      `  - unlink providers asserting an address the survivor holds${KEEP_SHARED_PROVIDER ? ' (SKIPPED: --keep-shared-provider)' : ''}\n` +
      '  - the losing Auth account is never deleted; both changes above are reversible',
  )
  process.exit(0)
}

/*==========================================
 *
 * MARK - PHASE 2: APPLY, each record write -> read back -> delete
 *
 * Never the other order. A delete that lands before a failed write loses the
 * record outright; a write that lands before a failed delete leaves a
 * duplicate, which the next run removes.
 *
 *=========================================*/

let written = 0
let removed = 0
const failures = []

async function moveOne(fromRef, toRef, data, label) {
  await toRef.set(data, { merge: true })
  const check = await toRef.get()
  if (!check.exists) {
    failures.push(
      `${label}: destination did not read back; source left in place`,
    )
    return false
  }
  written += 1
  await fromRef.delete()
  removed += 1
  return true
}

for (const move of moves) {
  // Children first: the parent is what the next run keys off, so it is the
  // last thing to disappear. Interrupted halfway, the subtree is still
  // reachable from a document that still exists.
  for (const child of move.children) {
    if (child.collides) {
      console.log(`  skip (collision) ${child.rel}`)
      continue
    }
    await moveOne(child.from, child.to, child.data, child.rel)
  }
  if (Object.keys(move.fieldsTaken).length) {
    await move.destRef.set(move.fieldsTaken, { merge: true })
    const check = await move.destRef.get()
    const landed = Object.keys(move.fieldsTaken).every(
      (k) => check.get(k) !== undefined,
    )
    if (!landed) {
      failures.push(
        `${move.path}: merged fields did not read back; source kept`,
      )
      continue
    }
    written += 1
  }
  const remaining = await subtreeOf(move.ref)
  if (remaining.length) {
    console.log(
      `  keeping ${move.path} — ${remaining.length} child document(s) could not move`,
    )
    continue
  }
  await move.ref.delete()
  removed += 1
}

for (const rewrite of fieldRewrites) {
  const snap = await rewrite.ref.get()
  if (!snap.exists) continue
  if (rewrite.kind === 'mapKey') {
    const parentValue = rewrite.parent ? snap.get(rewrite.parent) : snap.data()
    const carried = parentValue?.[rewrite.key]
    const base = rewrite.parent ? `${rewrite.parent}.` : ''
    await rewrite.ref.update({
      [`${base}${SURVIVOR}`]: carried,
      [`${base}${LOSER}`]: (
        await import('firebase-admin/firestore')
      ).FieldValue.delete(),
    })
  } else if (rewrite.path.includes('[')) {
    // An array element. Rewritten by reading the array, swapping the item and
    // writing it back whole: Firestore cannot address an element by index,
    // and arrayRemove/arrayUnion would reorder.
    const arrayPath = rewrite.path.replace(/\[\d+\]$/, '')
    const current = snap.get(arrayPath)
    if (Array.isArray(current)) {
      await rewrite.ref.update({
        [arrayPath]: current.map((v) => (v === LOSER ? SURVIVOR : v)),
      })
    }
  } else {
    await rewrite.ref.update({ [rewrite.path]: SURVIVOR })
  }
  const after = await rewrite.ref.get()
  if (JSON.stringify(after.data() ?? {}).includes(LOSER)) {
    failures.push(
      `${rewrite.docPath}: still names the losing uid after the write`,
    )
  } else {
    written += 1
  }
}

/*==========================================
 *
 * MARK - PHASE 3: AUTH — reversible changes only
 *
 *=========================================*/

const survivorAddresses = new Set(
  survivorFound.flatMap(({ record }) =>
    [record.email, ...record.providerData.map((p) => p.email)]
      .filter(Boolean)
      .map((a) => String(a).toLowerCase()),
  ),
)

for (const { pool, record } of loserFound) {
  const poolAuth = authForPool(pool)
  const shared = record.providerData.filter(
    (p) => p.email && survivorAddresses.has(String(p.email).toLowerCase()),
  )
  if (shared.length && !KEEP_SHARED_PROVIDER) {
    await poolAuth.updateUser(LOSER, {
      providersToUnlink: shared.map((p) => p.providerId),
    })
    console.log(
      `  unlinked ${shared.map((p) => p.providerId).join(', ')} from ${LOSER} ` +
        `(asserted ${shared.map((p) => maskAddress(p.email)).join(', ')})`,
    )
  }
  if (!KEEP_LOSER_ENABLED && !record.disabled) {
    await poolAuth.updateUser(LOSER, { disabled: true })
    console.log(
      `  disabled ${LOSER} in pool ${pool ?? '(project)'} (reversible)`,
    )
  }
}

// The survivor must come out of this able to sign in and holding the claims
// it went in with. Custom claims are per-pool, so this re-reads the record
// from the pool it actually lives in.
for (const { pool, record: before } of survivorFound) {
  const after = await authForPool(pool).getUser(SURVIVOR)
  if (after.disabled) failures.push('survivor is disabled after the merge')
  if (!after.providerData.length) {
    failures.push('survivor has no sign-in provider after the merge')
  }
  for (const claim of Object.keys(before.customClaims ?? {})) {
    if (after.customClaims?.[claim] === undefined) {
      failures.push(`survivor lost custom claim "${claim}"`)
    }
  }
}

console.log(
  `\nAPPLIED — ${written} write(s) verified, ${removed} source record(s) removed.`,
)
if (failures.length) {
  console.error('\nFAILURES:')
  for (const f of failures) console.error('  -', f)
  process.exit(1)
}
console.log('Re-run without --commit; it must report 0 outstanding work.')
