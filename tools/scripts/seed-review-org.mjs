#!/usr/bin/env node
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

// Fills the App Store / Google Play reviewer's workspace (AGL-3812) with the
// "Juniper Street Co." data the native apps are shot with, so a reviewer who
// signs in reaches every screen populated. What is written, and what is
// deliberately not, is `tools/scripts/lib/review-org-seed.mjs`.
//
//   node --env-file=.env tools/scripts/seed-review-org.mjs \
//     --org 9A5fJ_zEoH --host review-bakery [--create-sibling-sites] [--write]
//
//   --org, --host           required, and only the reviewer org and its bakery
//                           are accepted: this is not a general seeder
//   --write                 write; without it, print every document and stop
//   --create-sibling-sites  also create the workspace's two other sites
//                           (Juniper Street Cafe and Catering) as new hosts.
//                           Opt-in, like `seed-demo-org.mjs --create-hosts`: a
//                           direct host write skips the console's site quota
//   --fixtures <dir>        read the native areas from another checkout's
//                           `tools/scripts/seed-native` (default: this one's)
//   --verify                read every planned document back and report
//                           any field the stored copy is missing
//
// Re-runnable: every id is deterministic (`seed-review-…`) and every write is
// a merge-set. After a write, this seed's own documents that the plan no
// longer names are deleted, matched by both the `seed-review-` prefix and the
// `seedSource` field, inside the collections the plan writes. No Firebase
// Auth user is created, nothing billing-shaped is written, and no email,
// SMS or push is sent: see the module's header for how each cron that could
// message someone is kept away from these documents.
//
// Run `seed-demo-host.mjs` for this host BEFORE this script, never after: the
// brand pack's prune deletes every `seed-` document in the collections it
// owns, this seed's included.

import { cert, getApps, initializeApp } from 'firebase-admin/app'
import { FieldValue, getFirestore } from 'firebase-admin/firestore'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { ensureHost } from './lib/seed-demo.mjs'
import {
  JUNIPER,
  REVIEW_HOST_ID,
  REVIEW_ID_PREFIX,
  REVIEW_ORG_ID,
  REVIEW_SEED_SOURCE,
  assertPlanSafe,
  buildReviewOrgPlan,
  countByCollection,
  isArrayUnion,
  recordCrmFixtures,
  recordNativeAreas,
} from './lib/review-org-seed.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const args = process.argv.slice(2)
const argValue = (flag) => {
  const index = args.indexOf(flag)
  return index !== -1 ? args[index + 1] : undefined
}
const write = args.includes('--write')
const verify = args.includes('--verify')
const siblings = args.includes('--create-sibling-sites')
const orgId = argValue('--org')
const hostId = argValue('--host')
const fixturesDir = resolve(argValue('--fixtures') ?? join(HERE, 'seed-native'))

const fail = (message) => {
  console.error(`seed-review-org: ${message}`)
  process.exit(1)
}
if (!orgId || !hostId) fail('--org and --host are both required.')
if (orgId !== REVIEW_ORG_ID || hostId !== REVIEW_HOST_ID) {
  fail(`only --org ${REVIEW_ORG_ID} --host ${REVIEW_HOST_ID} (the reviewer workspace) is accepted.`)
}

const emulated = Boolean(process.env.FIRESTORE_EMULATOR_HOST)
const projectId = process.env.FIREBASE_PROJECT_ID
const clientEmail = process.env.FIREBASE_CLIENT_EMAIL
const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n')
if (!emulated && (!projectId || !clientEmail || !privateKey)) {
  fail('FIREBASE_PROJECT_ID / FIREBASE_CLIENT_EMAIL / FIREBASE_PRIVATE_KEY are not set (run with --env-file).')
}
if (!getApps().length) {
  initializeApp(
    emulated ? { projectId: projectId ?? 'demo-aglyn' } : { credential: cert({ projectId, clientEmail, privateKey }) },
  )
}
const firestore = getFirestore()

// ── The workspace, as it is ─────────────────────────────────────────────────
const orgSnapshot = await firestore.collection('orgs').doc(orgId).get()
if (!orgSnapshot.exists) fail(`org ${orgId} does not exist.`)
const ownerUid = orgSnapshot.get('ownerUid')
const orgSlug = orgSnapshot.get('slug')
if (!ownerUid || !orgSlug) fail(`org ${orgId} has no ownerUid or slug.`)
const hostSnapshot = await firestore.collection('hosts').doc(hostId).get()
if (!hostSnapshot.exists || hostSnapshot.get('orgId') !== orgId) fail(`host ${hostId} is not in org ${orgId}.`)
const ownerMember = await firestore.doc(`orgs/${orgId}/members/${ownerUid}`).get()
const ownerUser = await firestore.doc(`users/${ownerUid}`).get()
const ownerName = ownerMember.get('displayName') || ownerUser.get('displayName') || 'Workspace owner'

// ── The plan ───────────────────────────────────────────────────────────────
const nowMs = Date.now()
const loadArea = (file) => import(pathToFileURL(join(fixturesDir, `${file}.mjs`)).href)
const records = [...(await recordNativeAreas(loadArea, nowMs)), ...(await recordCrmFixtures(nowMs))]
const target = { orgId, hostId, orgSlug, ownerUid, ownerName }
const { docs, skipped } = buildReviewOrgPlan({ records, target, nowMs, siblings })
const hostIds = [hostId, ...(siblings ? JUNIPER.siblings.map((site) => site.hostId) : [])]
assertPlanSafe(docs, { orgId, hostIds, ownerUid })

