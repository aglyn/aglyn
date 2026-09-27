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
 * Stamp the fields the Forms list queries onto every form written before
 * they were stored (AGL-3330).
 *
 * The console's Forms list (`hosts/{hostId}/forms`) serves its filters and
 * its search on the query, so a form is found only by fields it carries:
 *
 *  - the search keys `formListFields` writes: `nameLower`, `nameTokens`,
 *    `nameReversed` (the name keys every `displayName`-named document
 *    carries) and `searchTokens` (the search box's name, slug and id words);
 *  - `retired`, the boolean mirror of `archivedAt` the Status filter asks;
 *  - `routing.lead` as a boolean, which Lead routing asks by equality;
 *  - `stats.submissions`, `stats.leads` and `stats.lastSubmissionAtMs` as
 *    `null` where nothing was ever counted, which "is empty" asks.
 *
 * Every create and rename writes them since the field shipped; a form made
 * before that carries none, and a query cannot find a document by a field it
 * lacks. Each value is what the document already means: `retired` is
 * `isFormArchived` (truthy `archivedAt`), a missing lead switch is off, and a
 * null counter reads as the dash an absent one did. Nothing a merchant sees
 * changes. A counter that holds a number is never touched, and neither is
 * `updatedAt`, which the list's Updated filter reads.
 *
 * ## The keys come from the shared script twins
 *
 * A tools script cannot import the TypeScript library, so what to write is
 * decided by `lib/site-form-list-fields.mjs` (`planFormListFields`), whose name
 * keys come from `lib/name-search-tokens.mjs` — the platform's one
 * script-side copy of them. Both twins answer the same fixtures the library
 * does (`npm run test:site-form-list-fields`, which runs `--self-test` too).
 *
 * ## Idempotence and interruption
 *
 * A form whose stored fields already equal the computed ones is not written,
 * so a re-run is a no-op and an interrupted run is finished by the next.
 * Each write is an `update` of only the fields that differ, with the
 * document's read time as a precondition: a form renamed or submitted to
 * between the read and the write is skipped and counted, and the next run
 * reads it again. Nothing is deleted.
 *
 * Only `hosts/{hostId}/forms/{formId}` is touched: the scan is a collection
 * group, and any other collection named `forms` is counted and left alone.
 *
 * ## Running it
 *
 * Application Default Credentials against the project to write:
 *
 *     gcloud auth application-default login
 *     GOOGLE_CLOUD_PROJECT=<project> node tools/scripts/backfill-form-list-fields.mjs          # dry run
 *     GOOGLE_CLOUD_PROJECT=<project> node tools/scripts/backfill-form-list-fields.mjs --apply  # write
 *     node tools/scripts/backfill-form-list-fields.mjs --self-test                             # fixtures only
 *
 * A self-hosted install runs the same commands against its own project.
 */
import { readFileSync } from 'node:fs'
import { applicationDefault, initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import { parseDeployArgs } from './lib/deploy-args.mjs'
import { formListFields, planFormListFields } from './lib/site-form-list-fields.mjs'

const args = parseDeployArgs({
  command: 'backfill-form-list-fields',
  summary:
    'Stamp the Forms list search keys, `retired`, the lead switch and null counters onto ' +
    'forms that carry none. Writes to the live project with --apply.',
  effect: { gerund: 'writing', past: 'WRITTEN', failure: 'could not run' },
  flags: [
    { flag: '--apply', key: 'apply', describe: 'Write. Without it, a dry run.' },
    { flag: '--self-test', key: 'selfTest', describe: 'Run the fixtures, touching no project.' },
  ],
})

/** Documents read per page of the scan. */
const PAGE = 500

/**
 * Every fixture form, planned as a stored document that lacks the fields and
 * as one that carries them: stamped the first time, current the second.
 */
function selfTest() {
  const fixtures = JSON.parse(
    readFileSync(new URL('./lib/site-form-list-fields.fixtures.json', import.meta.url), 'utf8'),
  )
  let failed = 0
  for (const { form, expected } of fixtures.forms) {
    const path = `hosts/h1/forms/${form.id}`
    const bare = planFormListFields(path, { displayName: form.displayName, slug: form.slug })
    const stamped = planFormListFields(path, {
      displayName: form.displayName,
      slug: form.slug,
      ...formListFields(form),
      retired: false,
      routing: { lead: false },
      stats: { submissions: null, leads: null, lastSubmissionAtMs: null },
    })
    const ok =
      'patch' in bare &&
      JSON.stringify(bare.patch.searchTokens) === JSON.stringify(expected.searchTokens) &&
      bare.patch.nameLower === expected.nameLower &&
      'skip' in stamped &&
      stamped.skip === 'current'
    if (!ok) {
      failed += 1
      console.error(`FAIL ${form.id}: bare ${JSON.stringify(bare)}, stamped ${JSON.stringify(stamped)}`)
    }
  }
  const total = fixtures.forms.length
  console.log(failed ? `self-test: ${failed}/${total} failed` : `self-test: ${total}/${total} passed`)
  process.exit(failed ? 1 : 0)
}

async function main() {
  if (args.selfTest) return selfTest()
  initializeApp({ credential: applicationDefault() })
  const firestore = getFirestore()
  const counts = {
    scanned: 0,
    current: 0,
    otherCollections: 0,
    search: 0,
    retired: 0,
    lead: 0,
    counters: 0,
    written: 0,
    raced: 0,
  }
  let cursor = null
  for (;;) {
    let page = firestore.collectionGroup('forms').orderBy('__name__').limit(PAGE)
    if (cursor) page = page.startAfter(cursor)
    const snapshot = await page.get()
    if (snapshot.empty) break
    for (const doc of snapshot.docs) {
      counts.scanned += 1
      const plan = planFormListFields(doc.ref.path, doc.data())
      if ('skip' in plan) {
        if (plan.skip === 'current') counts.current += 1
        else counts.otherCollections += 1
        continue
      }
      for (const reason of plan.reasons) counts[reason] += 1
      if (!args.apply) continue
      try {
        // Only if nothing wrote the form since it was read — see the header.
        await doc.ref.update(plan.patch, { lastUpdateTime: doc.updateTime })
        counts.written += 1
      } catch (error) {
        if (error?.code === 9 || /FAILED_PRECONDITION/i.test(String(error?.message))) {
          counts.raced += 1
          continue
        }
        throw error
      }
    }
    cursor = snapshot.docs[snapshot.docs.length - 1]
    if (snapshot.size < PAGE) break
  }
  console.log(
    args.apply
      ? 'backfill-form-list-fields: APPLIED'
      : 'backfill-form-list-fields: DRY RUN (nothing written)',
  )
  console.log(`  scanned                               ${counts.scanned}`)
  console.log(`  already current                       ${counts.current}`)
  console.log(`  search keys to stamp                  ${counts.search}`)
  console.log(`  retired to mirror                     ${counts.retired}`)
  console.log(`  lead switch to stamp                  ${counts.lead}`)
  console.log(`  null counters to stamp                ${counts.counters}`)
  console.log(`  not hosts/*/forms (left alone)        ${counts.otherCollections}`)
  if (args.apply) {
    console.log(`  written                               ${counts.written}`)
    console.log(`  changed since read (re-run for these) ${counts.raced}`)
  }
}

await main()
