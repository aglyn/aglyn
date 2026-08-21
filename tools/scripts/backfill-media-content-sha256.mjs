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

// Back-fill `contentSha256` onto existing media documents (AGL-1630).
//
//   node tools/scripts/backfill-media-content-sha256.mjs --collection=orgs
//   node tools/scripts/backfill-media-content-sha256.mjs --collection=hosts
//
//   --apply --confirm=aglyn-main   actually write (BOTH are required)
//   --after=orgs/x/media/y         resume from a cursor the last run printed
//   --limit=10                     rehearse on a few first
//   --json                         machine-readable summary
//
// DRY RUN IS THE DEFAULT AND IT WRITES NOTHING. It reads the documents,
// streams each object through sha256, and reports exactly what `--apply`
// would write — including the digests, so a rehearsal can be diffed against
// a real run.
//
// == WHY THIS EXISTS ==
//
// AGL-1614 added `contentSha256` for NEW writes only. AGL-1629 then made the
// signed-upload route produce one too. Neither touched the back catalogue,
// so every document written before those changes carries at most the legacy
// 16-hex `contentHash` — and quarantine keyed on 64 truncated bits is
// collision-resistant by accident rather than by design.
//
// Nothing is BROKEN while this is unfilled. `mediaQuarantineKeys()` checks
// the strong digest, the legacy hash and the per-asset key, so a legacy
// document is matched exactly as it always was. This buys strength, not
// correctness.
//
// == WHAT IT COSTS, MEASURED RATHER THAN ESTIMATED ==
//
// Production, read-only, 2026-08-20:
//
//   media documents ......... 182   (119 under orgs/, 63 under hosts/)
//   carrying contentSha256 ...  0   — the field postdates every one of them
//   carrying contentHash .... 174
//   carrying no digest ......   8   — per-asset key only, today
//   bytes to read ........... 44,774,216  (42.70 MiB)
//   largest object ..........  7,742,225  (7.38 MiB) — nothing near the ceiling
//   video ...................   0   — 150 image, 32 application
//
//   Storage egress .......... 0.0417 GiB x $0.12/GiB = ~$0.005
//   Firestore ............... 182 reads + up to 182 writes = ~$0.0002
//   Runtime ................. seconds, not minutes
//
// So the bill AGL-1630 was right to be careful about is half a cent at this
// scale, and it converts 174 weak keys and 8 no-key assets into strong ones.
// Re-measure before running it against a grown library; the ceiling below is
// what keeps a future 200 MB video out of the pass.
//
// == THE FIVE RULES IT MUST NOT BREAK ==
//
// 1. `contentHash` IS NOT TOUCHED. It is the ETag `serveMediaCdn` sets and
//    the path segment of the pre-AGL-829 immutable CDN URL. Rewriting it
//    404s embeds still carrying that form and invalidates every stored cache
//    validator at once. Enforced by `backfillPatch`, which returns exactly
//    one key and is asserted with `deepStrictEqual`.
// 2. PER COLLECTION. `orgs/{id}/media` and `hosts/{id}/media` are separate
//    passes and there is deliberately no "everything" mode.
// 3. ADDITIVE ONLY. A document that already has a strong digest is skipped,
//    never overwritten — a route wrote that one from bytes it actually held.
// 4. IDEMPOTENT AND RESUMABLE. Documents are visited in a stable order and
//    the last one processed is printed, so `--after` picks up where a run
//    stopped. Re-running from the start is safe but re-reads objects, which
//    is the expensive half.
// 5. THE QUARANTINE INDEX IS NOT REKEYED. Entries stay exactly as written;
//    the multi-key lookup is what makes them keep working.

import { createHash } from 'node:crypto'

import { initializeApp, applicationDefault } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import { getStorage } from 'firebase-admin/storage'

import {
  MEDIA_STRONG_DIGEST_MAX_BYTES,
  backfillPatch,
  estimateBackfillCost,
  parseBackfillArgs,
  planForDocument,
} from './lib/media-content-sha256-backfill.mjs'

const projectId = process.env.GCLOUD_PROJECT ?? 'aglyn-main'
const parsed = parseBackfillArgs(process.argv.slice(2), { projectId })
if (!parsed.ok) {
  console.error(`REFUSED: ${parsed.error}`)
  process.exit(2)
}

initializeApp({
  credential: applicationDefault(),
  projectId,
  storageBucket: process.env.STORAGE_BUCKET ?? `${projectId}.appspot.com`,
})
const firestore = getFirestore(process.env.FIRESTORE_DATABASE_ID)
const bucket = getStorage().bucket()

const log = (...args) => {
  if (!parsed.json) console.log(...args)
}

log(
  parsed.apply
    ? `APPLYING to ${projectId} — this writes contentSha256 onto ` +
        `${parsed.collection}/*/media documents.`
    : `DRY RUN against ${projectId} (${parsed.collection}). Nothing will be ` +
        'written. Pass --apply --confirm=<projectId> to write.',
)

