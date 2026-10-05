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

// The CRM picklists backfill (AGL-3511). See `docs/CRM_PICKLISTS_BACKFILL.md`.
//
//   GOOGLE_CLOUD_PROJECT=aglyn-main node tools/scripts/backfill-crm-picklists.mjs
//   GOOGLE_CLOUD_PROJECT=aglyn-main node tools/scripts/backfill-crm-picklists.mjs --org=<orgId>
//   GOOGLE_CLOUD_PROJECT=aglyn-main node tools/scripts/backfill-crm-picklists.mjs --org=<orgId> --apply
//
// DRY RUN BY DEFAULT. `--apply` writes. Every decision is
// `libs/plugins/crm/scripts/crm-picklists-backfill.mjs`'s and pinned by its
// test; this file
// reads, prints and writes.
//
// ## What it does, per org
//
// For Lead source — and Industry, once the registry holds it — it reads the
// org's list (`orgs/{orgId}/crmPicklists/{id}`) and every label the org's
// records hold for it, and writes the list back with each held label the
// list does not answer to added as the org's own value, and each
// org-added lead source filed under a direction by its label. A stored value
// whose id is a standard id is the standard value overridden and is left as
// it is. It writes the LIST document only: no record is ever rewritten.
//
// ## Idempotence
//
// A second run finds every held label in the list and every Outbound value
// grouped, and plans nothing.

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { FieldValue } from 'firebase-admin/firestore'
import {
  backfilledDefinitions,
  describePlan,
  heldLabels,
  leadSourceGroupFor,
  planPicklist,
  readPicklistDefinitions,
  TARGET_COLLECTIONS,
} from '../../libs/plugins/crm/scripts/crm-picklists-backfill.mjs'
import { parseDeployArgs } from './lib/deploy-args.mjs'
import { collect, commitAll, connectFirestore } from './lib/firestore-backfill.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = join(here, '..', '..')
const CRM_SOURCE = join(REPO_ROOT, 'libs', 'aglyn', 'src', 'lib', 'app-utils', 'crm.ts')

const args = parseDeployArgs({
  command: 'backfill-crm-picklists',
  summary:
    'Write down, as each org’s own value, every Lead source (and Industry, ' +
    'once registered) label its records hold that its list does not, and ' +
    'file org-added lead sources under Inbound or Outbound by their label. ' +
    'Writes the list documents only, to the named project with --apply.',
  effect: { gerund: 'writing', past: 'WRITTEN', failure: 'could not run' },
  flags: [
    { flag: '--apply', key: 'apply', describe: 'Write. Without it, a dry run.' },
    { flag: '--org', key: 'org', value: 'string', describe: 'Limit to one org id.' },
  ],
})
const apply = Boolean(args.apply)
const onlyOrg = args.org

/** The labels the org's records hold for one definition, across its targets. */
async function labelsHeld(orgRef, definition, cache) {
  const labels = []
  for (const target of definition.targets) {
    const collection = TARGET_COLLECTIONS[target.object]
    if (!collection) continue
    if (!cache.has(collection)) cache.set(collection, await collect(orgRef.collection(collection)))
    labels.push(...heldLabels(cache.get(collection), target.field, { facet: Boolean(target.facet) }))
  }
  return labels
}

async function runOrg(db, orgId, definitions, totals) {
  const orgRef = db.collection('orgs').doc(orgId)
  const records = new Map()
  const writes = []
  console.log(`\norg ${orgId}:`)
  for (const definition of definitions) {
    const listRef = orgRef.collection('crmPicklists').doc(definition.id)
    const snapshot = await listRef.get()
    const plan = planPicklist({
      definition,
      raw: snapshot.exists ? snapshot.data() : undefined,
      held: await labelsHeld(orgRef, definition, records),
      groupFor: definition.id === 'leadSource' ? leadSourceGroupFor : () => null,
    })
    for (const line of describePlan(definition.id, plan)) console.log(`  ${line}`)
    if (!plan.write) continue
    totals.lists += 1
    totals.added += plan.added.length
    totals.regrouped += plan.regrouped.length
    writes.push({
      kind: 'set',
      ref: listRef,
      value: {
        values: plan.values,
        defaultValueId: plan.defaultValueId,
        updatedAt: FieldValue.serverTimestamp(),
        // The org-wide stamp the rules require of a new CRM document, as the
        // Fields page writes it on an org's first edit.
        ...(plan.created
          ? { hostId: null, createdAt: FieldValue.serverTimestamp(), visibleTo: ['org'] }
          : {}),
      },
    })
  }
  if (apply && writes.length) await commitAll(db, writes)
}

async function run() {
  const registered = readPicklistDefinitions(readFileSync(CRM_SOURCE, 'utf8'))
  const { chosen, refused } = backfilledDefinitions(registered)
  console.log(`picklists: ${chosen.map((definition) => definition.id).join(', ') || 'none'}`)
  if (refused.length) {
    console.log(`  skipped (their standard values or targets could not be read from crm.ts): ${refused.join(', ')}`)
  }
  if (!chosen.length) {
    console.error('No picklist to backfill. NOTHING WAS WRITTEN.')
    process.exit(2)
  }
  const db = connectFirestore({ repoRoot: REPO_ROOT, apply })
  const orgIds = onlyOrg
    ? [onlyOrg]
    : (await db.collection('orgs').select().get()).docs.map((snapshot) => snapshot.id)
  const totals = { orgs: 0, lists: 0, added: 0, regrouped: 0 }
  for (const orgId of orgIds) {
    if (onlyOrg && !(await db.collection('orgs').doc(orgId).get()).exists) {
      console.log(`org ${orgId}: does not exist`)
      continue
    }
    totals.orgs += 1
    await runOrg(db, orgId, chosen, totals)
  }
  const verb = apply ? 'Wrote' : 'Dry run'
  console.log(
    `\n${verb}: ${totals.lists} list(s) across ${totals.orgs} org(s)` +
      ` — ${totals.added} value(s) added, ${totals.regrouped} regrouped; no record rewritten.`,
  )
  if (!apply) console.log('  Re-run with --apply to write.\n')
}

await run()
process.exit(0)
