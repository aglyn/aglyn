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

// The lifecycle-stage, historical-leads and company-count backfill
// (AGL-2631). See `docs/CRM_LIFECYCLE_BACKFILL.md`.
//
//   GOOGLE_CLOUD_PROJECT=aglyn-main node tools/scripts/backfill-crm-lifecycle-stages.mjs
//   GOOGLE_CLOUD_PROJECT=aglyn-main node tools/scripts/backfill-crm-lifecycle-stages.mjs --leads --companies
//   GOOGLE_CLOUD_PROJECT=aglyn-main node tools/scripts/backfill-crm-lifecycle-stages.mjs --leads --companies --apply
//   GOOGLE_CLOUD_PROJECT=aglyn-main node tools/scripts/backfill-crm-lifecycle-stages.mjs --leads --any-form
//
// DRY RUN BY DEFAULT. The stage pass always runs; `--leads` and
// `--companies` add the other two; `--apply` writes whichever passes ran.
//
// `--any-form` widens `--leads`: every form the host has ever held counts as
// a lead surface, not only the lead-routed ones. The people captured before
// lead routing existed came in through forms nobody could have switched on,
// and several of those forms are gone. It is for that backlog, once; the
// report names every form it counted only because of the flag. The oldest
// facets name no form at all — the timeline predates `refId` and `formId`
// — and record only that a form met the person (`sources.form`), so under
// the flag that kind is a lead surface too; the report counts those rows
// separately, as `by source kind (no form id)`.
//
// Credentials come from the root `.env` — the `FIREBASE_CLIENT_EMAIL` and
// `FIREBASE_PRIVATE_KEY` every Admin-SDK script here uses — and the project
// is named on the command line, because the key file does not carry it and
// a run against the wrong project must not be one environment variable
// away. `FIRESTORE_EMULATOR_HOST` skips the credential for a local proof.
//
// ## What runs, in one sweep of each org's contacts
//
// The contacts collection is read ONCE per org and every pass reads that
// sweep: the stage plan is per facet of each row, the lead plan is per host
// of the org against the same row, and the company tally is the mirror on
// it. The per-host inputs the lead pass needs — the routed forms, the
// submissions, the existing leads, the erasure rows — are read before the
// sweep, so a contact is never re-read for a host.
//
// ## Idempotence
//
// The stage pass writes only a facet that holds no usable stage, so the
// second run finds nothing to write. A lead is created with `create()`,
// which refuses an existing document, after the plan has already skipped
// every address the host holds a row for. A company count is SET to the
// re-derived figure, never incremented, so a re-run cannot compound. An
// interruption leaves a partially written org, which is the state a re-run
// finishes.
//
// ## What it does NOT do
//
// It emits no events: a stage stamped here fires no `contactChangedStage`
// automation and a lead created here fires nothing either, exactly as the
// commerce backfills reuse no live path. It assigns no owner: the site's
// default owner and the round-robin apply to captures as they arrive. And
// it bumps no `updatedAt`, so a list ordered by edits does not reshuffle to
// put every historical row on top.

import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { applicationDefault, cert, initializeApp } from 'firebase-admin/app'
import { FieldPath, FieldValue, getFirestore } from 'firebase-admin/firestore'
import { parseDeployArgs } from './lib/deploy-args.mjs'
import {
  FIELDS,
  hostLeadContext,
  planCompanyCounts,
  planFacetStages,
  planLeadForHost,
  preconditionsForTree,
  tallyCompanyMirrors,
} from './lib/crm-lifecycle-backfill.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = join(here, '..', '..')

const args = parseDeployArgs({
  command: 'backfill-crm-lifecycle-stages',
  summary:
    'Stamp the lifecycle stage every facet captured before AGL-2612 implies, ' +
    'file the leads the lead surfaces should have filed, and recount each ' +
    'company\'s contacts. Writes to the named project with --apply.',
  effect: { gerund: 'writing', past: 'WRITTEN', failure: 'could not run' },
  flags: [
    { flag: '--apply', key: 'apply', describe: 'Write. Without it, a dry run.' },
    { flag: '--leads', key: 'leads', describe: 'Also file historical leads under each host.' },
    { flag: '--companies', key: 'companies', describe: 'Also recount contactsCount on every company.' },
    {
      flag: '--any-form',
      key: 'anyForm',
      describe:
        'With --leads: every form the host has ever held is a lead surface, ' +
        'not only the lead-routed ones (the backlog from before lead routing).',
    },
    { flag: '--org', key: 'org', value: 'string', describe: 'Limit to one org id.' },
  ],
})
const apply = Boolean(args.apply)
const withLeads = Boolean(args.leads)
const withCompanies = Boolean(args.companies)
const anyForm = Boolean(args.anyForm)
const onlyOrg = args.org

