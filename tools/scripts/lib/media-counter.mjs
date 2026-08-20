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

// ONE place a script writes a media document, so the document and
// `counters/media` cannot come apart (AGL-1488).
//
// Four script call sites wrote `{hosts|orgs}/{id}/media/{mediaId}` with the
// Admin SDK — past every API route, therefore past every counter write.
// `counters/media` gates the storage quota and, since AGL-1473, is a BILLING
// INPUT. A seed or migration that lands bytes without moving it under-reports
// the scope permanently, and unlike a route a script leaves no trace of which
// run caused which delta.
//
// The direction matters and is always the same: the counter comes out LOW.
// A low counter means the free tier's 250 MB band is measured against less
// storage than exists, so the customer is UNDER-limited — they keep uploading
// past a cap that has already been reached — and metered plans UNDER-bill.
// The failure is silent in both directions of the business.
//
// ## Why a delta and not an increment
//
// Seeds are re-runnable by design; `seed-e2e` and `seed-demo` are expected to
// be run repeatedly against the same emulator data. An unconditional
// `FieldValue.increment(sizeBytes)` would make every re-run over-count, which
// is a worse failure than the one being fixed: an over-counted storage
// counter refuses uploads the customer has paid for.
//
// So the counter moves by the DELTA this write actually causes, computed
// inside a transaction against what is stored:
//
//   count  += the document did not exist ? 1 : 0
//   bytes  += (effective new sizeBytes) - (stored sizeBytes, or 0 if new)
//
// That one rule covers every caller, including `migrate-blog-covers`, which
// does not create anything — it overwrites an existing asset's bytes, so its
// count delta is 0 and its byte delta is signed.
//
// ## The effective size
//
// `seed-scope-fixture`'s third media write carries no `sizeBytes` at all and
// merges onto a document that has one. Reading the payload's missing field as
// 0 would zero out that asset's contribution to the counter while leaving the
// document's own `sizeBytes` untouched — inventing exactly the disagreement
// this module exists to prevent. The effective size is therefore
// `payload.sizeBytes ?? stored.sizeBytes ?? 0`, which is what the document
// will actually hold after a merge.
//
// ## Absolute writes, not FieldValue
//
// The counter is written as a resolved number inside the transaction rather
// than through `FieldValue.increment`. The routes use `increment` because
// they race each other; a seed script is a single process walking a fixture
// list, and an absolute write keeps this module importable by a test without
// dragging in the Admin SDK's sentinel values.

/** Non-negative integer, however the caller spelled it. */
function toBytes(value) {
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? number : 0
}

/**
 * Write a media document and move `counters/media` with it, atomically.
 *
 * @param {object} options
 * @param {any} options.firestore the Firestore instance (for `runTransaction`)
 * @param {any} options.scopeRef `hosts/{id}` or `orgs/{id}` DocumentReference
 * @param {string} options.mediaId the media document id
 * @param {Record<string, unknown>} options.data the fields to merge
 * @param {boolean} [options.countTowardCounter] pass `false` ONLY for a
 *   fixture that is asserting a specific counter value. It is explicit
 *   precisely because the silent version of it is the defect.
 * @returns {Promise<{ created: boolean, countDelta: number, bytesDelta: number }>}
 */
export async function putMediaDocument({
  firestore,
  scopeRef,
  mediaId,
  data,
  countTowardCounter = true,
}) {
  if (!firestore) throw new Error('putMediaDocument needs a `firestore`')
  if (!scopeRef) throw new Error('putMediaDocument needs a `scopeRef`')
  if (!mediaId) throw new Error('putMediaDocument needs a `mediaId`')

  const mediaRef = scopeRef.collection('media').doc(String(mediaId))
  const counterRef = scopeRef.collection('counters').doc('media')

  return firestore.runTransaction(async (transaction) => {
    // BOTH reads first. Firestore requires every read in a transaction to
    // precede every write and the Admin SDK throws otherwise, so the counter
    // cannot be read after the media document has been `set`. The counter is
    // read unconditionally rather than only when it is about to move: a read
    // placed inside the `if` below would sit after the media write.
    const existing = await transaction.get(mediaRef)
    const counter = countTowardCounter ? await transaction.get(counterRef) : null

    const stored = existing.exists ? (existing.data() ?? {}) : {}
    const created = !existing.exists

    // What the document will hold AFTER the merge — not what the payload
    // happens to name. See the header.
    const previousBytes = created ? 0 : toBytes(stored['sizeBytes'])
    const nextBytes =
      data && Object.prototype.hasOwnProperty.call(data, 'sizeBytes')
        ? toBytes(data['sizeBytes'])
        : previousBytes

    const countDelta = created ? 1 : 0
    const bytesDelta = nextBytes - previousBytes

    transaction.set(mediaRef, data, { merge: true })

    if (counter && (countDelta !== 0 || bytesDelta !== 0)) {
      const current = counter.exists ? (counter.data() ?? {}) : {}
      transaction.set(
        counterRef,
        {
          count: Math.max(0, Number(current['count'] ?? 0) + countDelta),
          bytes: Math.max(0, Number(current['bytes'] ?? 0) + bytesDelta),
        },
        { merge: true },
      )
    }

    return { created, countDelta, bytesDelta }
  })
}

/**
 * The invariant, measured: `counters/media` against the collection it counts.
 *
 * This is the equality a reconciliation has to restore by hand today, so it
 * is worth being able to assert directly — after a seed run, and against
 * production read-only.
 *
 * @param {any} scopeRef `hosts/{id}` or `orgs/{id}` DocumentReference
 */
export async function measureMediaCounterDrift(scopeRef) {
  const snapshot = await scopeRef.collection('media').get()
  let count = 0
  let bytes = 0
  for (const doc of snapshot.docs) {
    count += 1
    bytes += toBytes(doc.get('sizeBytes'))
  }
  const counterSnapshot = await scopeRef.collection('counters').doc('media').get()
  const stored = counterSnapshot.exists ? (counterSnapshot.data() ?? {}) : {}
  const counter = {
    count: Number(stored['count'] ?? 0),
    bytes: Number(stored['bytes'] ?? 0),
  }
  const countDrift = counter.count - count
  const bytesDrift = counter.bytes - bytes
  return {
    counter,
    actual: { count, bytes },
    countDrift,
    bytesDrift,
    reconciled: countDrift === 0 && bytesDrift === 0,
  }
}
