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
 * Stamp the media library's filter and search keys onto every media document
 * written before they existed (AGL-3327).
 *
 * The library filters Type by EQUALITY on `kind`, Alt text by equality on
 * `hasAlt` and Orientation by equality on `orientation`, sorts by name on
 * `nameLower` (which also serves "Name starts with"), and searches file names
 * by `array-contains` on `nameTokens`, each on the query beneath its cursor;
 * "No folder" asks for `folderId == null`.
 * Every writer now stores them (`mediaFilterKeys` in
 * `libs/aglyn/src/lib/app-utils/media-metadata.ts`). A document written
 * before that has none of them, and a query cannot find a document that
 * lacks the field it asks about — so without this, the backlog lists
 * normally and is invisible to every filter and to search.
 *
 * Each key is derived from what the document already says — `kind` from
 * `contentType`, the name keys from `fileName` and then from the details read
 * from inside the file (`embeddedMetadata`, AGL-3339), `hasAlt` from `alt`,
 * `orientation` from the stored pixel size — through `lib/media-filter-keys.mjs`,
 * which is held to the fixtures the TypeScript function's spec runs
 * (`npm run test:media-filter-keys`, which runs this `--self-test` too).
 *
 * Only the site and organization libraries are touched: `hosts/{id}/media`
 * and `orgs/{id}/media`. A collection of that name anywhere else belongs to
 * something else and is skipped.
 *
 * ## Idempotence and interruption
 *
 * A document whose keys already match is never written, so a re-run is a
 * no-op and an interrupted run is finished by the next. Writes touch only the
 * derived keys and a missing `folderId`, in batches of 400. Nothing is
 * deleted. Run it again after a deploy that changes a writer: a document
 * written by the old code between the two runs is stamped by the second.
 * Run it AFTER `backfill-media-embedded-metadata.mjs`, which writes the
 * details this folds into the search keys.
 *
 * ## Running it
 *
 * Application Default Credentials against the project to write:
 *
 *     gcloud auth application-default login
 *     GOOGLE_CLOUD_PROJECT=<project> node tools/scripts/backfill-media-filter-keys.mjs          # dry run
 *     GOOGLE_CLOUD_PROJECT=<project> node tools/scripts/backfill-media-filter-keys.mjs --apply  # write
 *
 * A self-hosted install runs the same two commands against its own project.
 */
import { applicationDefault, initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import { parseDeployArgs } from './lib/deploy-args.mjs'
import { mediaFilterKeys } from './lib/media-filter-keys.mjs'

const args = parseDeployArgs({
  command: 'backfill-media-filter-keys',
  summary:
    'Stamp the media library filter and search keys onto media documents ' +
    'that predate them. Writes to the live project with --apply.',
  effect: { gerund: 'writing', past: 'WRITTEN', failure: 'could not run' },
  flags: [
    { flag: '--apply', key: 'apply', describe: 'Write. Without it, a dry run.' },
    { flag: '--self-test', key: 'selfTest', describe: 'Run the fixtures, touching no project.' },
  ],
})

/** Documents per batch; Firestore allows 500 writes, and this leaves room. */
const BATCH = 400
/** Documents read per page of the scan. */
const PAGE = 1000
/** The collections a media library lives under. */
const LIBRARY_PARENTS = new Set(['hosts', 'orgs'])

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)

/**
 * What a media document should be stamped with, or a skip. Pure, for the
 * self-test.
 *
 * @param {Record<string, unknown>} data the document
 * @returns {{ update: Record<string, unknown> } | { skip: 'current' }}
 */