const summary = {
  projectId,
  collection: parsed.collection,
  apply: parsed.apply,
  documents: 0,
  digested: 0,
  written: 0,
  failed: 0,
  bytesRead: 0,
  skipped: {},
  failures: [],
  /** The last document visited — feed it back as `--after` to resume. */
  cursor: null,
}

const skip = (reason) => {
  summary.skipped[reason] = (summary.skipped[reason] ?? 0) + 1
}

/**
 * Stream one object through sha256.
 *
 * Streamed rather than `download()`ed for the reason `media-strong-digest.ts`
 * gives: at the ceiling a buffered read is 50 MiB resident, and a backfill
 * that OOMs half way through has re-read everything for nothing. A short
 * read returns null rather than a digest of what arrived — a partial digest
 * is a well-formed value that matches nothing, and because it becomes the
 * PREFERRED quarantine key it would shadow the legacy hash that does match.
 */
async function digestObject(storagePath, sizeBytes) {
  const hash = createHash('sha256')
  let read = 0
  for await (const chunk of bucket.file(storagePath).createReadStream()) {
    read += chunk.length
    hash.update(new Uint8Array(chunk))
  }
  if (read !== sizeBytes) {
    throw new Error(`short read: expected ${sizeBytes} bytes, got ${read}`)
  }
  summary.bytesRead += read
  return hash.digest('hex')
}

/**
 * Every media document under one collection, in a stable order.
 *
 * `listDocuments()` on the parent rather than `collectionGroup('media')`,
 * which is what keeps this a per-collection pass (rule 2): a collection
 * group query cannot be restricted to one of the two trees, so it would read
 * both on every run. Parent ids and document ids are both sorted so `--after`
 * means the same thing between runs.
 */
async function* mediaDocuments(collection) {
  const parents = await firestore.collection(collection).listDocuments()
  for (const parent of parents.sort((a, b) => a.id.localeCompare(b.id))) {
    const snapshot = await parent.collection('media').orderBy('__name__').get()
    for (const doc of snapshot.docs) yield doc
  }
}

let started = !parsed.after
for await (const doc of mediaDocuments(parsed.collection)) {
  if (!started) {
    if (doc.ref.path === parsed.after) started = true
    continue
  }
  if (summary.digested >= parsed.limit) break

  summary.documents += 1
  summary.cursor = doc.ref.path

  const plan = planForDocument({ path: doc.ref.path, data: doc.data() })
  if (plan.action === 'skip') {
    skip(plan.reason)
    continue
  }

  let contentSha256
  try {
    contentSha256 = await digestObject(plan.storagePath, plan.sizeBytes)
  } catch (error) {
    // Fail soft per document: one missing object must not abandon the pass.
    summary.failed += 1
    summary.failures.push({ path: doc.ref.path, error: String(error?.message ?? error) })
    continue
  }
  summary.digested += 1
  log(`  ${doc.ref.path}  ${plan.sizeBytes}B  ${contentSha256}`)

  if (!parsed.apply) continue
  try {
    // `update()`, never `set(..., { merge: true })`: this ref carries no
    // converter and must not gain one, and `update` fails loudly if the
    // document vanished mid-pass rather than resurrecting it.
    await doc.ref.update(backfillPatch(contentSha256))
    summary.written += 1
  } catch (error) {
    summary.failed += 1
    summary.failures.push({ path: doc.ref.path, error: String(error?.message ?? error) })
  }
}

const cost = estimateBackfillCost({
  bytes: summary.bytesRead,
  documents: summary.documents,
})

if (parsed.json) {
  console.log(JSON.stringify({ ...summary, cost, ceiling: MEDIA_STRONG_DIGEST_MAX_BYTES }, null, 2))
} else {
  log('')
  log(`documents visited : ${summary.documents}`)
  log(`digested          : ${summary.digested}`)
  log(`written           : ${summary.written}${parsed.apply ? '' : ' (dry run)'}`)
  log(`failed            : ${summary.failed}`)
  log(`bytes read        : ${summary.bytesRead} (${(summary.bytesRead / 1048576).toFixed(2)} MiB)`)
  log(`egress estimate   : $${cost.egressUsd.toFixed(5)}`)
  for (const [reason, count] of Object.entries(summary.skipped)) {
    log(`skipped:${reason.padEnd(14)}: ${count}`)
  }
  for (const failure of summary.failures) {
    log(`  FAILED ${failure.path}: ${failure.error}`)
  }
  if (summary.cursor) log(`resume with       : --after=${summary.cursor}`)
  if (!parsed.apply) {
    log('')
    log('Nothing was written. Re-run with --apply --confirm=<projectId>.')
  }
}

process.exit(summary.failed > 0 ? 1 : 0)
