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

// The email-state backfill (AGL-3245).
//
//   GOOGLE_CLOUD_PROJECT=aglyn-main node tools/scripts/backfill-crm-email-state.mjs
//   GOOGLE_CLOUD_PROJECT=aglyn-main node tools/scripts/backfill-crm-email-state.mjs --org=<orgId>
//   GOOGLE_CLOUD_PROJECT=aglyn-main node tools/scripts/backfill-crm-email-state.mjs --org=<orgId> --apply
//
// DRY RUN BY DEFAULT. `--apply` writes. Every decision is
// `lib/crm-email-state-backfill.mjs`'s and pinned by its test; this file
// reads, prints and writes.
//
// ## What it does
//
// Every contact and every lead written before the record carried its
// `emailState` (AGL-3245) is stamped from what the senders' lists already
// hold for its address: the platform suppression list (`emailSuppressions`,
// a bounce, a complaint or a staff entry) and the organization's Outreach
// do-not-contact list (`outreachDoNotContact`, a member's mark, a reply
// that opted out, an unsubscribe, a hard bounce, a gateway block). The
// lists are keyed by the address's hash and name nothing, so the walk is
// over the records: each is keyed by its own address and the lists are
// asked. The domain list is not consulted — a domain is not a verdict on
// one person's address, and the enrollment gates read it on their own.
//
// ## Idempotence
//
// A record already holding a verdict as strong as the lists' is left
// alone, so a second run plans nothing. `updatedAt` is not touched: a
// verdict is something that happened to the person, not an edit.

import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { personKey, planRecordEmailState } from './lib/crm-email-state-backfill.mjs'
import { parseDeployArgs } from './lib/deploy-args.mjs'
import { collect, commitAll, connectFirestore, everyDocument } from './lib/firestore-backfill.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = join(here, '..', '..')

const args = parseDeployArgs({
  command: 'backfill-crm-email-state',
  summary:
    'Stamp every contact and lead with the email state the senders’ lists already hold ' +
    'for its address — bounced, blocked, unsubscribed, complained, do not contact. ' +
    'Writes to the named project with --apply.',
  effect: { gerund: 'writing', past: 'WRITTEN', failure: 'could not run' },
  flags: [
    { flag: '--apply', key: 'apply', describe: 'Write. Without it, a dry run.' },
    { flag: '--org', key: 'org', value: 'string', describe: 'Limit to one org id.' },
  ],
})
const apply = Boolean(args.apply)
const onlyOrg = args.org

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

/** The platform suppression list, by key. */
async function suppressionsByKey(db) {
  const byKey = new Map()
  for (const row of await collect(db.collection('emailSuppressions'))) byKey.set(row.id, row.data)
  return byKey
}

async function runOrg(db, orgId, hostIds, suppressions, totals) {
  const orgRef = db.collection('orgs').doc(orgId)
  const doNotContact = new Map()
  for (const row of await collect(orgRef.collection('outreachDoNotContact'))) doNotContact.set(row.id, row.data)

  const writes = []
  const report = { contacts: 0, leads: 0, seen: 0, byStatus: {} }
  const consider = (ref, record, key, kind) => {
    report.seen += 1
    if (!key) return
    const plan = planRecordEmailState({
      record,
      suppression: suppressions.get(key) ?? null,
      doNotContact: doNotContact.get(key) ?? null,
    })
    if (!plan) return
    report[kind] += 1
    report.byStatus[plan.status] = (report.byStatus[plan.status] ?? 0) + 1
    writes.push({ kind: 'set', ref, value: { emailState: plan } })
  }

  for await (const snapshot of everyDocument(orgRef.collection('contacts'))) {
    const data = snapshot.data() ?? {}
    consider(snapshot.ref, data, personKey(data.email), 'contacts')
  }
  for (const hostId of hostIds) {
    const leads = db.collection('hosts').doc(hostId).collection('leads')
    for await (const snapshot of everyDocument(leads)) {
      // A lead is keyed by its address's hash already; the address on it is
      // the same person, and the key is read off it in case one differs.
      const data = snapshot.data() ?? {}
      consider(snapshot.ref, data, personKey(data.email) ?? snapshot.id, 'leads')
    }
  }

  const statuses = Object.entries(report.byStatus)
    .map(([status, count]) => `${count} ${status}`)
    .join(', ')
  console.log(
    `  ${apply ? 'stamping' : 'would stamp'} ${report.contacts} contact(s) and ${report.leads} lead(s)` +
      ` of ${report.seen} read` +
      (statuses ? ` — ${statuses}` : ''),
  )
  totals.contacts += report.contacts
  totals.leads += report.leads
  if (apply && writes.length) await commitAll(db, writes)
}

async function main() {
  const db = connectFirestore({ repoRoot: REPO_ROOT, apply })
  const [byOrg, suppressions] = await Promise.all([hostsByOrg(db), suppressionsByKey(db)])
  console.log(`${suppressions.size} platform suppression(s) read`)
  const orgIds = onlyOrg ? [onlyOrg] : (await collect(db.collection('orgs'))).map((row) => row.id).sort()
  const totals = { contacts: 0, leads: 0 }
  for (const orgId of orgIds) {
    console.log(`org ${orgId}`)
    await runOrg(db, orgId, byOrg.get(orgId) ?? [], suppressions, totals)
  }
  console.log(
    `${apply ? 'stamped' : 'would stamp'} ${totals.contacts} contact(s) and ${totals.leads} lead(s) across ${orgIds.length} org(s)` +
      (apply ? '' : ' — dry run, nothing written; re-run with --apply'),
  )
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
