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

// Leads move to the org (AGL-3276). See `docs/CRM_ORG_LEADS_BACKFILL.md`.
//
//   GOOGLE_CLOUD_PROJECT=aglyn-main node tools/scripts/backfill-org-leads.mjs
//   GOOGLE_CLOUD_PROJECT=aglyn-main node tools/scripts/backfill-org-leads.mjs --org=<orgId>
//   GOOGLE_CLOUD_PROJECT=aglyn-main node tools/scripts/backfill-org-leads.mjs --org=<orgId> --apply
//
// DRY RUN BY DEFAULT. `--apply` writes. Every decision is
// `lib/org-lead-backfill.mjs`'s and pinned by its test; this file reads,
// prints and writes.
//
// ## What it does, per org
//
// Every `hosts/{hostId}/leads/{personKey}` under the org is collected and
// grouped by its id. A lead id is `sha256(normalizeContactEmail(email))`, so
// one key held by two sites is ONE person who was two records — and the fold
// is the whole point of the migration. The merged row is written to
// `orgs/{orgId}/leads/{personKey}`, each site row is copied to
// `orgs/{orgId}/crmBackfillArchive/leads~{hostId}~{personKey}` and then
// deleted, and every folded row leaves a timeline note naming the site it
// came from.
//
// Enrollments, activities and tasks that name a lead keep naming it: the id
// does not change, because it never depended on the site. What DOES change is
// that two enrollments can now collide on one record — the one furthest along
// is kept and the duplicate refused, the rule the enroll gate already applies.
//
// ## Ordering, and why it is not optional
//
// It must run only once the AGL-3275 promotion is LIVE and its rules and
// indexes are deployed. A deployment still on the old model rebuilds the host
// rows behind this script, and the live code's own carry (`leadForWrite`)
// will have moved some rows already — which is why a key the org already
// holds is left alone rather than overwritten with a fold of the rows it was
// built from.
//
// Run between sends, never inside the send job's window, and tell whoever is
// running Sequences first.
//
// ## Idempotence
//
// A second run finds no host rows and plans nothing. An interruption leaves a
// partially moved org, which a re-run finishes: the archive id is keyed by
// site and person, and a re-archived row is the same row.

import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  archiveIdFor,
  foldNoteIdFor,
  pickEnrollment,
  planOrgLeads,
} from './lib/org-lead-backfill.mjs'
import { parseDeployArgs } from './lib/deploy-args.mjs'
import { collect, commitAll, connectFirestore } from './lib/firestore-backfill.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = join(here, '..', '..')

const args = parseDeployArgs({
  command: 'backfill-org-leads',
  summary:
    'Move every lead from `hosts/{hostId}/leads` to `orgs/{orgId}/leads`, ' +
    'folding the rows that share a person key into one record and archiving ' +
    'what it replaces. Writes to the named project with --apply.',
  effect: { gerund: 'writing', past: 'WRITTEN', failure: 'could not run' },
  flags: [
    { flag: '--apply', key: 'apply', describe: 'Write. Without it, a dry run.' },
    { flag: '--org', key: 'org', value: 'string', describe: 'Limit to one org id.' },
    {
      flag: '--no-archive',
      key: 'noArchive',
      describe: 'Skip the archive copy of each moved row. Not recommended.',
    },
  ],
})
const apply = Boolean(args.apply)
const onlyOrg = args.org
const archive = !args.noArchive

const db = connectFirestore({ repoRoot: REPO_ROOT, apply })

/** Which hosts belong to which org, by the index the runtime resolves a host through. */
async function hostsByOrg() {
  const byOrg = new Map()
  for (const row of await collect(db.collection('hostIndex'))) {
    const orgId = row.data?.orgId
    if (typeof orgId !== 'string' || !orgId) continue
    if (!byOrg.has(orgId)) byOrg.set(orgId, [])
    byOrg.get(orgId).push(row.id)
  }
  for (const hosts of byOrg.values()) hosts.sort()
  return byOrg
}

/** Every site row under this org's hosts, grouped by person key. */
async function siteLeads(hostIds) {
  const byKey = new Map()
  for (const hostId of hostIds) {
    const rows = await collect(db.collection('hosts').doc(hostId).collection('leads'))
    for (const row of rows) {
      if (!byKey.has(row.id)) byKey.set(row.id, [])
      byKey.get(row.id).push({ hostId, id: row.id, data: row.data })
    }
  }
  return byKey
}

