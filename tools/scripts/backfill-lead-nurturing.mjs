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

// The Nurturing backfill (AGL-3446).
//
//   GOOGLE_CLOUD_PROJECT=aglyn-main node tools/scripts/backfill-lead-nurturing.mjs
//   GOOGLE_CLOUD_PROJECT=aglyn-main node tools/scripts/backfill-lead-nurturing.mjs --org=<orgId>
//   GOOGLE_CLOUD_PROJECT=aglyn-main node tools/scripts/backfill-lead-nurturing.mjs --org=<orgId> --apply
//
// DRY RUN BY DEFAULT: it prints, per org, how many leads it read, how many
// still stand in New, and how many it would move — by a sequence send and
// by a campaign send. `--apply` writes. Every decision is
// `lib/lead-nurturing-backfill.mjs`'s and pinned by its test.
//
// ## What it does
//
// A lead still in New that automated email has already reached moves to
// Nurturing: an Outreach enrollment made on it sent it an email, or a
// campaign send from a site that holds it has it in its reach record. The
// runtime makes the same move on every send from now on; this converges the
// leads reached before it did.
//
// ## Idempotence
//
// Only a lead in New is written, and the write is the move out of New, so a
// second run plans nothing. `updatedAt` is not touched: the move restates
// what the sends already did, it is not an edit.

import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseDeployArgs } from './lib/deploy-args.mjs'
import { commitAll, connectFirestore, collect, everyDocument } from './lib/firestore-backfill.mjs'
import {
  enrollmentLeadId,
  enrollmentSentEmail,
  leadStatus,
  planLeadNurturing,
} from './lib/lead-nurturing-backfill.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = join(here, '..', '..')

/** `CAMPAIGN_SENDS_COLLECTION`, `CAMPAIGN_REACH_SUBCOLLECTION`, `CAMPAIGN_REACH_DOC`. */
const CAMPAIGN_SENDS = 'campaigns'
const REACH_SUBCOLLECTION = 'reports'
const REACH_DOC = 'reached'

const args = parseDeployArgs({
  command: 'backfill-lead-nurturing',
  summary:
    'Move every lead still in New that a sequence email or a campaign email already ' +
    'reached to Nurturing. Writes to the named project with --apply.',
  effect: { gerund: 'writing', past: 'WRITTEN', failure: 'could not run' },
  flags: [
    { flag: '--apply', key: 'apply', describe: 'Write. Without it, a dry run that prints counts.' },
    { flag: '--org', key: 'org', value: 'string', describe: 'Limit to one org id.' },
  ],
})
const apply = Boolean(args.apply)
const onlyOrg = args.org

/** The leads an enrollment emailed, by id. */
async function emailedLeadIds(orgRef) {
  const ids = new Set()
  for await (const snapshot of everyDocument(orgRef.collection('outreachEnrollments'))) {
    const enrollment = snapshot.data() ?? {}
    const leadId = enrollmentLeadId(enrollment)
    if (leadId && enrollmentSentEmail(enrollment)) ids.add(leadId)
  }
  return ids
}

/** The sites whose campaign sends reached each address key. */
async function campaignHostsByKey(orgRef) {
  const byKey = new Map()
  for await (const send of everyDocument(orgRef.collection(CAMPAIGN_SENDS))) {
    const reach = await send.ref.collection(REACH_SUBCOLLECTION).doc(REACH_DOC).get()
    const keys = reach.exists ? reach.get('keys') : null
    if (!Array.isArray(keys) || !keys.length) continue
    const hostId = typeof send.get('hostId') === 'string' ? send.get('hostId') : ''
    for (const key of keys) {
      if (typeof key !== 'string') continue
      if (!byKey.has(key)) byKey.set(key, new Set())
      byKey.get(key).add(hostId)
    }
  }
  return byKey
}

async function runOrg(db, orgId, totals) {
  const orgRef = db.collection('orgs').doc(orgId)
  const [enrolled, campaignHosts] = await Promise.all([emailedLeadIds(orgRef), campaignHostsByKey(orgRef)])
  const report = { read: 0, new: 0, sequence: 0, campaign: 0 }
  const writes = []
  for await (const snapshot of everyDocument(orgRef.collection('leads'))) {
    const lead = snapshot.data() ?? {}
    report.read += 1
    if (leadStatus(lead) === 'new' && !lead.convertedContactId) report.new += 1
    const reason = planLeadNurturing(lead, {
      enrolled: enrolled.has(snapshot.id),
      campaignHosts: [...(campaignHosts.get(snapshot.id) ?? [])],
    })
    if (!reason) continue
    report[reason] += 1
    writes.push({ kind: 'set', ref: snapshot.ref, value: { status: 'nurturing' } })
  }
  console.log(
    `  ${report.read} lead(s) read, ${report.new} in New; ` +
      `${apply ? 'moving' : 'would move'} ${writes.length} to Nurturing ` +
      `(${report.sequence} by a sequence email, ${report.campaign} by a campaign email)`,
  )
  totals.read += report.read
  totals.new += report.new
  totals.moved += writes.length
  if (apply && writes.length) await commitAll(db, writes)
}

async function main() {
  const db = connectFirestore({ repoRoot: REPO_ROOT, apply })
  const orgIds = onlyOrg ? [onlyOrg] : (await collect(db.collection('orgs'))).map((row) => row.id).sort()
  const totals = { read: 0, new: 0, moved: 0 }
  for (const orgId of orgIds) {
    console.log(`org ${orgId}`)
    await runOrg(db, orgId, totals)
  }
  console.log(
    `${apply ? 'moved' : 'would move'} ${totals.moved} of ${totals.new} New lead(s) ` +
      `(${totals.read} read) across ${orgIds.length} org(s)` +
      (apply ? '' : ' — dry run, nothing written; re-run with --apply'),
  )
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
