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
 * Stamp `nameLower` onto every dataset saved before the field (AGL-4047).
 *
 * The Data page finds a dataset by the start of its name and pages the list
 * in name order, both through `nameLower` (`nameSearchKey` of the dataset's
 * name), and every writer of a dataset's name now stamps it beside the name
 * (`datasetNameLower`). A dataset saved before has none, and a query ordered
 * by a field leaves out every document that lacks it: without this, an older
 * dataset would be missing from the list once the page asks by name.
 *
 * ONLY `nameLower` is written. The field is never shown, so nobody sees a
 * name change. The key comes from the stored name the console shows
 * (`displayName`, then the pre-migration `name`, as `datasetDisplayName`
 * reads them) through `tools/scripts/lib/name-search-tokens.mjs`, the one
 * script-side twin of `libs/aglyn/src/lib/app-utils/name-search.ts`. A
 * dataset with no name is stamped `''`, so the ordered list still reaches it.
 *
 * ## Idempotence and interruption
 *
 * A dataset whose `nameLower` already matches its name is never written, so
 * a re-run is a no-op and an interrupted run is finished by the next. Writes
 * go in batches of 400. Nothing is deleted. Only
 * `orgs/{orgId}/datasets/{id}` is touched; the legacy site-held
 * `hosts/{hostId}/datasets` and any other collection named `datasets` are
 * counted and left alone.
 *
 * ## Running it
 *
 * Application Default Credentials against the project to write:
 *
 *     gcloud auth application-default login
 *     GOOGLE_CLOUD_PROJECT=<project> node tools/scripts/backfill-dataset-name-lower.mjs          # dry run
 *     GOOGLE_CLOUD_PROJECT=<project> node tools/scripts/backfill-dataset-name-lower.mjs --apply  # write
 *     node tools/scripts/backfill-dataset-name-lower.mjs --self-test                             # fixtures only
 *
 * A self-hosted install runs the same commands against its own project.
 */
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseDeployArgs } from './lib/deploy-args.mjs'
import { BATCH_OPERATIONS, connectFirestore } from './lib/firestore-backfill.mjs'
import { nameSearchKey } from './lib/name-search-tokens.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const COMMAND = 'backfill-dataset-name-lower'

const args = parseDeployArgs({
  command: COMMAND,
  summary:
    'Stamp `nameLower` onto datasets saved before the Data page searched ' +
    'them by name. Writes to the live project with --apply.',
  effect: { gerund: 'writing', past: 'WRITTEN', failure: 'could not run' },
  flags: [
    { flag: '--apply', key: 'apply', describe: 'Write. Without it, a dry run.' },
    { flag: '--self-test', key: 'selfTest', describe: 'Run the fixtures, touching no project.' },
  ],
})

/** Documents read per page of the scan. */
const PAGE = 1000

/** The name the console shows: `displayName`, then `name`, the first that is not blank. */
function shownName(data) {
  for (const candidate of [data?.displayName, data?.name]) {
    if (typeof candidate === 'string' && candidate.trim()) return candidate
  }
  return ''
}

/**
 * What a dataset should be stamped with, or a skip. Pure, for the self-test.
 *
 * @param {string} path the document path
 * @param {Record<string, unknown>} data the document
 * @returns {{ update: { nameLower: string } } | { skip: 'current' | 'not-an-org-dataset' }}
 */
export function planDataset(path, data) {
  const segments = path.split('/')
  if (segments.length !== 4 || segments[0] !== 'orgs' || segments[2] !== 'datasets') {
    return { skip: 'not-an-org-dataset' }
  }
  const nameLower = nameSearchKey(shownName(data))
  return data?.nameLower === nameLower ? { skip: 'current' } : { update: { nameLower } }
}

