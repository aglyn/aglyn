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

/**
 * Move site-tied CRM records to the whole organization (AGL-4122).
 *
 * CRM records now belong to the org by default, and the site is where a record
 * came from. A record written before that still carries `visibleTo` naming its
 * site, so it stays hidden from the org's other sites. This sets `visibleTo` to
 * `['org']` on those records. `hostId`, which says where the record came from,
 * is never touched, and neither is `updatedAt`, which the lists order by.
 *
 * Skipped: any org that keeps its sites apart (`crm.defaultRecordScope` of
 * `host`), since widening its records is exactly what it opted out of, and any
 * org named by `--except`.
 *
 * ## After an apply
 *
 * Search and filters read fields built from `visibleTo`, so run the list-fields
 * backfill for each org this changed. The apply prints the commands.
 *
 * ## Running it
 *
 *     gcloud auth application-default login
 *     GOOGLE_CLOUD_PROJECT=<project> node tools/scripts/migrate-crm-records-to-whole-org.mjs          # dry run
 *     GOOGLE_CLOUD_PROJECT=<project> node tools/scripts/migrate-crm-records-to-whole-org.mjs --apply  # write
 *
 * A dry run prints the per-workspace counts and writes nothing. Idempotent: a
 * second run finds nothing to move. `--self-test` touches no project.
 */
import { strict as assert } from 'node:assert'
import { applicationDefault, initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import { parseDeployArgs } from './lib/deploy-args.mjs'

const COLLECTIONS = [
  'contacts',
  'leads',
  'companies',
  'deals',
  'crmTasks',
  'crmActivities',
  'pipelines',
  'crmEmailTemplates',
]
const ORG_TOKEN = 'org'
const BATCH_SIZE = 400

/** Whether a record is still tied to its site. A missing list is seen by nobody. */
export function needsWholeOrg(visibleTo) {
  return !Array.isArray(visibleTo) || !visibleTo.includes(ORG_TOKEN)
}

/** Whether an org chose to keep each site's records apart. */
export function keepsSitesApart(org) {
  return org?.crm?.defaultRecordScope === 'host'
}

function selfTest() {
  assert.equal(needsWholeOrg(['host:a']), true)
  assert.equal(needsWholeOrg(undefined), true)
  assert.equal(needsWholeOrg(['org']), false)
  assert.equal(needsWholeOrg(['host:a', 'org']), false)
  assert.equal(keepsSitesApart({ crm: { defaultRecordScope: 'host' } }), true)
  assert.equal(keepsSitesApart({ crm: { defaultRecordScope: 'org' } }), false)
  assert.equal(keepsSitesApart({}), false)
  console.log('self-test passed')
}

async function migrateCollection(firestore, orgId, collection, apply) {
  const records = await firestore.collection(`orgs/${orgId}/${collection}`).select('visibleTo').get()
  const tied = records.docs.filter((doc) => needsWholeOrg(doc.get('visibleTo')))
  if (apply) {
    for (let start = 0; start < tied.length; start += BATCH_SIZE) {
      const batch = firestore.batch()
      for (const doc of tied.slice(start, start + BATCH_SIZE)) {
        batch.update(doc.ref, { visibleTo: [ORG_TOKEN] })
      }
      await batch.commit()
    }
  }
  return tied.length
}

async function main() {
  const args = parseDeployArgs({
    command: 'migrate-crm-records-to-whole-org',
    summary: 'Move site-tied CRM records to the whole organization. Writes with --apply.',
    effect: { gerund: 'writing', past: 'WRITTEN', failure: 'could not run' },
    flags: [
      { flag: '--apply', key: 'apply', describe: 'Write. Without it, a dry run.' },
      { flag: '--self-test', key: 'selfTest', describe: 'Run the fixtures, touching no project.' },
      { flag: '--org', key: 'org', value: 'string', describe: 'Limit to one organization.' },
      {
        flag: '--except',
        key: 'except',
        value: 'string',
        describe: 'Organization ids to leave alone, comma separated.',
      },
    ],
  })
  if (args.selfTest) return selfTest()

  initializeApp({ credential: applicationDefault() })
  const firestore = getFirestore()
  const except = new Set(String(args.except ?? '').split(',').filter(Boolean))
  const orgs = args.org
    ? [await firestore.doc(`orgs/${args.org}`).get()]
    : (await firestore.collection('orgs').select('slug', 'crm').get()).docs

  const changed = []
  const totals = Object.fromEntries(COLLECTIONS.map((collection) => [collection, 0]))
  console.log(['workspace', ...COLLECTIONS, 'total'].join(' | '))
  for (const org of orgs) {
    if (except.has(org.id) || keepsSitesApart(org.data())) continue
    const counts = {}
    for (const collection of COLLECTIONS) {
      counts[collection] = await migrateCollection(firestore, org.id, collection, Boolean(args.apply))
      totals[collection] += counts[collection]
    }
    const total = Object.values(counts).reduce((sum, count) => sum + count, 0)
    if (!total) continue
    changed.push(org.id)
    console.log([org.get('slug') || org.id, ...COLLECTIONS.map((name) => counts[name]), total].join(' | '))
  }
  console.log(['TOTAL', ...COLLECTIONS.map((name) => totals[name])].join(' | '))
  if (!args.apply) {
    console.log('Dry run: nothing was written.')
    return
  }
  console.log('Now restamp what search and filters read, for each org changed:')
  for (const orgId of changed) {
    console.log(`  node tools/scripts/backfill-crm-list-fields.mjs --apply --org ${orgId}`)
  }
}

await main()