export function planMedia(data) {
  const update = {}
  const keys = mediaFilterKeys(data)
  for (const [field, value] of Object.entries(keys)) {
    if (!same(data[field], value)) update[field] = value
  }
  // "No folder" is `folderId == null`, which a missing field never matches.
  if (data.folderId === undefined) update.folderId = null
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
  // The keys themselves are held to the shared fixtures by
  // `media-filter-keys.test.mjs`; this asserts what the backfill decides.
  const legacy = {
    fileName: 'hero.jpg',
    contentType: 'image/jpeg',
    alt: 'Hero',
    width: 1600,
    height: 900,
  }
  const current = { ...legacy, ...mediaFilterKeys(legacy), folderId: null }
  const detailed = {
    version: 1,
    format: 'jpeg',
    contentSha256: 's1',
    fields: [{ key: 'title', label: 'Title', group: 'description', value: 'Harbor at dawn' }],
  }
  const planCases = [
    ['a legacy document', legacy, { update: { ...mediaFilterKeys(legacy), folderId: null } }],
    ['a current document', current, { skip: 'current' }],
    ['a renamed document with stale keys', { ...current, fileName: 'banner.jpg' }, null],
    [
      'a document whose size is unknown is stamped with no orientation',
      { fileName: 'notes.txt', contentType: 'text/plain', folderId: 'f1' },
      { update: mediaFilterKeys({ fileName: 'notes.txt', contentType: 'text/plain' }) },
    ],
    ['a foldered legacy document keeps its folder', { ...legacy, folderId: 'f1' }, { update: mediaFilterKeys(legacy) }],
    [
      'a document whose details were read after its keys gains their words (AGL-3339)',
      { ...current, contentSha256: 's1', embeddedMetadata: detailed },
      { update: { nameTokens: mediaFilterKeys({ ...legacy, contentSha256: 's1', embeddedMetadata: detailed }).nameTokens } },
    ],
  ]
  for (const [name, data, expected] of planCases) {
    const got = planMedia(data)
    if (expected) {
      check(`${name}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(got)}`, same(got, expected))
    } else {
      check(`${name}: restamps the name keys`, 'update' in got && 'nameTokens' in got.update && !('kind' in got.update))
    }
  }
  // Idempotent: a document the plan stamped plans nothing the second time.
  for (const [name, data] of planCases) {
    const once = planMedia(data)
    const stamped = 'update' in once ? { ...data, ...once.update } : data
    check(`${name}: re-run is a no-op`, 'skip' in planMedia(stamped))
  }
  console.log(failed ? `self-test: ${failed} of ${total} failed` : `self-test: ${total}/${total} passed`)
  process.exit(failed ? 1 : 0)
}

async function main() {
  if (args.selfTest) return selfTest()
  initializeApp({ credential: applicationDefault() })
  const firestore = getFirestore()
  const counts = { scanned: 0, skippedParent: 0, current: 0, stamped: 0, folderless: 0, written: 0 }
  let cursor = null
  let batch = firestore.batch()
  let pending = 0
  for (;;) {
    let page = firestore.collectionGroup('media').orderBy('__name__').limit(PAGE)
    if (cursor) page = page.startAfter(cursor)
    const snapshot = await page.get()
    if (snapshot.empty) break
    for (const doc of snapshot.docs) {
      counts.scanned += 1
      const library = doc.ref.parent.parent?.parent
      if (!library || library.parent || !LIBRARY_PARENTS.has(library.id)) {
        counts.skippedParent += 1
        continue
      }
      const plan = planMedia(doc.data())
      if ('skip' in plan) {
        counts.current += 1
        continue
      }
      counts.stamped += 1
      if ('folderId' in plan.update) counts.folderless += 1
      if (!args.apply) continue
      batch.update(doc.ref, plan.update)
      pending += 1
      if (pending >= BATCH) {
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
  console.log(
    args.apply
      ? 'backfill-media-filter-keys: APPLIED'
      : 'backfill-media-filter-keys: DRY RUN (nothing written)',
  )
  console.log(`  scanned                ${counts.scanned}`)
  console.log(`  not a library          ${counts.skippedParent}`)
  console.log(`  already current        ${counts.current}`)
  console.log(`  to stamp               ${counts.stamped}`)
  console.log(`    of which no folderId ${counts.folderless}`)
  if (args.apply) console.log(`  written                ${counts.written}`)
}

await main()
