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

// The activity rollup backfill (AGL-4123).
//
//   GOOGLE_CLOUD_PROJECT=aglyn-main node tools/scripts/backfill-crm-activity-company.mjs
//   GOOGLE_CLOUD_PROJECT=aglyn-main node tools/scripts/backfill-crm-activity-company.mjs --org=<orgId>
//   GOOGLE_CLOUD_PROJECT=aglyn-main node tools/scripts/backfill-crm-activity-company.mjs --org=<orgId> --apply
//
// DRY RUN BY DEFAULT, and it prints every row it would change, before and
// after. `--apply` writes. What a company's timeline shows is what its owner
// reads, so a production run is one somebody has read the dry run of and said
// yes to. Every decision is `lib/activity-company-backfill.mjs`'s and
// pinned by its test; this file reads, prints and writes.
//
// ## What it does
//
// Every activity about a deal or a contact that names no company gets the
// company it rolls up to, as the writers stamp one now: the deal's, else the
// contact's. Only `companyId` and `updatedAt` are written, the second so an
// integration syncing by `updatedAfter` sees the row move.
//
// ## Idempotence
//
// A row that has its company is passed over, so a second run plans nothing.
// The write is an `update` of a row read moments before: a row deleted in
// between fails its batch rather than coming back.

import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { FieldValue } from 'firebase-admin/firestore'
import { describeActivityCompany, planActivityCompany } from './lib/activity-company-backfill.mjs'
import { parseDeployArgs } from './lib/deploy-args.mjs'
import { collect, commitAll, connectFirestore, everyDocument } from './lib/firestore-backfill.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = join(here, '..', '..')

/** How many records one read asks for. */
const GET_ALL_CHUNK = 200

const args = parseDeployArgs({
  command: 'backfill-crm-activity-company',
  summary:
    'Stamp the company an activity rolls up to on every activity about a deal or a contact ' +
    'that names none, printing each row before and after. Writes to the named project with --apply.',
  effect: { gerund: 'writing', past: 'WRITTEN', failure: 'could not run' },
  flags: [
    { flag: '--apply', key: 'apply', describe: 'Write. Without it, a dry run.' },
    { flag: '--org', key: 'org', value: 'string', describe: 'Limit to one org id.' },
  ],
})
const apply = Boolean(args.apply)
const onlyOrg = args.org

/** The documents of `collection` named by `ids`, as a map of id → data. */
async function readAll(db, collection, ids) {
  const wanted = [...new Set(ids)].filter((id) => id && !id.includes('/'))
  const found = new Map()
  for (let start = 0; start < wanted.length; start += GET_ALL_CHUNK) {
    const chunk = wanted.slice(start, start + GET_ALL_CHUNK)
    for (const snapshot of await db.getAll(...chunk.map((id) => collection.doc(id)))) {
      if (snapshot.exists) found.set(snapshot.id, snapshot.data() ?? {})
    }
  }
  return found
}

async function runOrg(db, orgId, totals) {
  const orgRef = db.collection('orgs').doc(orgId)
  const org = (await orgRef.get()).data() ?? {}
  const activities = orgRef.collection('crmActivities')
  const rows = []
  for await (const snapshot of everyDocument(activities)) {
    rows.push({ id: snapshot.id, data: snapshot.data() ?? {} })
  }
  const unnamed = rows.filter((row) => !row.data.companyId)
  const deals = await readAll(
    db,
    orgRef.collection('deals'),
    unnamed.map((row) => row.data.dealId),
  )
  const contacts = await readAll(
    db,
    orgRef.collection('contacts'),
    unnamed.map((row) => row.data.contactId),
  )

  const writes = []
  const report = { named: 0, 'no-record': 0, 'no-company': 0 }
  for (const { id, data: activity } of rows) {
    const plan = planActivityCompany({
      activity,
      deal: deals.get(activity.dealId),
      contact: contacts.get(activity.contactId),
      org,
    })
    if (plan.skip) {
      report[plan.skip] += 1
      continue
    }
    console.log(describeActivityCompany({ orgId, id, activity, plan }))
    writes.push({
      kind: 'update',
      ref: activities.doc(id),
      value: { companyId: plan.companyId, updatedAt: FieldValue.serverTimestamp() },
    })
  }

  console.log(
    `  ${apply ? 'stamping' : 'would stamp'} ${writes.length} of ${rows.length} activit${rows.length === 1 ? 'y' : 'ies'}` +
      ` — ${report.named} already name a company, ${report['no-record']} name no deal or contact,` +
      ` ${report['no-company']} have no company to find`,
  )
  totals.stamped += writes.length
  totals.seen += rows.length
  if (apply && writes.length) await commitAll(db, writes)
}

async function main() {
  const db = connectFirestore({ repoRoot: REPO_ROOT, apply })
  const orgIds = onlyOrg ? [onlyOrg] : (await collect(db.collection('orgs'))).map((row) => row.id).sort()
  const totals = { stamped: 0, seen: 0 }
  for (const orgId of orgIds) {
    console.log(`org ${orgId}`)
    await runOrg(db, orgId, totals)
  }
  console.log(
    `${apply ? 'stamped' : 'would stamp'} ${totals.stamped} of ${totals.seen} activit${totals.seen === 1 ? 'y' : 'ies'}` +
      ` across ${orgIds.length} org(s)` +
      (apply ? '' : ' — dry run, nothing written; re-run with --apply'),
  )
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
