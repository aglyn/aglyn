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

// Campaigns and their emails move to the org (AGL-3273). See
// `docs/MARKETING_ORG_CAMPAIGNS_BACKFILL.md`.
//
//   GOOGLE_CLOUD_PROJECT=aglyn-main node tools/scripts/backfill-org-campaigns.mjs
//   GOOGLE_CLOUD_PROJECT=aglyn-main node tools/scripts/backfill-org-campaigns.mjs --org=<orgId>
//   GOOGLE_CLOUD_PROJECT=aglyn-main node tools/scripts/backfill-org-campaigns.mjs --org=<orgId> --org-wide --apply
//
// DRY RUN BY DEFAULT. `--apply` writes. Every decision is
// `lib/org-campaign-backfill.mjs`'s and pinned by its test; this file reads,
// prints and writes.
//
// ## What it does, per org
//
// Every site's `hosts/{hostId}/emailCampaigns` (containers),
// `hosts/{hostId}/campaigns` (sends, with their `reports/*`) and
// `hosts/{hostId}/campaignSequenceReports` is copied to the same id under
// `orgs/{orgId}/…`, stamped with the scope the product now reads, archived
// to `orgs/{orgId}/marketingBackfillArchive/{kind~hostId~id}`, and then
// removed from the site. `--org-wide` places the org's moved containers on
// every site instead of the one each came from.
//
// ## Ordering, and why it is not optional
//
// Run only once the promotion carrying AGL-3273 is LIVE and its rules are
// deployed. Until then the live console reads and writes the site paths, and
// would recreate what this removes. From the moment it is live, the
// scheduled-send cron leaves any send still under a site alone — so run this
// promptly after the deploy, or a send scheduled in that window waits for it.
//
// ## Idempotence
//
// A second run finds no site documents and plans nothing. An interrupted run
// leaves some documents copied and not yet removed; a re-run merges them
// (the org copy wins) and finishes the removal. Every write is ordered org
// copy, then archive, then delete, so nothing is deleted before its copy is
// committed.

import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { archiveIdFor, planOrgCampaigns } from './lib/org-campaign-backfill.mjs'
import { parseDeployArgs } from './lib/deploy-args.mjs'
import { collect, commitAll, connectFirestore } from './lib/firestore-backfill.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = join(here, '..', '..')

const args = parseDeployArgs({
  command: 'backfill-org-campaigns',
  summary:
    'Move every campaign container, email send and sequence rollup from ' +
    '`hosts/{hostId}/…` to `orgs/{orgId}/…` under the same ids, stamping the ' +
    'site scope and archiving what it moves. Writes to the named project with --apply.',
  effect: { gerund: 'writing', past: 'WRITTEN', failure: 'could not run' },
  flags: [
    { flag: '--apply', key: 'apply', describe: 'Write. Without it, a dry run.' },
    { flag: '--org', key: 'org', value: 'string', describe: 'Limit to one org id.' },
    {
      flag: '--org-wide',
      key: 'orgWide',
      describe: "Place the moved containers on every site (`['org']`) instead of their own.",
    },
    {
      flag: '--no-archive',
      key: 'noArchive',
      describe: 'Skip the archive copy of each moved document. Not recommended.',
    },
  ],
})
const apply = Boolean(args.apply)
const onlyOrg = args.org
const orgWide = Boolean(args.orgWide)
const archive = !args.noArchive

if (orgWide && !onlyOrg) {
  console.error('--org-wide changes who sees each campaign; name the org it applies to with --org.')
  process.exit(2)
}

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

/** Every site document of one collection under these hosts. */
async function siteRows(hostIds, collection) {
  const rows = []
  for (const hostId of hostIds) {
    for (const row of await collect(db.collection('hosts').doc(hostId).collection(collection))) {
      rows.push({ hostId, id: row.id, data: row.data })
    }
  }
  return rows
}

/** The site sends, each with its `reports/*` documents. */
async function siteSends(hostIds) {
  const rows = await siteRows(hostIds, 'campaigns')
  for (const row of rows) {
    row.reports = await collect(
      db.collection('hosts').doc(row.hostId).collection('campaigns').doc(row.id).collection('reports'),
    )
  }
  return rows
}

async function orgRows(orgRef, collection) {
  return new Map((await collect(orgRef.collection(collection))).map((row) => [row.id, row.data]))
}

function siteRef(write) {
  const host = db.collection('hosts').doc(write.hostId)
  if (write.kind === 'campaignReports') {
    return host.collection('campaigns').doc(write.id).collection('reports').doc(write.reportId)
  }
  return host.collection(write.kind).doc(write.id)
}

