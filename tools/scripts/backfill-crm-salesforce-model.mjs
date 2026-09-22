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

// The one-record migration (AGL-3235). See `docs/CRM_SALESFORCE_BACKFILL.md`.
//
//   GOOGLE_CLOUD_PROJECT=aglyn-main node tools/scripts/backfill-crm-salesforce-model.mjs
//   GOOGLE_CLOUD_PROJECT=aglyn-main node tools/scripts/backfill-crm-salesforce-model.mjs --org=<orgId>
//   GOOGLE_CLOUD_PROJECT=aglyn-main node tools/scripts/backfill-crm-salesforce-model.mjs --org=<orgId> --apply
//
// DRY RUN BY DEFAULT. `--apply` writes. Every decision is
// `lib/one-record-backfill.mjs`'s and pinned by its test; this file
// reads, prints and writes.
//
// ## What it does, per org, in one sweep of the contacts
//
// Every contact is classified: a DUPLICATE OF A LEAD — a person with nothing
// but a capture behind them — or a RELATIONSHIP — a member, a buyer, a
// subscriber, somebody with a deal or a stage past Lead. A duplicate is
// folded onto the lead of every site that captured them or enrolled them in
// a sequence (created where the site holds none), its enrollments,
// activities and tasks are pointed at the lead, the contact is copied whole
// to `orgs/{orgId}/crmBackfillArchive/{contactId}`, and then the contact and
// its address-index row are deleted. A relationship stands; an open lead the
// site holds for the address is closed as converted onto it, and the lead's
// enrollments, activities and tasks follow to the contact. Companies whose
// contacts changed are recounted.
//
// ## Idempotence
//
// A second run finds every duplicate gone and every open lead closed, and
// plans nothing. A lead is created with `create()`, which refuses an
// existing document; a fold writes only the fields the lead lacks; a stamp
// touches only an open lead. An interruption leaves a partially moved org,
// which a re-run finishes.
//
// ## What it does NOT do
//
// It emits no events and runs no plugin listener: the records are moved by
// hand here, exactly as the conversion's hand-off would move them, because
// a listener that ran the live sequence runtime against a half-moved corpus
// would be the one thing this migration must not do while sends are
// scheduled. It assigns no owner and bumps no `updatedAt` on a lead it
// merely fills in.

import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { FieldValue } from 'firebase-admin/firestore'
import {
  DELETE_FIELD,
  FIELDS,
  planContact,
  preconditionsForTree,
} from './lib/one-record-backfill.mjs'
import { planCompanyCounts, tallyCompanyMirrors } from './lib/crm-lifecycle-backfill.mjs'
import { parseDeployArgs } from './lib/deploy-args.mjs'
import { collect, commitAll, connectFirestore } from './lib/firestore-backfill.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = join(here, '..', '..')

const args = parseDeployArgs({
  command: 'backfill-crm-salesforce-model',
  summary:
    'Move the CRM to the one-record model: fold every contact that is only a ' +
    'lead onto its lead and delete it, close every open lead whose person is ' +
    'already a contact, and point enrollments, activities and tasks at the ' +
    'record the person is. Writes to the named project with --apply.',
  effect: { gerund: 'writing', past: 'WRITTEN', failure: 'could not run' },
  flags: [
    { flag: '--apply', key: 'apply', describe: 'Write. Without it, a dry run.' },
    { flag: '--org', key: 'org', value: 'string', describe: 'Limit to one org id.' },
    {
      flag: '--no-archive',
      key: 'noArchive',
      describe: 'Skip the archive copy of each deleted contact. Not recommended.',
    },
  ],
})
const apply = Boolean(args.apply)
const onlyOrg = args.org
const archive = !args.noArchive

const IN_LIMIT = 30

/*==========================================
 * READS
 *=========================================*/

/** Which hosts belong to which org, by the index the runtime resolves a host through. */
async function hostsByOrg(db) {
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

/** `consentGroupForHost`, restated: the group a host's facet is filed under, or the host itself. */
function groupResolver(org) {
  const groups = Array.isArray(org?.consentGroups) ? org.consentGroups : []
  return (hostId) => {
    const group = groups.find((entry) => Array.isArray(entry?.hostIds) && entry.hostIds.includes(hostId))
    return group?.id ? String(group.id) : hostId
  }
}

/** The rows of a collection that name any of `ids` in `field`, in `in`-sized chunks. */
async function rowsNaming(collectionRef, field, ids) {
  const found = new Map()
  const unique = [...new Set(ids.filter(Boolean))]
  for (let start = 0; start < unique.length; start += IN_LIMIT) {
    const chunk = unique.slice(start, start + IN_LIMIT)
    const page = await collectionRef.where(field, 'in', chunk).get()
    for (const snapshot of page.docs) found.set(snapshot.id, { id: snapshot.id, data: snapshot.data() ?? {} })
  }
  return [...found.values()]
}

/*==========================================
 * THE RUN
 *=========================================*/

const REASON_LABELS = {
  member: 'member account',
  order: 'order',
  newsletter: 'newsletter opt-in',
  deal: 'deal',
}

function reasonLabel(reason) {
  return REASON_LABELS[reason] ?? (reason.startsWith('stage:') ? `stage ${reason.slice(6)}` : reason)
}

function withDeletes(value) {
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [key, entry === DELETE_FIELD ? FieldValue.delete() : entry]),
  )
}

