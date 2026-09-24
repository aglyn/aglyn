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

// Stamp every content entry with the console's Published sort key (AGL-3323).
//
//   GOOGLE_CLOUD_PROJECT=aglyn-main node tools/scripts/backfill-entry-publish-sort.mjs
//   GOOGLE_CLOUD_PROJECT=aglyn-main node tools/scripts/backfill-entry-publish-sort.mjs --host=<hostId>
//   GOOGLE_CLOUD_PROJECT=aglyn-main node tools/scripts/backfill-entry-publish-sort.mjs --apply
//
// DRY RUN BY DEFAULT. `--apply` writes.
//
// ## What it writes
//
// `publishSortAt` on every `hosts/{h}/collections/{c}/entries/{e}`: the
// entry's `publishAt` while it is scheduled, its `publishedAt` otherwise, and
// NO field at all when it has neither — the rule `entryPublishSortStamp` in
// `libs/aglyn/src/lib/app-utils/collection-entry-date.ts` states, restated
// here because a script cannot import the TypeScript. The console's entries
// table walks this field; an entry the live writers stamped before they knew
// about it would otherwise sort as undated, after every dated entry.
//
// Nothing else on the entry is touched — not `updatedAt`, which is what
// `Article.dateModified` reads.
//
// ## Idempotence
//
// The value is recomputed from the entry's own fields every run and written
// only where the stored key differs, so a second run plans zero. A key on an
// entry that should have none (a draft) is removed.
//
// ## Order against the promotion
//
// Run it AFTER the promotion that ships the writers. Before that, a publish
// through the old console writes no key, and the entry sorts as undated
// until a re-run finds it.

import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { FieldValue, Timestamp } from 'firebase-admin/firestore'
import { parseDeployArgs } from './lib/deploy-args.mjs'
import { commitAll, connectFirestore, everyDocument } from './lib/firestore-backfill.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = join(here, '..', '..')

const FIELD = 'publishSortAt'

const args = parseDeployArgs({
  command: 'backfill-entry-publish-sort',
  summary:
    'Stamp every content entry with publishSortAt, the key the console sorts ' +
    'its Published column by. Writes to the named project with --apply.',
  effect: { gerund: 'writing', past: 'WRITTEN', failure: 'could not run' },
  flags: [
    { flag: '--apply', key: 'apply', describe: 'Write. Without it, a dry run.' },
    { flag: '--host', key: 'host', value: 'string', describe: 'Limit to one host id.' },
  ],
})
const apply = Boolean(args.apply)
const onlyHost = args.host

/** `entryPublishSortStamp`, restated. */
function wanted(data) {
  if (data.status === 'scheduled' && data.publishAt) return data.publishAt
  return data.publishedAt ?? null
}

function same(a, b) {
  if (a instanceof Timestamp && b instanceof Timestamp) return a.isEqual(b)
  return a === b
}

const db = connectFirestore({ repoRoot: REPO_ROOT, apply })

const totals = {
  hosts: 0,
  collections: 0,
  entries: 0,
  set: 0,
  removed: 0,
  already: 0,
  undated: 0,
  byStatus: {},
}
const writes = []
const samples = []

const hostIds = onlyHost
  ? [onlyHost]
  : (await db.collection('hosts').listDocuments()).map((ref) => ref.id).sort()

for (const hostId of hostIds) {
  totals.hosts += 1
  const collections = db.collection('hosts').doc(hostId).collection('collections')
  for await (const collection of everyDocument(collections)) {
    totals.collections += 1
    for await (const entry of everyDocument(collection.ref.collection('entries'))) {
      totals.entries += 1
      const data = entry.data() ?? {}
      const status = String(data.status ?? '(none)')
      totals.byStatus[status] = (totals.byStatus[status] ?? 0) + 1
      const want = wanted(data)
      const have = data[FIELD]
      if (want === null) {
        if (have === undefined) {
          totals.undated += 1
          continue
        }
        totals.removed += 1
        writes.push({ kind: 'update', ref: entry.ref, value: { [FIELD]: FieldValue.delete() } })
        continue
      }
      if (have !== undefined && same(have, want)) {
        totals.already += 1
        continue
      }
      totals.set += 1
      writes.push({ kind: 'update', ref: entry.ref, value: { [FIELD]: want } })
      if (status === 'scheduled' && samples.length < 20) {
        samples.push(`${entry.ref.path}  scheduled → ${want.toDate?.().toISOString?.() ?? want}`)
      }
    }
  }
}

console.log(
  `scanned ${totals.hosts} hosts, ${totals.collections} collections, ${totals.entries} entries`,
)
console.log(`  by status   ${JSON.stringify(totals.byStatus)}`)
console.log(`  to stamp    ${totals.set}`)
console.log(`  to remove   ${totals.removed}`)
console.log(`  already set ${totals.already}`)
console.log(`  undated     ${totals.undated} (drafts; no key, by design)`)
for (const line of samples) console.log(`  ${line}`)

if (!apply) {
  console.log(`DRY RUN — ${writes.length} writes planned, NOTHING WAS WRITTEN.`)
} else {
  await commitAll(db, writes)
  console.log(`APPLIED — ${writes.length} writes committed.`)
}