// A widening of a pass that is not running is a belief about what this run
// files that nothing will act on.
if (anyForm && !withLeads) {
  console.error('--any-form widens the lead pass: pass --leads with it. NOTHING WAS WRITTEN.')
  process.exit(2)
}

const PAGE_SIZE = 400
const BATCH_OPERATIONS = 400

/*==========================================
 * CREDENTIALS
 *=========================================*/

/**
 * The root `.env`, read from the checkout this file lives in and from the
 * working directory, whichever holds one. Already-set variables win, so a
 * value on the command line is never overridden by the file.
 */
function loadRootEnv() {
  const candidates = [join(REPO_ROOT, '.env'), join(process.cwd(), '.env')]
  for (const file of new Set(candidates)) {
    if (!existsSync(file)) continue
    for (const line of readFileSync(file, 'utf8').split('\n')) {
      const match = line.match(/^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*)$/)
      if (!match) continue
      const [, key] = match
      if (process.env[key] !== undefined) continue
      let value = match[2].trim()
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1)
      }
      process.env[key] = value
    }
  }
}

function connect() {
  loadRootEnv()
  const projectId = process.env.GOOGLE_CLOUD_PROJECT || process.env.FIREBASE_PROJECT_ID
  if (!projectId) {
    console.error(
      'Name the project: GOOGLE_CLOUD_PROJECT=aglyn-main (or FIREBASE_PROJECT_ID in the root .env). NOTHING WAS WRITTEN.',
    )
    process.exit(2)
  }
  const emulator = process.env.FIRESTORE_EMULATOR_HOST
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n')
  let via
  if (emulator) {
    initializeApp({ projectId })
    via = `emulator at ${emulator}`
  } else if (clientEmail && privateKey) {
    initializeApp({ credential: cert({ projectId, clientEmail, privateKey }) })
    via = `service account ${clientEmail}`
  } else {
    initializeApp({ credential: applicationDefault(), projectId })
    via = 'application-default credentials'
  }
  console.log(`project ${projectId} via ${via} — ${apply ? 'APPLY' : 'DRY RUN'}`)
  return getFirestore(process.env.FIRESTORE_DATABASE_ID)
}

/*==========================================
 * READS
 *=========================================*/

/**
 * Every document of a collection, paged on the document id.
 *
 * `orderBy` on a data field drops every document missing it, and the rows
 * this script exists for are the OLDEST — the ones an older writer never
 * stamped. The document id is the one path every document has.
 */
async function* everyDocument(collectionRef) {
  let cursor = null
  for (;;) {
    let query = collectionRef.orderBy(FieldPath.documentId()).limit(PAGE_SIZE)
    if (cursor) query = query.startAfter(cursor)
    const page = await query.get()
    if (page.empty) return
    for (const snapshot of page.docs) yield snapshot
    cursor = page.docs[page.docs.length - 1]
    if (page.size < PAGE_SIZE) return
  }
}

async function collect(collectionRef) {
  const rows = []
  for await (const snapshot of everyDocument(collectionRef)) {
    rows.push({ id: snapshot.id, data: snapshot.data() ?? {} })
  }
  return rows
}

/**
 * Which hosts belong to which org, by the index the runtime resolves a
 * host through (`resolveOrgIdForHost`). Read whole: it is one small
 * document per site, and reading it is what keeps a site whose host
 * document lost its `orgId` from silently leaving the sweep.
 */
async function hostsByOrg(db) {
  const byOrg = new Map()
  for await (const snapshot of everyDocument(db.collection('hostIndex'))) {
    const orgId = snapshot.get('orgId')
    if (typeof orgId !== 'string' || !orgId) continue
    if (!byOrg.has(orgId)) byOrg.set(orgId, [])
    byOrg.get(orgId).push(snapshot.id)
  }
  for (const hosts of byOrg.values()) hosts.sort()
  return byOrg
}

/** The per-host inputs the lead pass reads, from the host's own collections. */
async function readHostForLeads(db, hostId, nowMs) {
  const hostRef = db.collection('hosts').doc(hostId)
  const forms = await collect(hostRef.collection('forms'))
  const routed = forms.some(
    (form) => !form.data?.archivedAt && form.data?.routing?.lead === true,
  )
  return hostLeadContext({
    hostId,
    forms,
    // The submissions are only needed to join and count lead-surface
    // captures; a site with no routed form pays no read for them unless
    // every form is a surface — then they are also where a deleted form's
    // id survives.
    submissions:
      routed || anyForm ? await collect(hostRef.collection('formSubmissions')) : [],
    leads: await collect(hostRef.collection('leads')),
    suppressions: await collect(hostRef.collection('suppressions')),
    nowMs,
    anyForm,
  })
}