async function runOrg(db, orgId, hostIds, nowMs, totals) {
  const orgRef = db.collection('orgs').doc(orgId)
  const org = (await orgRef.get()).data() ?? {}
  const groupFor = groupResolver(org)
  const [contacts, enrollments, deals] = await Promise.all([
    collect(orgRef.collection('contacts')),
    collect(orgRef.collection('outreachEnrollments')),
    collect(orgRef.collection('deals')),
  ])
  const leadsByHost = new Map()
  for (const hostId of hostIds) {
    const leads = await collect(db.collection('hosts').doc(hostId).collection('leads'))
    leadsByHost.set(hostId, new Map(leads.map((row) => [row.id, row.data])))
  }
  const contactsWithDeals = new Set(deals.map((row) => String(row.data?.contactId ?? '')).filter(Boolean))

  console.log(`\norg ${orgId}: ${contacts.length} contact(s), ${hostIds.length} site(s), ${enrollments.length} enrollment(s)`)
  const writes = []
  const report = { duplicates: 0, created: 0, merged: 0, relationships: 0, closed: 0, followed: 0, left: {} }
  const remaining = []

  for (const contact of contacts) {
    const activitiesRef = orgRef.collection('crmActivities')
    const tasksRef = orgRef.collection('crmTasks')
    // Classified first without its rows; the rows that name the person, by
    // the contact and by the person key, are read only for a contact a plan
    // can move — the activities and tasks are the larger collections.
    const classified = planContact({
      contactId: contact.id,
      contact: contact.data,
      orgHostIds: hostIds,
      groupFor,
      leadsByHost,
      enrollments,
      activities: [],
      tasks: [],
      hasDeals: contactsWithDeals.has(contact.id),
      nowMs,
    })
    if (classified.kind !== 'duplicate-lead' && !(classified.kind === 'relationship' && classified.hosts.length)) {
      if (classified.kind !== 'relationship') report.left[classified.kind] = (report.left[classified.kind] ?? 0) + 1
      else report.relationships += 1
      remaining.push(contact.data)
      continue
    }
    const [activities, tasks] = await Promise.all([
      rowsNaming(activitiesRef, 'contactId', [contact.id]).then(async (byContact) =>
        classified.key ? [...byContact, ...(await rowsNaming(activitiesRef, 'leadId', [classified.key]))] : byContact,
      ),
      rowsNaming(tasksRef, 'contactId', [contact.id]).then(async (byContact) =>
        classified.key ? [...byContact, ...(await rowsNaming(tasksRef, 'leadId', [classified.key]))] : byContact,
      ),
    ])
    const plan = planContact({
      contactId: contact.id,
      contact: contact.data,
      orgHostIds: hostIds,
      groupFor,
      leadsByHost,
      enrollments,
      activities,
      tasks,
      hasDeals: contactsWithDeals.has(contact.id),
      nowMs,
    })

    if (plan.kind === 'relationship') {
      report.relationships += 1
      remaining.push(contact.data)
      for (const host of plan.hosts) {
        report.closed += 1
        const followed = host.follows.enrollments.length + host.follows.activities.length + host.follows.tasks.length
        report.followed += followed
        console.log(
          `  ${plan.email}  contact (${plan.reasons.map(reasonLabel).join(', ')}) — ` +
            `${apply ? 'closing' : 'would close'} its open lead on ${host.hostId} onto the contact` +
            (followed ? `; ${host.follows.enrollments.length} enrollment(s), ${host.follows.activities.length} activity(ies), ${host.follows.tasks.length} task(s) follow` : ''),
        )
        writes.push({
          kind: 'set',
          ref: db.collection('hosts').doc(host.hostId).collection('leads').doc(host.key),
          value: { ...host.stamp, updatedAt: FieldValue.serverTimestamp() },
        })
        for (const row of host.follows.enrollments) {
          writes.push({ kind: 'update', ref: orgRef.collection('outreachEnrollments').doc(row.id), value: { ...row.value, updatedAtMs: nowMs } })
        }
        for (const row of host.follows.activities) writes.push({ kind: 'update', ref: activitiesRef.doc(row.id), value: row.value })
        for (const row of host.follows.tasks) writes.push({ kind: 'update', ref: tasksRef.doc(row.id), value: row.value })
      }
      continue
    }

    // A duplicate of a lead.
    report.duplicates += 1
    const summary = plan.hosts.map((host) => `${host.hostId}: ${host.kind === 'create' ? 'create lead' : host.kind === 'merge' ? `fill ${Object.keys(host.merge).join(', ')}` : 'lead complete'}`)
    const followed = plan.follows.enrollments.length + plan.follows.activities.length + plan.follows.tasks.length
    report.followed += followed
    console.log(
      `  ${plan.email}  lead — ${apply ? 'folding' : 'would fold'} onto ${summary.join('; ')}` +
        (followed ? `; ${plan.follows.enrollments.length} enrollment(s), ${plan.follows.activities.length} activity(ies), ${plan.follows.tasks.length} task(s) follow` : '') +
        `; ${apply ? 'deleting' : 'would delete'} the contact${archive ? ' (archived first)' : ''}`,
    )
    for (const host of plan.hosts) {
      const leadRef = db.collection('hosts').doc(host.hostId).collection('leads').doc(host.key)
      if (host.kind === 'create') {
        report.created += 1
        writes.push({ kind: 'create', ref: leadRef, value: { ...host.row, createdAt: FieldValue.serverTimestamp() } })
      } else if (host.kind === 'merge') {
        report.merged += 1
        writes.push({ kind: 'update', ref: leadRef, value: host.merge })
      }
    }
    for (const row of plan.follows.enrollments) {
      writes.push({ kind: 'update', ref: orgRef.collection('outreachEnrollments').doc(row.id), value: { ...row.value, updatedAtMs: nowMs } })
    }
    for (const row of plan.follows.activities) writes.push({ kind: 'update', ref: activitiesRef.doc(row.id), value: withDeletes(row.value) })
    for (const row of plan.follows.tasks) writes.push({ kind: 'update', ref: tasksRef.doc(row.id), value: withDeletes(row.value) })
    if (archive) {
      writes.push({
        kind: 'set',
        ref: orgRef.collection(FIELDS.archive).doc(contact.id),
        value: { ...contact.data, archivedAtMs: nowMs, archivedBy: 'backfill-crm-salesforce-model', leadKey: plan.key },
      })
    }
    writes.push({ kind: 'delete', ref: orgRef.collection('contacts').doc(contact.id) })
    writes.push({ kind: 'delete', ref: orgRef.collection(FIELDS.emailIndex).doc(plan.key) })
  }

  const left = Object.entries(report.left).map(([kind, count]) => `${count} ${kind}`).join(', ')
  console.log(
    `  ${apply ? 'moving' : 'would move'} ${report.duplicates} duplicate contact(s) (${report.created} lead(s) created, ${report.merged} filled in)` +
      `; ${report.relationships} relationship(s) kept, ${report.closed} open lead(s) closed onto them` +
      `; ${report.followed} record(s) follow` +
      (left ? `; left: ${left}` : ''),
  )
  totals.duplicates += report.duplicates
  totals.created += report.created
  totals.closed += report.closed
  totals.followed += report.followed
  if (apply && writes.length) await commitAll(db, writes)

  // Companies whose people changed are recounted from what remains.
  const companies = await collect(orgRef.collection('companies'))
  const counts = planCompanyCounts(companies, tallyCompanyMirrors(remaining))
  if (counts.drift.length) {
    console.log(`  companies: ${counts.drift.length} count(s) ${apply ? 'fixed' : 'would be fixed'}`)
    for (const row of counts.drift) {
      console.log(`      ${row.name} (${row.companyId.slice(0, 12)}…)  ${row.stored === null ? 'absent' : row.stored} → ${row.counted}`)
    }
    totals.companies += counts.drift.length
    if (apply) {
      await commitAll(
        db,
        counts.drift.map((row) => ({
          kind: 'update',
          ref: orgRef.collection('companies').doc(row.companyId),
          value: { contactsCount: row.counted },
        })),
      )
    }
  }
}

