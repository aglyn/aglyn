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
 * Stamp `nameLower`, `nameTokens` and `schemaType` onto every content author
 * written before the fields existed (AGL-3321).
 *
 * The console's Authors table filters and searches on its Firestore query:
 * Name "contains" and the quick search by `array-contains` on `nameTokens`,
 * Name "is" by equality on `nameLower`, and Type by equality on
 * `schemaType`. Every author write stamps all three now, through
 * `contentAuthorQueryFields` in
 * `libs/aglyn/src/lib/app-utils/content-authors.ts`: the resources route's
 * create, the authors tab's edit, the bundle import. An author written before
 * that has none of them, and a query cannot find a document by a field it
 * lacks — so without this, the backlog still LISTS, ordered by name, but no
 * filter and no search finds it.
 *
 * All three are taken from what the record already says:
 *
 *   `nameLower`, `nameTokens`   from `name`, through
 *                               `tools/scripts/lib/name-search-tokens.mjs`
 *                               (the one script-side twin of the
 *                               library's name keys);
 *   `schemaType`                from `type`, read the way
 *                               `contentAuthorSchemaType` reads it — see
 *                               `schemaTypeOf` below.
 *
 * ## What it touches
 *
 * `hosts/{hostId}/authors/{authorId}`, and on each only the three fields —
 * not `type`, which older bundles spell as a string and which every reader
 * already coerces, and not `updatedAt`. Nothing is deleted.
 *
 * ## Idempotence and interruption
 *
 * An author whose three fields already equal what its name and type give is
 * never written, so a re-run is a no-op and an interrupted run is finished by
 * the next.
 *
 * ## Running it
 *
 * Application Default Credentials against the project to write, AFTER the
 * promotion that ships the writers:
 *
 *     gcloud auth application-default login
 *     GOOGLE_CLOUD_PROJECT=<project> node tools/scripts/backfill-authors-search-fields.mjs                 # dry run
 *     GOOGLE_CLOUD_PROJECT=<project> node tools/scripts/backfill-authors-search-fields.mjs --host=<hostId> # one site
 *     GOOGLE_CLOUD_PROJECT=<project> node tools/scripts/backfill-authors-search-fields.mjs --apply         # write
 *
 *     node tools/scripts/backfill-authors-search-fields.mjs --self-test
 *
 * A self-hosted install runs the same commands against its own project.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseDeployArgs } from './lib/deploy-args.mjs'
import { commitAll, connectFirestore, everyDocument } from './lib/firestore-backfill.mjs'
import {
  nameSearchKey,
  nameSearchTokens,
  sameSearchTokens,
} from './lib/name-search-tokens.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = join(here, '..', '..')

const args = parseDeployArgs({
  command: 'backfill-authors-search-fields',
  summary:
    'Stamp nameLower, nameTokens and schemaType onto content authors written ' +
    'before them, so the console Authors table can filter and search them. ' +
    'Writes to the named project with --apply.',
  effect: { gerund: 'writing', past: 'WRITTEN', failure: 'could not run' },
  flags: [
    { flag: '--apply', key: 'apply', describe: 'Write. Without it, a dry run.' },
    { flag: '--self-test', key: 'selfTest', describe: 'Run the fixtures, touching no project.' },
    { flag: '--host', key: 'host', value: 'string', describe: 'Limit to one host id.' },
  ],
})

/** `HostEntityType.PERSON`. */
const PERSON = 0x2

/**
 * How `contentAuthorSchemaType` (`libs/aglyn/src/lib/app-utils/content-authors.ts`)
 * reads a stored `type`: a number, a numeric string, or nothing — `2` in any
 * spelling is a Person, everything else an Organization. A script cannot
 * import the library, so both sides answer `lib/author-schema-type.fixtures.json`:
 * the library's `content-query-fields.spec.ts` and this script's `--self-test`.
 *
 * @param {unknown} type
 * @returns {'Person' | 'Organization'}
 */
function schemaTypeOf(type) {
  return Number(type) === PERSON ? 'Person' : 'Organization'
}

/**
 * What an author should be stamped with, or a skip. Pure, for the self-test.
 *
 * @param {Record<string, unknown>} data the author
 * @returns {{ update: Record<string, unknown> } | { skip: 'current' }}
 */
