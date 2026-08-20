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

// The decision half of the `contentSha256` backfill (AGL-1630).
//
// Separated from the runner so the rules that could destroy customer media
// are unit-tested rather than reasoned about — see
// `media-content-sha256-backfill.test.mjs`. The runner does Firestore and
// Storage; everything here is pure.

/**
 * Mirrors `MEDIA_STRONG_DIGEST_MAX_BYTES` in
 * `libs/tenant/data/admin/src/lib/server/media-strong-digest.ts`.
 *
 * A `.mjs` script cannot import the TypeScript constant, so the number is
 * duplicated — and the test reads the TS file and asserts the two agree,
 * because a mirror nobody checks is a mirror that drifts. Drift here means
 * the backfill and the upload route disagree about which objects deserve a
 * strong digest, which is the exact split this issue exists to close.
 */
export const MEDIA_STRONG_DIGEST_MAX_BYTES = 50 * 1024 * 1024

/** The two media trees. Separate passes, never one collectionGroup sweep. */
export const MEDIA_COLLECTIONS = ['orgs', 'hosts']

/**
 * Parse and GATE the command line.
 *
 * Three locks, and the reason each exists:
 *
 *  1. **`--collection` is required.** AGL-1630 asks for per-collection
 *     passes. A `collectionGroup('media')` sweep would be one command that
 *     touches every org and every host library at once, which is precisely
 *     the blast radius a gated backfill is supposed not to have.
 *  2. **Dry run is the default.** Nothing opts INTO safety; `--apply` opts
 *     out of it.
 *  3. **`--apply` requires `--confirm=<projectId>`.** One flag must not be
 *     able to write. Typing the project id out is also what stops a command
 *     rehearsed against one project being pasted at another.
 */
export function parseBackfillArgs(argv = [], options = {}) {
  const projectId = options.projectId ?? 'aglyn-main'
  const list = Array.isArray(argv) ? argv.map(String) : []
  const flag = (name) => list.includes(`--${name}`)
  const value = (name) => {
    const found = list.find((entry) => entry.startsWith(`--${name}=`))
    return found ? found.slice(name.length + 3) : null
  }

  const refuse = (error) => ({ ok: false, error })

  const collection = value('collection')
  if (!collection) {
    return refuse(
      'Pass --collection=orgs or --collection=hosts. These are separate ' +
        'passes on purpose; there is deliberately no "everything" mode.',
    )
  }
  if (!MEDIA_COLLECTIONS.includes(collection)) {
    return refuse(
      `Unknown --collection=${collection}. Expected one of: ` +
        `${MEDIA_COLLECTIONS.join(', ')}.`,
    )
  }

  const apply = flag('apply')
  const confirm = value('confirm')
  if (apply && !confirm) {
    return refuse(
      `--apply also needs --confirm=${projectId}. One flag must not be ` +
        'able to write to production media documents.',
    )
  }
  if (apply && confirm !== projectId) {
    return refuse(
      `--confirm=${confirm} does not match the project this run is pointed ` +
        `at (${projectId}). Refusing rather than guessing which one you meant.`,
    )
  }

  const limitRaw = value('limit')
  const limit = limitRaw === null ? Infinity : Number(limitRaw)

  return {
    ok: true,
    error: null,
    collection,
    apply,
    confirm: confirm ?? null,
    projectId,
    /** Resume cursor — a document path. See the runner's ordering note. */
    after: value('after'),
    limit: Number.isFinite(limit) && limit > 0 ? limit : Infinity,
    json: flag('json'),
  }
}

/**
 * What to do with one media document.
 *
 * `skip` reasons are values, not log lines, so the runner can count them and
 * the summary can say WHY a document was left alone. "Skipped: 8" with no
 * breakdown is how a backfill quietly does nothing.
 */
export function planForDocument(entry) {
  const data = (entry && entry.data) || {}

  // Additive only. A digest a route wrote came from bytes the server
  // genuinely held; this one comes from bytes re-read later. Where they
  // disagree the route is right, and overwriting would silently rewrite a
  // key a live quarantine entry may be pointing at.
  if (typeof data.contentSha256 === 'string' && data.contentSha256.trim()) {
    return { action: 'skip', reason: 'already-strong' }
  }
  if (typeof data.storagePath !== 'string' || !data.storagePath.trim()) {
    return { action: 'skip', reason: 'no-object' }
  }

  const sizeBytes = Number(data.sizeBytes)
  if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) {
    // A composite object reports no size, and an unknown size is the one
    // shape that cannot be bounded — so it is skipped rather than read.
    return { action: 'skip', reason: 'unknown-size' }
  }
  if (sizeBytes > MEDIA_STRONG_DIGEST_MAX_BYTES) {
    return { action: 'skip', reason: 'over-ceiling' }
  }

  // Trashed documents are digested deliberately: a restore brings the bytes
  // straight back, and a takedown notice does not stop applying because the
  // customer tidied up.
  return { action: 'digest', storagePath: data.storagePath, sizeBytes }
}

const FULL_WIDTH_HEX = /^[0-9a-f]{64}$/

/**
 * The Firestore patch for one backfilled document. ONE key, and the test
 * asserts that with `deepStrictEqual` because the failure mode is an extra
 * key rather than a missing one.
 *
 * `contentHash` is deliberately absent and must stay absent. It is the ETag
 * `serveMediaCdn` sets and the path segment of the pre-AGL-829 immutable CDN
 * URL; rewriting it 404s every embed still carrying that form and
 * invalidates every stored cache validator at once. Nothing has minted that
 * URL since AGL-829, but `serveMediaCdn` still accepts it and old embeds
 * still send it.
 *
 * Throws on anything that is not a full-width lower-case hex digest. A
 * malformed value here would be written as the PREFERRED quarantine key and
 * would shadow the legacy hash that does match — a live takedown quietly
 * lifting itself, which is the one failure this subsystem may not have.
 */
export function backfillPatch(contentSha256) {
  if (typeof contentSha256 !== 'string' || !FULL_WIDTH_HEX.test(contentSha256)) {
    throw new Error(
      `refusing to write a malformed contentSha256: ${JSON.stringify(contentSha256)}`,
    )
  }
  return { contentSha256 }
}

/** Cost of a planned pass, for the dry run's summary. */
export function estimateBackfillCost(totals) {
  const bytes = Number(totals?.bytes ?? 0)
  const documents = Number(totals?.documents ?? 0)
  const gib = bytes / 1024 / 1024 / 1024
  return {
    bytes,
    gib,
    // Cloud Storage internet egress, general destinations.
    egressUsd: gib * 0.12,
    // Firestore: one read per document in the pass, one write per digest.
    firestoreUsd: (documents / 100000) * 0.06 + (documents / 100000) * 0.18,
  }
}