async function run() {
  const gate = preconditionsForTree(REPO_ROOT)
  console.log(`preconditions: ${gate.ok ? 'OK' : 'REFUSED'} — ${gate.why}`)
  if (apply && !gate.ok) {
    console.error('\nREFUSING --apply until the preconditions above hold. NOTHING WAS WRITTEN.')
    process.exit(2)
  }
  const db = connectFirestore({ repoRoot: REPO_ROOT, apply })
  const nowMs = Date.now()
  const byOrg = await hostsByOrg(db)
  const orgIds = onlyOrg
    ? [onlyOrg]
    : (await db.collection('orgs').select().get()).docs.map((snapshot) => snapshot.id)
  const totals = { orgs: 0, duplicates: 0, created: 0, closed: 0, followed: 0, companies: 0 }
  for (const orgId of orgIds) {
    if (onlyOrg && !(await db.collection('orgs').doc(orgId).get()).exists) {
      console.log(`org ${orgId}: does not exist`)
      continue
    }
    totals.orgs += 1
    await runOrg(db, orgId, byOrg.get(orgId) ?? [], nowMs, totals)
  }
  const verb = apply ? 'Wrote' : 'Dry run'
  console.log(
    `\n${verb}: ${totals.duplicates} duplicate contact(s) folded across ${totals.orgs} org(s)` +
      ` (${totals.created} lead(s) created); ${totals.closed} open lead(s) closed onto their contact` +
      `; ${totals.followed} record(s) followed; ${totals.companies} company count(s) fixed.`,
  )
  if (!apply) console.log('  Re-run with --apply to write.\n')
}

await run()
process.exit(0)
