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
 * Stamp `titleTokens` onto every content entry written before the field
 * existed (AGL-3321).
 *
 * The console's entries table searches by `array-contains` on `titleTokens`
 * — every word prefix of the title, as `entryTitleSearchFields` in
 * `libs/aglyn/src/lib/app-utils/collection-entries.ts` writes it — on the
 * Firestore query itself, beneath whichever order the table is in. Every
 * writer of `title` stamps it now: the entry editor, the resources route's
 * create, the bundle import, and the seed and changelog scripts. An entry
 * written before that has none, and a query cannot find a document by a
 * field it lacks — so without this, the backlog still LISTS but no word of
 * its title finds it.
 *
 * The tokens are taken from the entry's own `title` through
 * `tools/scripts/lib/name-search-tokens.mjs`, the one script-side twin of
 * `nameSearchTokens`, held to the library's fixtures by its own test. An
 * entry with no title is stamped `[]`, as the writers stamp it.
 *
 * ## What it touches
 *
 * `hosts/{hostId}/collections/{collectionId}/entries/{entryId}`, and on each
 * only `titleTokens` — not `updatedAt`, which is what `Article.dateModified`
 * reads. Nothing is deleted.
 *
 * ## Idempotence and interruption
 *
 * An entry whose stored tokens already equal the computed ones is never
 * written, so a re-run is a no-op and an interrupted run is finished by the
 * next. A retitled entry whose tokens a pre-AGL-3321 console left stale is
 * re-stamped.
 *
 * ## Running it
 *
 * Application Default Credentials against the project to write, AFTER the
 * promotion that ships the writers — before it, an edit through the old
 * console writes a title with no tokens, which a re-run would then find:
 *
 *     gcloud auth application-default login
 *     GOOGLE_CLOUD_PROJECT=<project> node tools/scripts/backfill-entries-title-tokens.mjs                 # dry run
 *     GOOGLE_CLOUD_PROJECT=<project> node tools/scripts/backfill-entries-title-tokens.mjs --host=<hostId> # one site
 *     GOOGLE_CLOUD_PROJECT=<project> node tools/scripts/backfill-entries-title-tokens.mjs --apply         # write
 *
 *     node tools/scripts/backfill-entries-title-tokens.mjs --self-test
 *
 * A self-hosted install runs the same commands against its own project.
 */
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseDeployArgs } from './lib/deploy-args.mjs'
import { commitAll, connectFirestore, everyDocument } from './lib/firestore-backfill.mjs'
import { nameSearchTokens, sameSearchTokens } from './lib/name-search-tokens.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = join(here, '..', '..')

/** `ENTRY_TITLE_TOKENS_FIELD`. */
const FIELD = 'titleTokens'

const args = parseDeployArgs({
  command: 'backfill-entries-title-tokens',
  summary:
    'Stamp titleTokens onto content entries written before it, so the ' +
    'console entries table can search them. Writes to the named project ' +
    'with --apply.',
  effect: { gerund: 'writing', past: 'WRITTEN', failure: 'could not run' },
  flags: [
    { flag: '--apply', key: 'apply', describe: 'Write. Without it, a dry run.' },
    { flag: '--self-test', key: 'selfTest', describe: 'Run the fixtures, touching no project.' },
    { flag: '--host', key: 'host', value: 'string', describe: 'Limit to one host id.' },
  ],
})

/**
 * What an entry should be stamped with, or a skip. Pure, for the self-test.
 *
 * @param {Record<string, unknown>} data the entry
 * @returns {{ update: { titleTokens: string[] } } | { skip: 'current' }}
 */
export function planEntry(data) {
  const tokens = nameSearchTokens(data.title)
  if (sameSearchTokens(data[FIELD], tokens)) return { skip: 'current' }
  return { update: { [FIELD]: tokens } }
}

function selfTest() {
  // The tokens themselves are `name-search-tokens.test.mjs`'s to hold to the
  // library's fixtures; this holds the plan built on them.
  const failures = []
  const check = (name, ok) => {
    if (!ok) failures.push(name)
  }
  const SOURDOUGH = nameSearchTokens('Why our sourdough takes three days')
  const cases = [
    ['a legacy entry', { title: 'Why our sourdough takes three days' }, { update: { titleTokens: SOURDOUGH } }],
    ['a current entry', { title: 'Why our sourdough takes three days', titleTokens: SOURDOUGH }, { skip: 'current' }],
    ['a retitled entry with stale tokens', { title: 'Why our sourdough takes three days', titleTokens: ['old'] }, { update: { titleTokens: SOURDOUGH } }],
    ['an untitled legacy entry', { status: 'draft' }, { update: { titleTokens: [] } }],
    ['an untitled current entry', { status: 'draft', titleTokens: [] }, { skip: 'current' }],
  ]
  for (const [name, data, expected] of cases) {
    const got = planEntry(data)
    check(`${name}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(got)}`, JSON.stringify(got) === JSON.stringify(expected))
  }
  // Idempotent: an entry the plan stamped plans nothing the second time.
  for (const [name, data] of cases) {
    const once = planEntry(data)
    const stamped = 'update' in once ? { ...data, ...once.update } : data
    check(`${name}: re-run is a no-op`, 'skip' in planEntry(stamped))
  }
  const total = cases.length * 2
  for (const failure of failures) console.error(`FAIL ${failure}`)
  console.log(failures.length ? `self-test: ${failures.length} of ${total} failed` : `self-test: ${total}/${total} passed`)
  process.exit(failures.length ? 1 : 0)
}

async function main() {
  if (args.selfTest) return selfTest()
  const apply = Boolean(args.apply)
  const db = connectFirestore({ repoRoot: REPO_ROOT, apply })
  const totals = { hosts: 0, collections: 0, entries: 0, current: 0, untitled: 0, stamp: 0 }
  const writes = []
  const hostIds = args.host
    ? [args.host]
    : (await db.collection('hosts').listDocuments()).map((ref) => ref.id).sort()
  for (const hostId of hostIds) {
    totals.hosts += 1
    const collections = db.collection('hosts').doc(hostId).collection('collections')
    for await (const collection of everyDocument(collections)) {
      totals.collections += 1
      for await (const entry of everyDocument(collection.ref.collection('entries'))) {
        totals.entries += 1
        const data = entry.data() ?? {}
        const plan = planEntry(data)
        if ('skip' in plan) {
          totals.current += 1
          continue
        }
        if (!plan.update[FIELD].length) totals.untitled += 1
        totals.stamp += 1
        writes.push({ kind: 'update', ref: entry.ref, value: plan.update })
      }
    }
  }
  console.log(
    `scanned ${totals.hosts} hosts, ${totals.collections} collections, ${totals.entries} entries`,
  )
  console.log(`  already current  ${totals.current}`)
  console.log(`  to stamp         ${totals.stamp} (${totals.untitled} with no title, stamped [])`)
  if (!apply) {
    console.log(`DRY RUN — ${writes.length} writes planned, NOTHING WAS WRITTEN.`)
    return
  }
  await commitAll(db, writes)
  console.log(`APPLIED — ${writes.length} writes committed.`)
}

await main()