async function run() {
  const byOrg = await hostsByOrg()
  const orgIds = [...byOrg.keys()].sort().filter((id) => !onlyOrg || id === onlyOrg)
  if (onlyOrg && !orgIds.length) {
    console.error(`No org ${onlyOrg} in hostIndex — nothing to do.`)
    process.exitCode = 1
    return
  }

  const totals = { containers: 0, sends: 0, sequenceReports: 0, deferred: 0, refused: 0 }

  for (const orgId of orgIds) {
    const hostIds = byOrg.get(orgId) ?? []
    const [containers, sends, sequenceReports] = [
      await siteRows(hostIds, 'emailCampaigns'),
      await siteSends(hostIds),
      await siteRows(hostIds, 'campaignSequenceReports'),
    ]
    if (!containers.length && !sends.length && !sequenceReports.length) continue

    const orgRef = db.collection('orgs').doc(orgId)
    const plan = planOrgCampaigns({
      containers,
      sends,
      sequenceReports,
      orgContainers: await orgRows(orgRef, 'emailCampaigns'),
      orgSends: await orgRows(orgRef, 'campaigns'),
      orgSequenceReports: await orgRows(orgRef, 'campaignSequenceReports'),
      orgWide,
      nowMs: Date.now(),
    })

    console.log(
      `${orgId} (${hostIds.length} site(s)): ${plan.containers.length} campaign(s), ` +
        `${plan.sends.length} email(s), ${plan.sequenceReports.length} sequence rollup(s) to move` +
        (plan.deferred.length ? `, ${plan.deferred.length} deferred` : '') +
        (plan.refused.length ? `, ${plan.refused.length} REFUSED` : ''),
    )
    for (const row of plan.containers) {
      console.log(
        `    campaign ${row.id} ← ${row.hostId} "${row.data.name ?? ''}" visibleTo=${JSON.stringify(row.data.visibleTo)}` +
          (row.merged ? ' (merged into the org copy)' : ''),
      )
    }
    for (const row of plan.deferred) {
      console.log(`    DEFERRED ${row.kind} ${row.id} on ${row.hostId}: ${row.reason} — re-run once it settles`)
    }
    for (const row of plan.refused) {
      console.log(`    REFUSED ${row.kind} ${row.id}: held by ${row.hostIds.join(' + ')} — settle by hand`)
    }

    totals.containers += plan.containers.length
    totals.sends += plan.sends.length
    totals.sequenceReports += plan.sequenceReports.length
    totals.deferred += plan.deferred.length
    totals.refused += plan.refused.length

    if (!apply) continue

    const copies = []
    for (const row of plan.containers) {
      copies.push({ kind: 'set', ref: orgRef.collection('emailCampaigns').doc(row.id), value: row.data })
    }
    for (const row of plan.sends) {
      const sendRef = orgRef.collection('campaigns').doc(row.id)
      copies.push({ kind: 'set', ref: sendRef, value: row.data })
      for (const report of row.reports) {
        copies.push({ kind: 'set', ref: sendRef.collection('reports').doc(report.id), value: report.data })
      }
    }
    for (const row of plan.sequenceReports) {
      copies.push({
        kind: 'set',
        ref: orgRef.collection('campaignSequenceReports').doc(row.id),
        value: row.data,
      })
    }
    const archives = archive
      ? plan.archives.map((row) => ({
          kind: 'set',
          ref: orgRef.collection('marketingBackfillArchive').doc(archiveIdFor(row.kind, row.hostId, row.id)),
          value: {
            collection: row.kind,
            hostId: row.hostId,
            documentId: row.id,
            archivedAtMs: row.archivedAtMs,
            document: row.data ?? {},
          },
        }))
      : []
    const deletes = plan.deletes.map((row) => ({ kind: 'delete', ref: siteRef(row) }))

    // Copies, then archives, then deletes — in that order across batches.
    await commitAll(db, [...copies, ...archives, ...deletes])
  }

  console.log(
    `\n${apply ? 'WRITTEN' : 'DRY RUN'}: ${totals.containers} campaign(s), ${totals.sends} email(s) and ` +
      `${totals.sequenceReports} sequence rollup(s) moved to their org; ` +
      `${totals.deferred} deferred, ${totals.refused} refused.`,
  )
  if (!apply) console.log('Nothing was written. Re-run with --apply.')
  if (totals.deferred || totals.refused) process.exitCode = 1
}

await run()