/*==========================================
 * WRITES
 *=========================================*/

/**
 * Commit a list of `{ kind, ref, value }` writes in batches under the
 * operation ceiling, in order. `create` refuses an existing document, which
 * is the one write here that must never win a race with a live door.
 */
async function commitAll(db, writes) {
  for (let start = 0; start < writes.length; start += BATCH_OPERATIONS) {
    const batch = db.batch()
    for (const write of writes.slice(start, start + BATCH_OPERATIONS)) {
      if (write.kind === 'create') batch.create(write.ref, write.value)
      else batch.update(write.ref, write.value)
    }
    await batch.commit()
  }
}

/*==========================================
 * THE RUN
 *=========================================*/

const SKIP_LABELS = {
  'already-a-lead': 'already a lead',
  erased: 'erased on this site',
  'beyond-lead': 'already worked past Lead',
  'no-email': 'no usable address',
}

/**
 * The skip, in the operator's words. `no-lead-surface` names its remedy,
 * and under `--any-form` the form half of the remedy is already in effect.
 */
function skipLabel(reason) {
  if (reason === 'no-lead-surface') {
    return anyForm
      ? 'met through no lead surface (no form, no booking)'
      : 'met through no lead surface (turn routing on, or pass --any-form, and re-run)'
  }
  return SKIP_LABELS[reason] ?? reason
}

/** Why a form counted only because of `--any-form`, in the operator's words. */
const UNROUTED_STATES = {
  'routing off': 'routing off — turn it on',
  archived: 'archived',
  'no form document': 'no form document',
}

function stageCountsLine(byStage) {
  return Object.entries(byStage)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([stage, count]) => `${stage} ${count}`)
    .join(', ')
}

function day(ms) {
  return new Date(ms).toISOString().slice(0, 10)
}