/** The enrollments naming each lead, so a fold can refuse the duplicate. */
async function enrollmentsByLead(orgId) {
  const byLead = new Map()
  const rows = await collect(db.collection('orgs').doc(orgId).collection('flowEnrollments'))
  for (const row of rows) {
    const leadId = row.data?.leadId
    if (typeof leadId !== 'string' || !leadId) continue
    if (!byLead.has(leadId)) byLead.set(leadId, [])
    byLead.get(leadId).push(row)
  }
  return byLead
}

async function run() {
  const byOrg = await hostsByOrg()
  const orgIds = [...byOrg.keys()].sort().filter((id) => !onlyOrg || id === onlyOrg)
  if (onlyOrg && !orgIds.length) {
    console.error(`No org ${onlyOrg} in hostIndex — nothing to do.`)
    process.exitCode = 1
    return
  }

  let totalMoved = 0
  let totalFolded = 0
  let totalRefused = 0

  for (const orgId of orgIds) {
    const hostIds = byOrg.get(orgId) ?? []
    const leadsByKey = await siteLeads(hostIds)
    if (!leadsByKey.size) continue

    const orgRef = db.collection('orgs').doc(orgId)
    const orgLeadIds = new Set((await collect(orgRef.collection('leads'))).map((row) => row.id))
    const plan = planOrgLeads({ leadsByKey, orgLeadIds, nowMs: Date.now() })

    const enrollments = await enrollmentsByLead(orgId)
    const refusals = []
    for (const write of plan.writes) {
      const held = enrollments.get(write.id) ?? []
      if (held.length < 2) continue
      const { refuse } = pickEnrollment(held)
      for (const row of refuse) refusals.push(row)
    }

    console.log(
      `${orgId}: ${plan.writes.length} lead(s) to write, ${plan.folded.length} folded from ` +
        `two or more sites, ${plan.deletes.length} site row(s) to remove` +
        (refusals.length ? `, ${refusals.length} duplicate enrollment(s) to refuse` : ''),
    )
    for (const fold of plan.folded) {
      console.log(`    fold ${fold.personKey} ← ${fold.sites.join(' + ')}`)
    }

    totalMoved += plan.writes.length
    totalFolded += plan.folded.length
    totalRefused += refusals.length

    if (!apply) continue

    const writes = []
    for (const write of plan.writes) {
      writes.push({ kind: 'set', ref: orgRef.collection('leads').doc(write.id), value: write.data })
      for (const activity of write.activities) {
        writes.push({
          kind: 'set',
          ref: orgRef.collection('crmActivities').doc(foldNoteIdFor(write.id, activity.hostId)),
          value: activity,
        })
      }
    }
    if (archive) {
      for (const row of plan.archives) {
        writes.push({
          kind: 'set',
          ref: orgRef.collection('crmBackfillArchive').doc(archiveIdFor(row.hostId, row.id)),
          value: {
            collection: 'leads',
            hostId: row.hostId,
            leadId: row.id,
            archivedAtMs: Date.now(),
            document: row.data,
          },
        })
      }
    }
    for (const row of plan.deletes) {
      writes.push({ kind: 'delete', ref: db.collection('hosts').doc(row.hostId).collection('leads').doc(row.id) })
    }
    /*
     * A refused enrollment is STOPPED, not deleted: the record of having been
     * enrolled is the thing that stops the person being enrolled again, and
     * deleting it would let the next sweep re-add them.
     */
    for (const row of refusals) {
      writes.push({
        kind: 'set',
        ref: orgRef.collection('flowEnrollments').doc(row.id),
        value: { status: 'stopped', stoppedReason: 'duplicate-of-folded-lead', stoppedAtMs: Date.now() },
      })
    }
    await commitAll(db, writes)
  }

  console.log(
    `\n${apply ? 'WRITTEN' : 'DRY RUN'}: ${totalMoved} lead(s) moved to the org, ` +
      `${totalFolded} folded from two or more sites, ${totalRefused} duplicate enrollment(s) refused.`,
  )
  if (!apply) console.log('Nothing was written. Re-run with --apply.')
}

await run()
