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

// The lead form-campaign backfill (AGL-3458).
//
//   GOOGLE_CLOUD_PROJECT=aglyn-main node tools/scripts/backfill-lead-form-campaigns.mjs
//   GOOGLE_CLOUD_PROJECT=aglyn-main node tools/scripts/backfill-lead-form-campaigns.mjs --org=<orgId>
//   GOOGLE_CLOUD_PROJECT=aglyn-main node tools/scripts/backfill-lead-form-campaigns.mjs --org=<orgId> --apply
//
// DRY RUN BY DEFAULT: it prints, per org, the forms filed under a campaign,
// the leads those forms filed, and every lead it would re-file with the
// campaigns it would add. `--apply` writes. Every decision is
// `lib/lead-form-campaigns-backfill.mjs`'s and pinned by its test.
//
// ## What it does
//
// A lead a form filed is filed under the campaigns that form is filed under:
// `campaignIds` on the lead, and `scopedCampaignIds` — the keys the Leads
// list's Campaign filter queries — beside it. The lead door writes both on
// every capture from now on; this converges the leads filed before it did.
//
// ## Idempotence and races
//
// The write is an `arrayUnion` of only what the lead is missing, so a lead
// already filed plans nothing, a second run plans zero, and a campaign a live
// capture or a person adds while it runs is never overwritten. Nothing is
// removed. `updatedAt` is not touched: this restates where the lead's form
// already was, it is not an edit.
//
// ## Deploy order
//
// Run it AFTER the release that files new form leads under their campaigns
// is live, or leads captured between the run and the release need a second
// run.

import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { FieldValue } from 'firebase-admin/firestore'
import { parseDeployArgs } from './lib/deploy-args.mjs'
import { commitAll, connectFirestore } from './lib/firestore-backfill.mjs'
import {
  CAMPAIGNS_FIELD,
  FORM_LEAD_SOURCE_PREFIX,
  normalizeContainerIds,
  planLeadFormCampaigns,
  SCOPED_CAMPAIGNS_FIELD,
} from './lib/lead-form-campaigns-backfill.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = join(here, '..', '..')

/** Documents read per page of the forms scan. */
const PAGE = 300

const args = parseDeployArgs({
  command: 'backfill-lead-form-campaigns',
  summary:
    'File every lead a form filed under the campaigns that form is filed under. ' +
    'Writes to the named project with --apply.',
  effect: { gerund: 'writing', past: 'WRITTEN', failure: 'could not run' },
  flags: [
    { flag: '--apply', key: 'apply', describe: 'Write. Without it, a dry run that prints what it would write.' },
    { flag: '--org', key: 'org', value: 'string', describe: 'Limit to one org id.' },
  ],
})
const apply = Boolean(args.apply)
const onlyOrg = args.org

/** The organization a site belongs to, by its `hostIndex` mirror, else its own document. */
async function orgIdOf(db, hostId, cache) {
  if (cache.has(hostId)) return cache.get(hostId)
  const indexed = await db.collection('hostIndex').doc(hostId).get()
  let orgId = indexed.get('orgId')
  if (typeof orgId !== 'string' || !orgId) {
    orgId = (await db.collection('hosts').doc(hostId).get()).get('orgId')
  }
  const resolved = typeof orgId === 'string' && orgId ? orgId : null
  cache.set(hostId, resolved)
  return resolved
}

/** Every site form filed under a campaign: `Map<orgId, Map<formId, campaignIds>>`. */
async function campaignFormsByOrg(db) {
  const byOrg = new Map()
  const orgs = new Map()
  let cursor = null
  for (;;) {
    let page = db.collectionGroup('forms').orderBy('__name__').limit(PAGE)
    if (cursor) page = page.startAfter(cursor)
    const snapshot = await page.get()
    if (snapshot.empty) break
    for (const doc of snapshot.docs) {
      const segments = doc.ref.path.split('/')
      if (segments.length !== 4 || segments[0] !== 'hosts' || segments[2] !== 'forms') continue
      const campaigns = normalizeContainerIds(doc.get(CAMPAIGNS_FIELD))
      if (!campaigns.length) continue
      const orgId = await orgIdOf(db, segments[1], orgs)
      if (!orgId || (onlyOrg && orgId !== onlyOrg)) continue
      if (!byOrg.has(orgId)) byOrg.set(orgId, new Map())
      byOrg.get(orgId).set(doc.id, campaigns)
    }
    cursor = snapshot.docs[snapshot.docs.length - 1]
    if (snapshot.size < PAGE) break
  }
  return byOrg
}

async function runOrg(db, orgId, forms, totals) {
  const leadsRef = db.collection('orgs').doc(orgId).collection('leads')
  // One lead per person even when several of the org's forms filed it.
  const leads = new Map()
  for (const formId of forms.keys()) {
    const filed = await leadsRef.where('sources', 'array-contains', `${FORM_LEAD_SOURCE_PREFIX}${formId}`).get()
    for (const doc of filed.docs) leads.set(doc.id, doc)
  }
  const writes = []
  for (const doc of leads.values()) {
    const plan = planLeadFormCampaigns(doc.data() ?? {}, forms)
    if (!plan) continue
    console.log(
      `  ${apply ? 'filing' : 'would file'} ${doc.ref.path} under ` +
        `[${plan.campaignIds.join(', ') || 'no new campaign'}]` +
        (plan.scopedCampaignIds.length ? `, ${plan.scopedCampaignIds.length} filter key(s)` : ''),
    )
    writes.push({
      kind: 'update',
      ref: doc.ref,
      value: {
        ...(plan.campaignIds.length ? { [CAMPAIGNS_FIELD]: FieldValue.arrayUnion(...plan.campaignIds) } : {}),
        ...(plan.scopedCampaignIds.length
          ? { [SCOPED_CAMPAIGNS_FIELD]: FieldValue.arrayUnion(...plan.scopedCampaignIds) }
          : {}),
      },
    })
  }
  console.log(
    `  ${forms.size} form(s) in a campaign, ${leads.size} lead(s) they filed; ` +
      `${apply ? 'filing' : 'would file'} ${writes.length}`,
  )
  totals.forms += forms.size
  totals.leads += leads.size
  totals.filed += writes.length
  if (apply && writes.length) await commitAll(db, writes)
}

async function main() {
  const db = connectFirestore({ repoRoot: REPO_ROOT, apply })
  const byOrg = await campaignFormsByOrg(db)
  const totals = { forms: 0, leads: 0, filed: 0 }
  for (const orgId of [...byOrg.keys()].sort()) {
    console.log(`org ${orgId}`)
    await runOrg(db, orgId, byOrg.get(orgId), totals)
  }
  console.log(
    `${apply ? 'filed' : 'would file'} ${totals.filed} of ${totals.leads} form lead(s) ` +
      `from ${totals.forms} form(s) in a campaign across ${byOrg.size} org(s)` +
      (apply ? '' : ' — dry run, nothing written; re-run with --apply'),
  )
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