function selfTest() {
  let failed = 0
  let total = 0
  const check = (name, ok) => {
    total += 1
    if (!ok) {
      failed += 1
      console.error(`FAIL ${name}`)
    }
  }
  const PATH = 'orgs/o1/datasets/d1'
  const cases = [
    ['a dataset saved before the key', PATH, { displayName: 'Menu  Items ' }, { update: { nameLower: 'menu items' } }],
    ['a current dataset', PATH, { displayName: 'Menu Items', nameLower: 'menu items' }, { skip: 'current' }],
    ['a renamed one whose key lags', PATH, { displayName: 'Services', nameLower: 'menu items' }, { update: { nameLower: 'services' } }],
    ['the pre-migration name', PATH, { name: 'Team' }, { update: { nameLower: 'team' } }],
    ['a blank displayName falls back to name', PATH, { displayName: '  ', name: 'Team' }, { update: { nameLower: 'team' } }],
    ['no name at all', PATH, {}, { update: { nameLower: '' } }],
    ['accents are kept', PATH, { displayName: 'Café Menu' }, { update: { nameLower: 'café menu' } }],
    ['a legacy site dataset', 'hosts/h1/datasets/d1', { displayName: 'x' }, { skip: 'not-an-org-dataset' }],
    ['a records collection', 'orgs/o1/datasets/d1/records/r1', { displayName: 'x' }, { skip: 'not-an-org-dataset' }],
  ]
  for (const [name, path, data, expected] of cases) {
    const got = planDataset(path, data)
    check(
      `${name}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(got)}`,
      JSON.stringify(got) === JSON.stringify(expected),
    )
    const stamped = 'update' in got ? { ...data, ...got.update } : data
    check(`${name}: re-run is a no-op`, 'skip' in planDataset(path, stamped))
  }
  console.log(failed ? `self-test: ${failed} of ${total} failed` : `self-test: ${total}/${total} passed`)
  process.exit(failed ? 1 : 0)
}

async function main() {
  if (args.selfTest) return selfTest()
  const firestore = connectFirestore({ repoRoot: join(here, '..', '..'), apply: args.apply })
  const counts = { scanned: 0, current: 0, stamp: 0, other: 0, softDeleted: 0, unnamed: 0, written: 0 }
  let cursor = null
  let batch = firestore.batch()
  let pending = 0
  for (;;) {
    // Only the fields the plan reads: a dataset carries its whole model.
    let page = firestore
      .collectionGroup('datasets')
      .orderBy('__name__')
      .select('displayName', 'name', 'nameLower', 'deletedAt')
      .limit(PAGE)
    if (cursor) page = page.startAfter(cursor)
    const snapshot = await page.get()
    if (snapshot.empty) break
    for (const doc of snapshot.docs) {
      counts.scanned += 1
      const data = doc.data()
      const plan = planDataset(doc.ref.path, data)
      if (plan.skip === 'not-an-org-dataset') {
        counts.other += 1
        continue
      }
      if (data.deletedAt != null) counts.softDeleted += 1
      if (!shownName(data)) counts.unnamed += 1
      if ('skip' in plan) {
        counts.current += 1
        continue
      }
      counts.stamp += 1
      if (!args.apply) continue
      batch.update(doc.ref, plan.update)
      pending += 1
      if (pending >= BATCH_OPERATIONS) {
        await batch.commit()
        counts.written += pending
        batch = firestore.batch()
        pending = 0
      }
    }
    cursor = snapshot.docs[snapshot.docs.length - 1]
    if (snapshot.size < PAGE) break
  }
  if (args.apply && pending) {
    await batch.commit()
    counts.written += pending
  }
  console.log(args.apply ? `${COMMAND}: APPLIED` : `${COMMAND}: DRY RUN (nothing written)`)
  console.log(`  scanned                              ${counts.scanned}`)
  console.log(`  already current                      ${counts.current}`)
  console.log(`  stamp nameLower                      ${counts.stamp}`)
  console.log(`  carrying deletedAt (stamped too)     ${counts.softDeleted}`)
  console.log(`  with no name (stamped '')            ${counts.unnamed}`)
  console.log(`  not orgs/*/datasets (left alone)     ${counts.other}`)
  if (args.apply) console.log(`  written                              ${counts.written}`)
}

await main()