const summary = () => {
  console.log(`\n${docs.length} documents (${fixturesDir}):`)
  for (const [collection, count] of Object.entries(countByCollection(docs))) {
    console.log(`  ${collection.padEnd(36)} ${count}`)
  }
  const reasons = {}
  for (const entry of skipped) reasons[entry.reason] = (reasons[entry.reason] ?? 0) + 1
  console.log(`\n${skipped.length} fixture documents left out:`)
  for (const [reason, count] of Object.entries(reasons)) console.log(`  ${String(count).padStart(4)}  ${reason}`)
}

if (verify) {
  await verifyPlan()
  process.exit(0)
}

if (!write) {
  for (const { path, existing } of docs) console.log(`${existing ? '~' : '+'} ${path}`)
  summary()
  console.log('\nDry run (+ new or merged, ~ merged only if it exists). Pass --write to write.')
  process.exit(0)
}

// ── The sibling sites ──────────────────────────────────────────────────────
if (siblings) {
  for (const site of JUNIPER.siblings) {
    await ensureHost({
      firestore,
      hostId: site.hostId,
      subdomain: site.subdomain,
      displayName: site.displayName,
      orgId,
      log: (line) => console.log(line),
    })
  }
}

// ── Write ──────────────────────────────────────────────────────────────────
const toFirestore = (value) => {
  if (isArrayUnion(value)) return FieldValue.arrayUnion(...value.__reviewSeedArrayUnion)
  if (Array.isArray(value)) return value.map(toFirestore)
  if (value && typeof value === 'object' && value.constructor === Object) {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, toFirestore(entry)]))
  }
  return value
}
let written = 0
let missing = 0
let batch = firestore.batch()
let inBatch = 0
for (const { path, data, existing } of docs) {
  const ref = firestore.doc(path)
  if (existing && !(await ref.get()).exists) {
    console.log(`  skipped ${path}: it does not exist`)
    missing += 1
    continue
  }
  batch.set(ref, toFirestore(data), { merge: true })
  written += 1
  inBatch += 1
  if (inBatch === 400) {
    await batch.commit()
    batch = firestore.batch()
    inBatch = 0
  }
}
if (inBatch) await batch.commit()
console.log(`Wrote ${written} documents${missing ? `; ${missing} merge-only documents did not exist` : ''}.`)

// ── Prune this seed's documents the plan no longer names ──────────────────
const planned = new Set(docs.map((doc) => doc.path))
const collections = new Set(
  docs.filter((doc) => doc.path.split('/').pop().startsWith(REVIEW_ID_PREFIX)).map((doc) => doc.path.split('/').slice(0, -1).join('/')),
)
let pruned = 0
for (const collectionPath of collections) {
  const stale = await firestore.collection(collectionPath).where('seedSource', '==', REVIEW_SEED_SOURCE).get()
  for (const doc of stale.docs) {
    if (!doc.id.startsWith(REVIEW_ID_PREFIX) || planned.has(doc.ref.path)) continue
    // `apiKeys` is top-level: only this org's.
    if (collectionPath === 'apiKeys' && doc.get('orgId') !== orgId) continue
    await firestore.recursiveDelete(doc.ref)
    pruned += 1
  }
}
console.log(`Pruned ${pruned} stale seed-review document(s).`)

// ── Bookings an earlier seed left armed ───────────────────────────────────
// `booking-reminders` mails every confirmed booking 23–25h out that carries
// no `reminderSentAt`. Seeded bookings elsewhere in this org (the brand
// packs' and the earlier review bookings) carry none; their customers are
// fixtures, so they are marked as reminded too.
let disarmed = 0
for (const id of Object.keys(orgSnapshot.get('hosts') ?? {})) {
  const bookings = await firestore.collection(`hosts/${id}/bookings`).get()
  for (const doc of bookings.docs) {
    if (!doc.id.startsWith('seed-') || doc.get('reminderSentAt')) continue
    await doc.ref.set({ reminderSentAt: new Date(nowMs) }, { merge: true })
    disarmed += 1
  }
}
console.log(`Marked ${disarmed} earlier seeded booking(s) as reminded.`)
summary()

/** Reads every planned document back; reports what the stored copy lacks. */
async function verifyPlan() {
  const counts = {}
  const gaps = []
  for (const { path, data, existing } of docs) {
    const snapshot = await firestore.doc(path).get()
    const key = Object.keys(countByCollection([{ path }]))[0]
    counts[key] ??= { planned: 0, stored: 0 }
    counts[key].planned += 1
    if (!snapshot.exists) {
      if (!existing) gaps.push(`${path}: missing`)
      continue
    }
    counts[key].stored += 1
    const stored = snapshot.data()
    for (const field of Object.keys(data)) {
      if (stored[field] === undefined) gaps.push(`${path}: no ${field}`)
    }
  }
  console.log('collection                           planned  stored')
  for (const [collection, { planned, stored }] of Object.entries(counts)) {
    console.log(`  ${collection.padEnd(36)} ${String(planned).padStart(6)}  ${String(stored).padStart(6)}`)
  }
  console.log(gaps.length ? `\n${gaps.length} gap(s):\n  ${gaps.slice(0, 60).join('\n  ')}` : '\nEvery planned field is stored.')
}
