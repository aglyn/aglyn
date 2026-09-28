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
 * Stamp the fields the CRM lists query onto every CRM record written before
 * them (AGL-3321).
 *
 * Every filter and search word on the Leads, Contacts, Companies, Deals and
 * Tasks lists is a predicate on the list's Firestore query, and a query can
 * only find a record carrying the field it asks for. The writers now stamp
 * them (`crmListFields` in `libs/aglyn/src/lib/app-utils/crm.ts`); a record
 * written before carries none, and so still LISTS but answers no search and
 * no served filter. This brings each record level:
 *
 *   leads       `searchTokens`, `scopedSearchTokens`, `status` (`new` for a
 *               lead nobody touched — the Open view asks `status in [new,
 *               working]`), `leadSourceKey`, `emailStatus`
 *   contacts    `searchTokens`, `scopedSearchTokens`, `facetKeys`,
 *               `emailStatus`, and `nextTaskAtMs: null` where absent
 *   companies   `searchTokens`, `scopedSearchTokens`, `nextTaskAtMs: null`
 *   deals       `searchTokens`, `scopedSearchTokens`, `nextTaskAtMs: null`
 *   crmTasks    `searchTokens`, `scopedSearchTokens`, `dueAtMs: null` where
 *               absent (every task view orders by it)
 *   contactFields  the custom field DEFINITIONS the CRM › Fields table asks
 *               for (AGL-3335): `object` (`contact` for a definition made
 *               before companies and deals had fields), `required` as a
 *               boolean, and `searchTokens` from its name and key
 *
 * The fields are built by `lib/org-record-list-fields.mjs`, held to the fixtures
 * the library's spec asserts, so the backfill cannot stamp a spelling the
 * writers and the queries do not use.
 *
 * ## Idempotence and interruption
 *
 * A record already carrying every field as computed is counted as current
 * and not written, so a second run writes nothing, and an interrupted run is
 * finished by the next. Only the list fields are written — never
 * `updatedAt`, which the lists order by — in batches of 400. Nothing is
 * deleted.
 *
 * ## Running it
 *
 * Application Default Credentials against the project to write:
 *
 *     gcloud auth application-default login
 *     GOOGLE_CLOUD_PROJECT=<project> node tools/scripts/backfill-crm-list-fields.mjs          # dry run
 *     GOOGLE_CLOUD_PROJECT=<project> node tools/scripts/backfill-crm-list-fields.mjs --apply  # write
 *
 * `--org <id>` limits the run to one organization, `--collection <name>` to
 * one of the five collections, and `--self-test` runs the fixtures touching
 * no project. A self-hosted install runs the same commands against its own
 * project.
 */
import { readFileSync } from 'node:fs'
import { applicationDefault, initializeApp } from 'firebase-admin/app'
import { FieldPath, getFirestore } from 'firebase-admin/firestore'
import { parseDeployArgs } from './lib/deploy-args.mjs'
import {
  crmFieldListFieldsBackfillPatch,
  crmListFieldsBackfillPatch,
} from './lib/org-record-list-fields.mjs'

const COLLECTIONS = ['leads', 'contacts', 'companies', 'deals', 'crmTasks', 'contactFields']

const args = parseDeployArgs({
  command: 'backfill-crm-list-fields',
  summary:
    'Stamp the fields the CRM lists filter and search by onto records written ' +
    'before them. Writes to the live project with --apply.',
  effect: { gerund: 'writing', past: 'WRITTEN', failure: 'could not run' },
  flags: [
    { flag: '--apply', key: 'apply', describe: 'Write. Without it, a dry run.' },
    { flag: '--self-test', key: 'selfTest', describe: 'Run the fixtures, touching no project.' },
    { flag: '--org', key: 'org', value: 'string', describe: 'Limit to one organization.' },
    {
      flag: '--collection',
      key: 'collection',
      value: 'string',
      describe: `Limit to one of: ${COLLECTIONS.join(', ')}.`,
    },
  ],
})

/** Documents per batch; Firestore allows 500, and this leaves room. */
const BATCH = 400
/** Documents read per page of the scan. */
const PAGE = 500

/**
 * One record's verdict, so the dry run and the apply run cannot disagree.
 *
 * @param {string} collection
 * @param {Record<string, unknown>} data
 * @returns {{ update: Record<string, unknown> } | { skip: 'current' }}
 */
export function planRecord(collection, data) {
  const update =
    collection === 'contactFields'
      ? crmFieldListFieldsBackfillPatch(data)
      : crmListFieldsBackfillPatch(collection, data)
  return Object.keys(update).length ? { update } : { skip: 'current' }
}

