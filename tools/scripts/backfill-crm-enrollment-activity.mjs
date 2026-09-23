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

// The enrollment-activity backfill (AGL-3274).
//
//   GOOGLE_CLOUD_PROJECT=aglyn-main node tools/scripts/backfill-crm-enrollment-activity.mjs
//   GOOGLE_CLOUD_PROJECT=aglyn-main node tools/scripts/backfill-crm-enrollment-activity.mjs --org=<orgId>
//   GOOGLE_CLOUD_PROJECT=aglyn-main node tools/scripts/backfill-crm-enrollment-activity.mjs --org=<orgId> --apply
//
// DRY RUN BY DEFAULT. `--apply` writes. Every decision is
// `lib/enrollment-activity-backfill.mjs`'s and pinned by its test; this
// file reads, prints and writes.
//
// ## What it does
//
// Every enrollment under `orgs/{orgId}/outreachEnrollments` made before the
// enroll route filed "Enrolled in <sequence>" on the person's record gets
// that entry on the lead — or on the contact, once the lead converted —
// at the enrollment's own creation time, under the id the route files it
// by, signed "Sequences", naming the campaigns the enrollment carried.
//
// ## Idempotence
//
// The id is the route's: `crmActivities/{id}` already there means the entry
// was filed — by the route, or by an earlier run — and nothing is planned.
// The write is a `create`, so a race with the route loses rather than
// overwrites.

import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { FieldValue } from 'firebase-admin/firestore'
import { parseDeployArgs } from './lib/deploy-args.mjs'
import { enrolledActivityId, planEnrollmentActivity } from './lib/enrollment-activity-backfill.mjs'
import { collect, commitAll, connectFirestore, everyDocument } from './lib/firestore-backfill.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = join(here, '..', '..')

/** How many activity references one existence read asks for. */
const GET_ALL_CHUNK = 200

const args = parseDeployArgs({
  command: 'backfill-crm-enrollment-activity',
  summary:
    'File "Enrolled in <sequence>" on the lead or contact for every sequence enrollment ' +
    'that has no such entry yet, at the enrollment’s creation time. ' +
    'Writes to the named project with --apply.',
  effect: { gerund: 'writing', past: 'WRITTEN', failure: 'could not run' },
  flags: [
    { flag: '--apply', key: 'apply', describe: 'Write. Without it, a dry run.' },
    { flag: '--org', key: 'org', value: 'string', describe: 'Limit to one org id.' },
  ],
})
const apply = Boolean(args.apply)
const onlyOrg = args.org

/** The live containers of one collection, by id → name. */
async function liveNames(collection) {
  const names = new Map()
  for (const row of await collect(collection)) {
    const name = String(row.data?.name ?? '').trim()
    if (name && !row.data?.deletedAt) names.set(row.id, name)
  }
  return names
}

/**
 * The names of an org's campaigns, by id: `orgs/{orgId}/emailCampaigns`,
 * read once per org. A container the org does not hold is looked for under
 * the enrollment's site (`hosts/{hostId}/emailCampaigns`), where every
 * container lived before campaigns became the org's — read once per site,
 * and only when an id is missing, so a run after the move reads no site.
 */
class CampaignNames {
  constructor(db, orgId) {
    this.db = db
    this.orgId = orgId
    this.org = null
    this.byHost = new Map()
  }

  async name(hostId, campaignId) {
    this.org ??= await liveNames(this.db.collection('orgs').doc(this.orgId).collection('emailCampaigns'))
    if (this.org.has(campaignId) || !hostId) return this.org.get(campaignId)
    if (!this.byHost.has(hostId)) {
      this.byHost.set(hostId, await liveNames(this.db.collection('hosts').doc(hostId).collection('emailCampaigns')))
    }
    return this.byHost.get(hostId).get(campaignId)
  }
}

/** Which of the given activity ids already exist, in chunks. */
async function existingActivityIds(db, orgId, ids) {
  const activities = db.collection('orgs').doc(orgId).collection('crmActivities')
  const existing = new Set()
  for (let start = 0; start < ids.length; start += GET_ALL_CHUNK) {
    const chunk = ids.slice(start, start + GET_ALL_CHUNK)
    const found = await db.getAll(...chunk.map((id) => activities.doc(id)))
    for (const snapshot of found) if (snapshot.exists) existing.add(snapshot.id)
  }
  return existing
}

async function runOrg(db, orgId, totals) {
  const orgRef = db.collection('orgs').doc(orgId)
  const campaignNames = new CampaignNames(db, orgId)
  const org = (await orgRef.get()).data() ?? {}
  const sequences = new Map()
  for (const row of await collect(orgRef.collection('outreachSequences'))) {
    sequences.set(row.id, String(row.data?.name ?? '').trim())
  }

  const enrollments = []
  for await (const snapshot of everyDocument(orgRef.collection('outreachEnrollments'))) {
    enrollments.push({ id: snapshot.id, data: snapshot.data() ?? {} })
  }
  const existing = await existingActivityIds(
    db,
    orgId,
    enrollments.map((row) => enrolledActivityId(row.id)),
  )

  const writes = []
  const report = { seen: enrollments.length, filed: 0, alreadyFiled: existing.size, skipped: 0 }
  for (const row of enrollments) {
    const hostId = String(row.data.hostId ?? '').trim()
    const names = []
    for (const id of Array.isArray(row.data.campaignIds) ? row.data.campaignIds : []) {
      names.push(await campaignNames.name(hostId, String(id)))
    }
    const plan = planEnrollmentActivity({
      enrollmentId: row.id,
      enrollment: row.data,
      sequenceName: sequences.get(String(row.data.sequenceId ?? '')) ?? '',
      campaignNames: names.filter(Boolean),
      org,
      existing: existing.has(enrolledActivityId(row.id)),
    })
    if (!plan) {
      if (!existing.has(enrolledActivityId(row.id))) report.skipped += 1
      continue
    }
    report.filed += 1
    writes.push({
      kind: 'create',
      ref: orgRef.collection('crmActivities').doc(plan.id),
      value: {
        ...plan.activity,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      },
    })
  }

  console.log(
    `  ${apply ? 'filing' : 'would file'} ${report.filed} entr${report.filed === 1 ? 'y' : 'ies'}` +
      ` of ${report.seen} enrollment(s) read — ${report.alreadyFiled} already filed, ${report.skipped} name no record`,
  )
  totals.filed += report.filed
  totals.seen += report.seen
  if (apply && writes.length) await commitAll(db, writes)
}

async function main() {
  const db = connectFirestore({ repoRoot: REPO_ROOT, apply })
  const orgIds = onlyOrg ? [onlyOrg] : (await collect(db.collection('orgs'))).map((row) => row.id).sort()
  const totals = { filed: 0, seen: 0 }
  for (const orgId of orgIds) {
    console.log(`org ${orgId}`)
    await runOrg(db, orgId, totals)
  }
  console.log(
    `${apply ? 'filed' : 'would file'} ${totals.filed} entr${totals.filed === 1 ? 'y' : 'ies'}` +
      ` for ${totals.seen} enrollment(s) across ${orgIds.length} org(s)` +
      (apply ? '' : ' — dry run, nothing written; re-run with --apply'),
  )
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