export function planAuthor(data) {
  const name = typeof data.name === 'string' ? data.name : ''
  const update = {}
  const nameLower = nameSearchKey(name)
  if (data.nameLower !== nameLower) update.nameLower = nameLower
  const nameTokens = nameSearchTokens(name)
  if (!sameSearchTokens(data.nameTokens, nameTokens)) update.nameTokens = nameTokens
  const schemaType = schemaTypeOf(data.type)
  if (data.schemaType !== schemaType) update.schemaType = schemaType
  return Object.keys(update).length ? { update } : { skip: 'current' }
}

function selfTest() {
  const types = JSON.parse(
    readFileSync(join(here, 'lib', 'author-schema-type.fixtures.json'), 'utf8'),
  )
  // The name keys are `name-search-tokens.test.mjs`'s to hold to the
  // library's fixtures; this holds the schema type and the plan.
  const failures = []
  const check = (name, ok) => {
    if (!ok) failures.push(name)
  }
  for (const entry of types.cases) {
    const got = schemaTypeOf(entry.type)
    check(`type ${JSON.stringify(entry.type)}: expected ${entry.schemaType}, got ${got}`, got === entry.schemaType)
  }
  const DANA = { nameLower: 'dana smith', nameTokens: nameSearchTokens('Dana Smith') }
  const cases = [
    ['a legacy person', { name: 'Dana Smith', type: 2 }, { update: { ...DANA, schemaType: 'Person' } }],
    ['a legacy organization spelled as a string', { name: 'Dana Smith', type: '1' }, { update: { ...DANA, schemaType: 'Organization' } }],
    ['a legacy author with no type', { name: 'Dana Smith' }, { update: { ...DANA, schemaType: 'Organization' } }],
    ['a current author', { name: 'Dana Smith', type: 2, ...DANA, schemaType: 'Person' }, { skip: 'current' }],
    ['a renamed author with a stale key', { name: 'Dana Smith', type: 2, ...DANA, nameLower: 'dana', schemaType: 'Person' }, { update: { nameLower: 'dana smith' } }],
    ['a retyped author', { name: 'Dana Smith', type: 1, ...DANA, schemaType: 'Person' }, { update: { schemaType: 'Organization' } }],
  ]
  for (const [name, data, expected] of cases) {
    const got = planAuthor(data)
    check(`${name}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(got)}`, JSON.stringify(got) === JSON.stringify(expected))
  }
  // Idempotent: an author the plan stamped plans nothing the second time.
  for (const [name, data] of cases) {
    const once = planAuthor(data)
    const stamped = 'update' in once ? { ...data, ...once.update } : data
    check(`${name}: re-run is a no-op`, 'skip' in planAuthor(stamped))
  }
  const total = types.cases.length + cases.length * 2
  for (const failure of failures) console.error(`FAIL ${failure}`)
  console.log(failures.length ? `self-test: ${failures.length} of ${total} failed` : `self-test: ${total}/${total} passed`)
  process.exit(failures.length ? 1 : 0)
}

async function main() {
  if (args.selfTest) return selfTest()
  const apply = Boolean(args.apply)
  const db = connectFirestore({ repoRoot: REPO_ROOT, apply })
  const totals = { hosts: 0, authors: 0, current: 0, stamp: 0, persons: 0, organizations: 0 }
  const writes = []
  const hostIds = args.host
    ? [args.host]
    : (await db.collection('hosts').listDocuments()).map((ref) => ref.id).sort()
  for (const hostId of hostIds) {
    totals.hosts += 1
    const authors = db.collection('hosts').doc(hostId).collection('authors')
    for await (const author of everyDocument(authors)) {
      totals.authors += 1
      const data = author.data() ?? {}
      if (schemaTypeOf(data.type) === 'Person') totals.persons += 1
      else totals.organizations += 1
      const plan = planAuthor(data)
      if ('skip' in plan) {
        totals.current += 1
        continue
      }
      totals.stamp += 1
      writes.push({ kind: 'update', ref: author.ref, value: plan.update })
    }
  }
  console.log(`scanned ${totals.hosts} hosts, ${totals.authors} authors`)
  console.log(`  by type          ${totals.persons} Person, ${totals.organizations} Organization`)
  console.log(`  already current  ${totals.current}`)
  console.log(`  to stamp         ${totals.stamp}`)
  if (!apply) {
    console.log(`DRY RUN — ${writes.length} writes planned, NOTHING WAS WRITTEN.`)
    return
  }
  await commitAll(db, writes)
  console.log(`APPLIED — ${writes.length} writes committed.`)
}

await main()