function selfTest() {
  const fixtures = JSON.parse(
    readFileSync(new URL('./lib/org-record-list-fields.fixtures.json', import.meta.url), 'utf8'),
  )
  let failed = 0
  let total = 0
  const check = (name, ok) => {
    total += 1
    if (!ok) {
      failed += 1
      console.error(`FAIL ${name}`)
    }
  }
  for (const [at, { collection, record, expected }] of fixtures.records.entries()) {
    const plan = planRecord(collection, record)
    check(`#${at} ${collection}: a bare record is stamped`, 'update' in plan)
    const stamped = 'update' in plan ? { ...record, ...plan.update } : record
    for (const [field, value] of Object.entries(expected)) {
      check(
        `#${at} ${collection}: ${field} as the library computes it`,
        JSON.stringify(stamped[field]) === JSON.stringify(value),
      )
    }
    check(`#${at} ${collection}: a re-run is a no-op`, 'skip' in planRecord(collection, stamped))
    check(`#${at} ${collection}: updatedAt is never written`, !('updatedAt' in (plan.update ?? {})))
  }
  for (const [at, { record, expected }] of fixtures.fieldDefinitions.entries()) {
    const plan = planRecord('contactFields', record)
    check(`#${at} contactFields: a bare definition is stamped`, 'update' in plan)
    const stamped = 'update' in plan ? { ...record, ...plan.update } : record
    for (const [field, value] of Object.entries(expected)) {
      check(
        `#${at} contactFields: ${field} as the library computes it`,
        JSON.stringify(stamped[field]) === JSON.stringify(value),
      )
    }
    check(`#${at} contactFields: a re-run is a no-op`, 'skip' in planRecord('contactFields', stamped))
  }
  console.log(failed ? `self-test: ${failed} of ${total} failed` : `self-test: ${total}/${total} passed`)
  process.exit(failed ? 1 : 0)
}

async function main() {
  if (args.selfTest) return selfTest()
  if (args.collection && !COLLECTIONS.includes(args.collection)) {
    console.error(`REFUSED — --collection must be one of: ${COLLECTIONS.join(', ')}`)
    process.exitCode = 1
    return
  }
  initializeApp({ credential: applicationDefault() })
  const firestore = getFirestore()
  const collections = args.collection ? [args.collection] : COLLECTIONS
  const orgIds = args.org
    ? [args.org]
    : (await firestore.collection('orgs').select().get()).docs.map((doc) => doc.id)

  const counts = Object.fromEntries(
    collections.map((name) => [name, { scanned: 0, current: 0, stamp: 0, written: 0, fields: {} }]),
  )
  /** One page's writes, committed a batch at a time. */
  const commit = async (writes, tally) => {
    for (let at = 0; at < writes.length; at += BATCH) {
      const batch = firestore.batch()
      const chunk = writes.slice(at, at + BATCH)
      for (const [ref, update] of chunk) batch.update(ref, update)
      await batch.commit()
      tally.written += chunk.length
    }
  }

  for (const orgId of orgIds) {
    for (const name of collections) {
      const tally = counts[name]
      let cursor = null
      for (;;) {
        let page = firestore
          .collection('orgs')
          .doc(orgId)
          .collection(name)
          .orderBy(FieldPath.documentId())
          .limit(PAGE)
        if (cursor) page = page.startAfter(cursor)
        const snapshot = await page.get()
        if (snapshot.empty) break
        const writes = []
        for (const doc of snapshot.docs) {
          tally.scanned += 1
          const plan = planRecord(name, doc.data())
          if ('skip' in plan) {
            tally.current += 1
            continue
          }
          tally.stamp += 1
          for (const field of Object.keys(plan.update)) {
            tally.fields[field] = (tally.fields[field] ?? 0) + 1
          }
          if (args.apply) writes.push([doc.ref, plan.update])
        }
        await commit(writes, tally)
        cursor = snapshot.docs[snapshot.docs.length - 1]
        if (snapshot.size < PAGE) break
      }
    }
  }

  console.log(
    args.apply
      ? 'backfill-crm-list-fields: APPLIED'
      : 'backfill-crm-list-fields: DRY RUN (nothing written)',
  )
  console.log(`  organizations        ${orgIds.length}`)
  for (const name of collections) {
    const tally = counts[name]
    const fields = Object.entries(tally.fields)
      .map(([field, count]) => `${field} ${count}`)
      .join(', ')
    console.log(
      `  ${name.padEnd(10)} scanned ${tally.scanned}, current ${tally.current}, ` +
        `would stamp ${tally.stamp}${args.apply ? `, written ${tally.written}` : ''}` +
        (fields ? ` (${fields})` : ''),
    )
  }
}

await main()
