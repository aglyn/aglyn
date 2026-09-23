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

// The account-acquisition backfill (AGL-3289).
//
//   GOOGLE_CLOUD_PROJECT=aglyn-main node tools/scripts/backfill-account-acquisition.mjs
//   GOOGLE_CLOUD_PROJECT=aglyn-main node tools/scripts/backfill-account-acquisition.mjs --apply
//
// DRY RUN BY DEFAULT. `--apply` writes. Every decision is
// `lib/account-acquisition-backfill.mjs`'s and pinned by its test; this file
// reads, prints and writes.
//
// ## What it does
//
// Every `users/{uid}` created before the first-touch capture existed gets
// `acquisition: { source: 'unknown', … }`, marked as the backfill's, with what
// the platform can still say: the auth record's creation time and provider,
// and where the account's first device was last seen from. Every workspace
// with no record then gets its creator's, as `createdByUid` (or `ownerUid`)
// names it — the same copy a workspace created today is born with.
//
// ## What it never does
//
// Overwrite. Each write is a transaction that re-reads the document and
// writes nothing if a record arrived since the plan was made — the live
// sign-up door writing an account created while this ran, say. An account
// younger than the live window is skipped outright, because its own door may
// still be writing the real thing.
//
// Accounts in an SSO tenant's user pool are not in the project pool this
// reads, so they are stamped without a creation time or provider.

import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { getAuth } from 'firebase-admin/auth'
import {
  authFacts,
  hasRecord,
  planOrgAcquisition,
  planUserAcquisition,
} from './lib/account-acquisition-backfill.mjs'
import { parseDeployArgs } from './lib/deploy-args.mjs'
import { connectFirestore, everyDocument } from './lib/firestore-backfill.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = join(here, '..', '..')
const FIELD = 'acquisition'

const args = parseDeployArgs({
  command: 'backfill-account-acquisition',
  summary:
    'Stamp every account and workspace that predates first-touch capture with ' +
    "acquisition: { source: 'unknown' } and what the auth record can still say. " +
    'Writes to the named project with --apply.',
  effect: { gerund: 'writing', past: 'WRITTEN', failure: 'could not run' },
  flags: [{ flag: '--apply', key: 'apply', describe: 'Write. Without it, a dry run.' }],
})
const apply = Boolean(args.apply)

/** Auth facts for a batch of uids, from the project pool. */
async function factsFor(uids) {
  const facts = new Map()
  for (let i = 0; i < uids.length; i += 100) {
    const { users } = await getAuth().getUsers(uids.slice(i, i + 100).map((uid) => ({ uid })))
    for (const user of users) facts.set(user.uid, authFacts(user))
  }
  return facts
}

/** The location the account's earliest device was last seen from, or null. */
async function firstDeviceLocation(db, uid) {
  const devices = db.collection('users').doc(uid).collection('devices')
  const snapshot = await devices
    .orderBy('createdAt', 'asc')
    .limit(1)
    .get()
    .catch(() => devices.limit(1).get())
  const location = snapshot.docs[0]?.get('location')
  return typeof location === 'string' ? location : null
}

/** Write one record unless the document has gained one since it was planned. */
async function writeOnce(db, ref, record) {
  return db.runTransaction(async (tx) => {
    const snapshot = await tx.get(ref)
    if (!snapshot.exists || hasRecord(snapshot.get(FIELD))) return false
    tx.set(ref, { [FIELD]: record }, { merge: true })
    return true
  })
}

async function main() {
  const db = connectFirestore({ repoRoot: REPO_ROOT, apply })
  const nowMs = Date.now()

  const users = []
  for await (const snapshot of everyDocument(db.collection('users'))) {
    users.push({ ref: snapshot.ref, uid: snapshot.id, existing: snapshot.get(FIELD) })
  }
  const missing = users.filter((user) => !hasRecord(user.existing))
  const facts = await factsFor(missing.map((user) => user.uid))

  const records = new Map(users.filter((user) => hasRecord(user.existing)).map((user) => [user.uid, user.existing]))
  const userPlans = []
  let young = 0
  for (const user of missing) {
    const record = planUserAcquisition({
      existing: user.existing,
      auth: facts.get(user.uid) ?? null,
      firstDeviceLocation: await firstDeviceLocation(db, user.uid),
      nowMs,
    })
    if (!record) {
      young += 1
      continue
    }
    userPlans.push({ ref: user.ref, uid: user.uid, record })
    records.set(user.uid, record)
  }

  const orgPlans = []
  let orgsSeen = 0
  for await (const snapshot of everyDocument(db.collection('orgs'))) {
    orgsSeen += 1
    const creatorUid = snapshot.get('createdByUid') || snapshot.get('ownerUid') || null
    const record = planOrgAcquisition({
      existing: snapshot.get(FIELD),
      creatorUid,
      creatorRecord: creatorUid ? (records.get(creatorUid) ?? null) : null,
      nowMs,
    })
    if (record) orgPlans.push({ ref: snapshot.ref, id: snapshot.id, record })
  }

  console.log(
    `accounts: ${users.length} read, ${users.length - missing.length} already recorded, ` +
      `${young} too new to backfill, ${userPlans.length} to stamp` +
      ` (${userPlans.filter((plan) => plan.record.accountCreatedAt).length} with a creation time, ` +
      `${userPlans.filter((plan) => plan.record.geo).length} with a first-device location)`,
  )
  console.log(`workspaces: ${orgsSeen} read, ${orgPlans.length} to stamp`)
  for (const plan of userPlans.slice(0, 5)) {
    const { provider, accountCreatedAt, geo } = plan.record
    console.log(
      `  users/${plan.uid}: unknown · ${provider ?? 'no provider'} · ` +
        `${accountCreatedAt ? new Date(accountCreatedAt).toISOString() : 'no creation time'} · ` +
        `${geo ? [geo.city, geo.region, geo.country].filter(Boolean).join(', ') : 'no location'}`,
    )
  }
  for (const plan of orgPlans.slice(0, 5)) {
    console.log(`  orgs/${plan.id}: ${plan.record.source} · from ${plan.record.copiedFromUid ?? 'no creator'}`)
  }

  if (!apply) {
    console.log('Dry run — nothing was written. Re-run with --apply.')
    return
  }
  let written = 0
  let raced = 0
  for (const plan of [...userPlans, ...orgPlans]) {
    if (await writeOnce(db, plan.ref, plan.record)) written += 1
    else raced += 1
  }
  console.log(`wrote ${written} record(s); ${raced} gained a record while this ran and were left alone`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