async function runOrg(db, orgId, hostIds, nowMs, totals) {
  const orgRef = db.collection('orgs').doc(orgId)
  const contactsRef = orgRef.collection('contacts')
  const contacts = []
  const stageWrites = []
  const stageReport = { byStage: {}, contacts: 0, held: 0, noEvidence: 0, noFacets: 0, unusable: 0 }
  const hosts = withLeads
    ? await Promise.all(hostIds.map((hostId) => readHostForLeads(db, hostId, nowMs)))
    : []
  const leadPlans = new Map(
    hosts.map((host) => [host.hostId, { create: [], skips: {}, viaSourceKind: 0 }]),
  )

  for await (const snapshot of everyDocument(contactsRef)) {
    const contact = snapshot.data() ?? {}
    contacts.push(contact)
    stageReport.contacts += 1

    const plan = planFacetStages(contact)
    if (plan.noFacets) stageReport.noFacets += 1
    stageReport.held += plan.held
    stageReport.noEvidence += plan.noEvidence
    for (const write of plan.writes) {
      stageReport.byStage[write.stage] = (stageReport.byStage[write.stage] ?? 0) + 1
      if (write.replacedUnusable) stageReport.unusable += 1
      stageWrites.push({ kind: 'update', ref: snapshot.ref, value: { [write.path]: write.stage } })
    }

    for (const host of hosts) {
      const verdict = planLeadForHost({ contactId: snapshot.id, contact, host })
      const bucket = leadPlans.get(host.hostId)
      if (verdict.kind === 'create') {
        bucket.create.push(verdict)
        if (verdict.viaSourceKind) bucket.viaSourceKind += 1
      } else if (verdict.reason !== 'not-captured-here') {
        bucket.skips[verdict.reason] = (bucket.skips[verdict.reason] ?? 0) + 1
      }
    }
  }

  console.log(`\norg ${orgId}: ${stageReport.contacts} contact(s), ${hostIds.length} site(s)`)
  const stamped = stageWrites.length
  console.log(
    `  stages: ${apply ? 'stamping' : 'would stamp'} ${stamped} facet(s)` +
      (stamped ? ` — ${stageCountsLine(stageReport.byStage)}` : '') +
      `; ${stageReport.held} hold a stage; ${stageReport.noEvidence} imply none` +
      (stageReport.unusable ? `; ${stageReport.unusable} unusable value(s) replaced` : '') +
      (stageReport.noFacets ? `; ${stageReport.noFacets} pre-facet row(s) left` : ''),
  )
  for (const [stage, count] of Object.entries(stageReport.byStage)) {
    totals.byStage[stage] = (totals.byStage[stage] ?? 0) + count
  }
  totals.facets += stamped
  totals.contacts += stageReport.contacts
  if (apply && stageWrites.length) await commitAll(db, stageWrites)

  if (withLeads) {
    const leadWrites = []
    for (const host of hosts) {
      const bucket = leadPlans.get(host.hostId)
      const skips = Object.entries(bucket.skips)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([reason, count]) => `${count} ${skipLabel(reason)}`)
        .join('; ')
      console.log(
        `  leads (${host.hostId}): ${apply ? 'creating' : 'would create'} ${bucket.create.length}` +
          ` — ${host.routedForms.size} routed form(s)` +
          (anyForm
            ? `; via --any-form: ${host.unroutedForms.size} unrouted form(s)` +
              `; via --any-form: ${bucket.viaSourceKind} by source kind (no form id)`
            : '') +
          (skips ? `; ${skips}` : ''),
      )
      for (const [formId, form] of host.unroutedForms) {
        console.log(
          `      via --any-form: ${form.name === formId ? formId : `${form.name} (${formId})`}` +
            `  ${UNROUTED_STATES[form.state] ?? form.state}`,
        )
      }
      totals.unroutedForms += host.unroutedForms.size
      totals.viaSourceKind += bucket.viaSourceKind
      for (const verdict of bucket.create) {
        const row = verdict.row
        console.log(
          `      ${verdict.key.slice(0, 12)}…  ${row.sources.join(', ')}` +
            (verdict.viaSourceKind ? '  (by source kind)' : '') +
            `  captures ${row.submissionCount}  seen ${day(row.firstSeenAtMs)} → ${day(row.lastSeenAtMs)}` +
            (row[FIELDS.marketingConsentByHost] ? '  consent carried' : ''),
        )
        leadWrites.push({
          kind: 'create',
          ref: db.collection('hosts').doc(host.hostId).collection('leads').doc(verdict.key),
          value: { ...row, createdAt: FieldValue.serverTimestamp() },
        })
      }
      totals.leads += bucket.create.length
      for (const [reason, count] of Object.entries(bucket.skips)) {
        totals.leadSkips[reason] = (totals.leadSkips[reason] ?? 0) + count
      }
    }
    if (apply && leadWrites.length) await commitAll(db, leadWrites)
  }

  if (withCompanies) {
    const companies = await collect(orgRef.collection('companies'))
    const plan = planCompanyCounts(companies, tallyCompanyMirrors(contacts))
    console.log(
      `  companies: ${plan.drift.length} of ${companies.length} ${apply ? 'fixed' : 'would be fixed'}` +
        `; ${plan.inStep} in step` +
        (plan.orphans.length ? `; ${plan.orphans.length} id(s) named by no company` : ''),
    )
    for (const row of plan.drift) {
      console.log(
        `      ${row.name} (${row.companyId.slice(0, 12)}…)  ${row.stored === null ? 'absent' : row.stored} → ${row.counted}`,
      )
    }
    for (const orphan of plan.orphans) {
      console.log(`      ⚠️ ${orphan.companyId} is named by ${orphan.counted} contact(s) and has no company document — left`)
    }
    totals.companies += plan.drift.length
    totals.orphans += plan.orphans.length
    if (apply && plan.drift.length) {
      await commitAll(
        db,
        plan.drift.map((row) => ({
          kind: 'update',
          ref: orgRef.collection('companies').doc(row.companyId),
          value: { [FIELDS.contactsCount]: row.counted },
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
  const db = connect()
  const nowMs = Date.now()
  const byOrg = await hostsByOrg(db)
  const orgIds = onlyOrg
    ? [onlyOrg]
    : (await db.collection('orgs').select().get()).docs.map((snapshot) => snapshot.id)
  const totals = {
    orgs: 0,
    contacts: 0,
    facets: 0,
    byStage: {},
    leads: 0,
    leadSkips: {},
    unroutedForms: 0,
    viaSourceKind: 0,
    companies: 0,
    orphans: 0,
  }
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
    `\n${verb}: ${totals.facets} facet stage(s) on ${totals.contacts} contact(s) across ${totals.orgs} org(s)` +
      (totals.facets ? ` (${stageCountsLine(totals.byStage)})` : '') +
      (withLeads
        ? `; ${totals.leads} lead(s) created` +
          (Object.keys(totals.leadSkips).length
            ? ` (${Object.entries(totals.leadSkips)
                .map(([reason, count]) => `${count} ${skipLabel(reason)}`)
                .join('; ')})`
            : '') +
          (anyForm
            ? `; via --any-form: ${totals.unroutedForms} unrouted form(s) counted as lead surfaces` +
              `; via --any-form: ${totals.viaSourceKind} by source kind (no form id)`
            : '')
        : '; leads not run (--leads)') +
      (withCompanies
        ? `; ${totals.companies} company count(s) fixed` +
          (totals.orphans ? `, ${totals.orphans} orphan id(s) left` : '')
        : '; companies not run (--companies)') +
      '.',
  )
  if (!apply) console.log('  Re-run with --apply to write.\n')
}

await run()
process.exit(0)
