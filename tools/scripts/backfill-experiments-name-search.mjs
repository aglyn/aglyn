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
 * Stamp `nameLower`, `nameTokens` and `nameReversed` onto every A/B
 * experiment saved before the fields existed (AGL-3321).
 *
 * The site's A/B testing list asks Firestore for its Experiment filter
 * (`equals` on `nameLower`, `contains` on `nameTokens`) and its search box
 * (`nameTokens`), and every writer of an experiment now stamps the keys
 * beside the name it writes (`nameSearchFields`). An experiment saved before
 * that has none of them, and a query cannot find a document that lacks a
 * field — so without this, an older experiment lists normally and is never
 * found by a filter or a search.
 *
 * The keys come from the stored `name` through
 * `tools/scripts/lib/name-search-tokens.mjs`, the one script-side twin of
 * `libs/aglyn/src/lib/app-utils/name-search.ts`.
 *
 * ## What else the dry run reports
 *
 * `deletedAt`: nothing soft-deletes an experiment — the console's Delete is
 * a `deleteDoc` — so the list no longer drops rows carrying it after its
 * query. The count of experiments that carry one anyway is printed, and
 * should be zero; anything else is a writer this script's author did not
 * find. Such rows are still stamped, and are left otherwise untouched.
 *
 * ## Idempotence and interruption
 *
 * An experiment whose keys already match its name is never written, so a
 * re-run is a no-op and an interrupted run is finished by the next. Writes
 * touch only the three key fields, in batches of 400. Nothing is deleted.
 * Only `hosts/{hostId}/experiments/{id}` is touched; any other collection
 * named `experiments` is counted as skipped and left alone.
 *
 * ## Running it
 *
 * Application Default Credentials against the project to write:
 *
 *     gcloud auth application-default login
 *     GOOGLE_CLOUD_PROJECT=<project> node tools/scripts/backfill-experiments-name-search.mjs          # dry run
 *     GOOGLE_CLOUD_PROJECT=<project> node tools/scripts/backfill-experiments-name-search.mjs --apply  # write
 *     node tools/scripts/backfill-experiments-name-search.mjs --self-test                             # fixtures only
 *
 * A self-hosted install runs the same commands against its own project.
 */
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseDeployArgs } from './lib/deploy-args.mjs'
import { BATCH_OPERATIONS, connectFirestore } from './lib/firestore-backfill.mjs'
import { displayNameSearchFields, sameSearchTokens } from './lib/name-search-tokens.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const COMMAND = 'backfill-experiments-name-search'

const args = parseDeployArgs({
  command: COMMAND,
  summary:
    'Stamp `nameLower`, `nameTokens` and `nameReversed` onto A/B experiments ' +
    'saved before the A/B testing list searched them. Writes to the live ' +
    'project with --apply.',
  effect: { gerund: 'writing', past: 'WRITTEN', failure: 'could not run' },
  flags: [
    { flag: '--apply', key: 'apply', describe: 'Write. Without it, a dry run.' },
    { flag: '--self-test', key: 'selfTest', describe: 'Run the fixtures, touching no project.' },
  ],
})

/** Documents read per page of the scan. */
const PAGE = 1000

/**
 * What an experiment should be stamped with, or a skip. Pure, for the
 * self-test.
 *
 * @param {string} path the document path
 * @param {Record<string, unknown>} data the document
 * @returns {{ update: Record<string, unknown> } | { skip: 'current' | 'not-a-site-experiment' }}
 */
export function planExperiment(path, data) {
  const segments = path.split('/')
  if (segments.length !== 4 || segments[0] !== 'hosts' || segments[2] !== 'experiments') {
    return { skip: 'not-a-site-experiment' }
  }
  const keys = displayNameSearchFields(data.name)
  const update = {}
  if (data.nameLower !== keys.nameLower) update.nameLower = keys.nameLower
  if (!sameSearchTokens(data.nameTokens, keys.nameTokens)) update.nameTokens = keys.nameTokens
  if (data.nameReversed !== keys.nameReversed) update.nameReversed = keys.nameReversed
  return Object.keys(update).length ? { update } : { skip: 'current' }
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
  const PATH = 'hosts/h1/experiments/e1'
  const hero = displayNameSearchFields('Hero copy')
  const cases = [
    ['an experiment saved before the keys', PATH, { name: 'Hero copy' }, { update: hero }],
    ['a current experiment', PATH, { name: 'Hero copy', ...hero }, { skip: 'current' }],
    [
      'a renamed one whose keys lag',
      PATH,
      { name: 'Pricing page', ...hero },
      { update: displayNameSearchFields('Pricing page') },
    ],
    ['no name', PATH, {}, { update: { nameLower: '', nameTokens: [], nameReversed: '' } }],
    ['another collection', 'orgs/o1/experiments/e1', { name: 'x' }, { skip: 'not-a-site-experiment' }],
    ['a nested one', 'hosts/h1/screens/s1/experiments/e1', { name: 'x' }, { skip: 'not-a-site-experiment' }],
  ]
  for (const [name, path, data, expected] of cases) {
    const got = planExperiment(path, data)
    check(
      `${name}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(got)}`,
      JSON.stringify(got) === JSON.stringify(expected),
    )
    const stamped = 'update' in got ? { ...data, ...got.update } : data
    check(`${name}: re-run is a no-op`, 'skip' in planExperiment(path, stamped))
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
    let page = firestore.collectionGroup('experiments').orderBy('__name__').limit(PAGE)
    if (cursor) page = page.startAfter(cursor)
    const snapshot = await page.get()
    if (snapshot.empty) break
    for (const doc of snapshot.docs) {
      counts.scanned += 1
      const data = doc.data()
      const plan = planExperiment(doc.ref.path, data)
      if (plan.skip === 'not-a-site-experiment') {
        counts.other += 1
        continue
      }
      if (data.deletedAt != null) counts.softDeleted += 1
      if (typeof data.name !== 'string' || !data.name.trim()) counts.unnamed += 1
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
  console.log(`  scanned                          ${counts.scanned}`)
  console.log(`  already current                  ${counts.current}`)
  console.log(`  stamp name keys                  ${counts.stamp}`)
  console.log(`  carrying deletedAt (expected 0)  ${counts.softDeleted}`)
  console.log(`  with no name (orderBy drops)     ${counts.unnamed}`)
  console.log(`  not hosts/*/experiments (left alone) ${counts.other}`)
  if (args.apply) console.log(`  written                          ${counts.written}`)
}

await main()
