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

// The two accounts the /signin consent bounce left without an acquisition
// record (AGL-3426, found under AGL-3355).
//
//   GOOGLE_CLOUD_PROJECT=aglyn-main node tools/scripts/backfill-bounced-account-acquisition.mjs --dry-run
//   GOOGLE_CLOUD_PROJECT=aglyn-main node tools/scripts/backfill-bounced-account-acquisition.mjs --apply
//
// DRY RUN BY DEFAULT; `--dry-run` says so explicitly, and `--apply` writes.
//
// Both are Google accounts that "Sign in with Google" on /signin created after
// first-touch capture went live (AGL-3289), and that the page stood down for
// consent before anything recorded where they came from. The live doors now
// record at the stand-down, so no new account can end up like this; these two
// already had. Their first touch is gone, so each gets exactly the record
// `backfill-account-acquisition.mjs` gives an account that predates capture —
// `source: 'unknown'`, marked `recordedBy: 'backfill'`, with the auth
// record's creation time and provider and the first device's location when
// there is one — built by the same `planUserAcquisition`.
//
// It touches `users/{uid}` for these two uids and nothing else: not their
// workspaces, not any other account. One of the two has no user document at
// all (it never returned from the bounce), and the write creates it holding
// only the record. Each write is a transaction that re-reads the document and
// writes nothing if a record arrived since the plan.
//
// A one-shot: deleted by the commit that confirms its re-run plans nothing.

import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { getAuth } from 'firebase-admin/auth'
import {
  authFacts,
  hasRecord,
  planUserAcquisition,
} from './lib/account-acquisition-backfill.mjs'
import { parseDeployArgs } from './lib/deploy-args.mjs'
import { connectFirestore } from './lib/firestore-backfill.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = join(here, '..', '..')
const FIELD = 'acquisition'

/** The accounts AGL-3355 found without a record, and no others. */
const UIDS = ['mSzttXqhnPaAu6VOMVVj6PqHmQU2', 'h2IZUsP7SSfRXtIUiaEnMmbzn4m2']

const args = parseDeployArgs({
  command: 'backfill-bounced-account-acquisition',
  summary:
    "Stamp acquisition: { source: 'unknown' } on the two accounts the /signin " +
    'consent bounce left without one. Writes to the named project with --apply.',
  effect: { gerund: 'writing', past: 'WRITTEN', failure: 'could not run' },
  flags: [
    { flag: '--apply', key: 'apply', describe: 'Write.' },
    { flag: '--dry-run', key: 'dryRun', describe: 'Plan and print only (the default).' },
  ],
})
if (args.apply && args.dryRun) {
  console.error('--apply and --dry-run together: pick one. NOTHING WAS WRITTEN.')
  process.exit(2)
}
const apply = Boolean(args.apply)

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

async function main() {
  const db = connectFirestore({ repoRoot: REPO_ROOT, apply })
  const nowMs = Date.now()

  const plans = []
  for (const uid of UIDS) {
    const ref = db.collection('users').doc(uid)
    const snapshot = await ref.get()
    const existing = snapshot.exists ? snapshot.get(FIELD) : undefined
    const user = await getAuth()
      .getUser(uid)
      .catch(() => null)
    if (!user) {
      console.log(`  users/${uid}: no auth record in the project pool — left alone`)
      continue
    }
    if (hasRecord(existing)) {
      console.log(`  users/${uid}: already has a record — left alone`)
      continue
    }
    const record = planUserAcquisition({
      existing,
      auth: authFacts(user),
      firstDeviceLocation: await firstDeviceLocation(db, uid),
      nowMs,
    })
    if (!record) {
      console.log(`  users/${uid}: inside the live window — left alone`)
      continue
    }
    plans.push({ ref, uid, docExists: snapshot.exists, record })
  }

  console.log(`${plans.length} of ${UIDS.length} account(s) to stamp`)
  for (const plan of plans) {
    console.log(
      `  users/${plan.uid} (${plan.docExists ? 'document exists' : 'document will be CREATED'}), merge:`,
    )
    console.log(JSON.stringify({ [FIELD]: plan.record }, null, 2).replace(/^/gm, '    '))
  }

  if (!apply) {
    console.log('Dry run — nothing was written. Re-run with --apply.')
    return
  }
  let written = 0
  for (const plan of plans) {
    const wrote = await db.runTransaction(async (tx) => {
      const snapshot = await tx.get(plan.ref)
      if (snapshot.exists && hasRecord(snapshot.get(FIELD))) return false
      tx.set(plan.ref, { [FIELD]: plan.record }, { merge: true })
      return true
    })
    if (wrote) written += 1
    console.log(`  users/${plan.uid}: ${wrote ? 'WRITTEN' : 'gained a record while this ran — left alone'}`)
  }
  console.log(`wrote ${written} record(s)`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
