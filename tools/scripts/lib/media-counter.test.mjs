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

// AGL-1488 — a script that writes a media document moves `counters/media`
// with it, and the counter still equals the collection after a re-run.
//
//   node --test tools/scripts/lib/media-counter.test.mjs
//   npm run test:media-counter

import assert from 'node:assert/strict'
import test from 'node:test'

import {
  measureMediaCounterDrift,
  putMediaDocument,
} from './media-counter.mjs'

/**
 * A Firestore double that models the semantics this helper depends on, not a
 * convenient subset. An unfaithful fake here fabricates a green: the whole
 * defect is a counter that disagrees with its collection, so a double whose
 * `set(…, { merge: true })` REPLACES instead of merging would report the
 * invariant holding under the exact write that breaks it.
 *
 * Modelled deliberately:
 *
 *  * `set(data, { merge: true })` merges keys; `set(data)` replaces the
 *    document. A merge that omits `sizeBytes` LEAVES the stored one — which
 *    is `seed-scope-fixture`'s third media write, and the reason the helper
 *    resolves an effective size rather than trusting the payload.
 *  * `.doc(id)` is stable by path: two calls give refs that address the same
 *    document. A double keyed by object identity hides double-counting.
 *  * `runTransaction` re-reads through the transaction, and reads must see
 *    writes from earlier transactions but NOT this one's own pending writes.
 *  * a `get()` on an absent document returns `{ exists: false }` rather than
 *    throwing.
 */
function fakeFirestore() {
  /** @type {Map<string, Record<string, unknown>>} */
  const store = new Map()

  const makeRef = (path) => ({
    path,
    id: path.split('/').pop(),
    collection: (name) => makeCollection(`${path}/${name}`),
    async get() {
      return snapshotOf(path)
    },
    async set(data, options) {
      applySet(path, data, options)
    },
  })

  const makeCollection = (path) => ({
    path,
    doc: (id) => makeRef(`${path}/${id}`),
    async get() {
      const prefix = `${path}/`
      const docs = [...store.entries()]
        .filter(
          ([key]) =>
            key.startsWith(prefix) &&
            !key.slice(prefix.length).includes('/'),
        )
        .map(([key]) => snapshotOf(key))
      return { docs, size: docs.length, empty: docs.length === 0 }
    },
  })

  const snapshotOf = (path) => {
    const data = store.get(path)
    return {
      exists: data !== undefined,
      id: path.split('/').pop(),
      ref: makeRef(path),
      data: () => (data === undefined ? undefined : { ...data }),
      get: (field) => data?.[field],
    }
  }

  const applySet = (path, data, options) => {
    const merge = Boolean(options?.merge)
    const existing = merge ? (store.get(path) ?? {}) : {}
    store.set(path, { ...existing, ...data })
  }

  return {
    store,
    collection: makeCollection,
    doc: makeRef,
    async runTransaction(fn) {
      const pending = []
      const transaction = {
        async get(ref) {
          // REAL semantics, and the one that matters most here: Firestore
          // requires every read in a transaction to happen before every
          // write, and the Admin SDK THROWS on a read that follows a `set`.
          // A double that quietly allowed it would have passed a helper that
          // cannot run against Firestore at all — the fake green this whole
          // file exists to not produce.
          if (pending.length > 0) {
            throw new Error(
              'Firestore transactions require all reads to be executed before all writes.',
            )
          }
          return snapshotOf(ref.path)
        },
        set(ref, data, options) {
          pending.push([ref.path, data, options])
          return transaction
        },
      }
      const result = await fn(transaction)
      for (const [path, data, options] of pending) applySet(path, data, options)
      return result
    },
  }
}

const hostRef = (db) => db.collection('hosts').doc('h1')

const counterOf = (db, scope = 'hosts/h1') =>
  db.store.get(`${scope}/counters/media`)

test('a new media document moves the counter by one and by its bytes', async () => {
  const db = fakeFirestore()
  await putMediaDocument({
    firestore: db,
    scopeRef: hostRef(db),
    mediaId: 'seed-hero',
    data: { fileName: 'hero.jpg', contentType: 'image/jpeg', sizeBytes: 120000 },
  })
  assert.deepEqual(counterOf(db), { count: 1, bytes: 120000 })
})

test('re-running the same seed does NOT double-count', async () => {
  // THE invariant. Seeds are re-runnable by design, so an unconditional
  // `increment` would trade an under-count for an over-count — and an
  // over-counted storage counter refuses uploads the customer has paid for.
  const db = fakeFirestore()
  const write = () =>
    putMediaDocument({
      firestore: db,
      scopeRef: hostRef(db),
      mediaId: 'seed-hero',
      data: { fileName: 'hero.jpg', sizeBytes: 120000 },
    })
  await write()
  await write()
  await write()
  assert.deepEqual(counterOf(db), { count: 1, bytes: 120000 })
})

test('rewriting an asset with new bytes moves the counter by the DELTA', async () => {
  // `migrate-blog-covers.mjs` overwrites the object and the doc's `sizeBytes`.
  // The count does not move; the bytes move by the difference, in either
  // direction.
  const db = fakeFirestore()
  await putMediaDocument({
    firestore: db,
    scopeRef: hostRef(db),
    mediaId: 'cover',
    data: { fileName: 'cover.jpg', sizeBytes: 90000 },
  })
  await putMediaDocument({
    firestore: db,
    scopeRef: hostRef(db),
    mediaId: 'cover',
    data: { contentType: 'image/png', sizeBytes: 250000 },
  })
  assert.deepEqual(counterOf(db), { count: 1, bytes: 250000 })

  await putMediaDocument({
    firestore: db,
    scopeRef: hostRef(db),
    mediaId: 'cover',
    data: { sizeBytes: 10000 },
  })
  assert.deepEqual(counterOf(db), { count: 1, bytes: 10000 })
})

test('a merge write that omits sizeBytes leaves the counter alone', async () => {
  // `seed-scope-fixture.mjs`'s `scope-media-preset` write carries no
  // `sizeBytes` at all. Reading the payload's missing field as 0 would
  // silently zero out the asset's contribution.
  const db = fakeFirestore()
  await putMediaDocument({
    firestore: db,
    scopeRef: hostRef(db),
    mediaId: 'preset',
    data: { fileName: 'preset.png', sizeBytes: 1024 },
  })
  await putMediaDocument({
    firestore: db,
    scopeRef: hostRef(db),
    mediaId: 'preset',
    data: { visibleTo: ['org'] },
  })
  assert.deepEqual(counterOf(db), { count: 1, bytes: 1024 })
  assert.equal(db.store.get('hosts/h1/media/preset').fileName, 'preset.png')
  assert.deepEqual(db.store.get('hosts/h1/media/preset').visibleTo, ['org'])
})

test('the counter stays equal to the collection across mixed writes', async () => {
  const db = fakeFirestore()
  for (const [id, size] of [
    ['a', 120000],
    ['b', 120000],
    ['c', 90000],
  ]) {
    await putMediaDocument({
      firestore: db,
      scopeRef: hostRef(db),
      mediaId: id,
      data: { fileName: `${id}.jpg`, sizeBytes: size },
    })
  }
  await putMediaDocument({
    firestore: db,
    scopeRef: hostRef(db),
    mediaId: 'b',
    data: { sizeBytes: 5 },
  })
  const drift = await measureMediaCounterDrift(hostRef(db))
  assert.deepEqual(drift, {
    counter: { count: 3, bytes: 210005 },
    actual: { count: 3, bytes: 210005 },
    countDrift: 0,
    bytesDrift: 0,
    reconciled: true,
  })
})

test('skipping the counter is EXPLICIT, and still writes the document', async () => {
  // An e2e fixture asserting a specific counter value is a real need. It has
  // to be an argument, not the default four call sites arrived at
  // independently.
  const db = fakeFirestore()
  await putMediaDocument({
    firestore: db,
    scopeRef: hostRef(db),
    mediaId: 'x',
    data: { fileName: 'x.jpg', sizeBytes: 42 },
    countTowardCounter: false,
  })
  assert.equal(db.store.get('hosts/h1/media/x').fileName, 'x.jpg')
  assert.equal(counterOf(db), undefined)
})

test('the drift measurement REPORTS an unreconciled counter', async () => {
  // The negative control: a helper that reports `reconciled: true` no matter
  // what is the guard that cannot fail.
  const db = fakeFirestore()
  await putMediaDocument({
    firestore: db,
    scopeRef: hostRef(db),
    mediaId: 'a',
    data: { sizeBytes: 100 },
    countTowardCounter: false,
  })
  const drift = await measureMediaCounterDrift(hostRef(db))
  assert.equal(drift.reconciled, false)
  assert.equal(drift.countDrift, -1)
  assert.equal(drift.bytesDrift, -100)
})

test('an org scope is the same code path', async () => {
  const db = fakeFirestore()
  const orgRef = db.collection('orgs').doc('o1')
  await putMediaDocument({
    firestore: db,
    scopeRef: orgRef,
    mediaId: 'scope-media-logo',
    data: { fileName: 'logo.png', sizeBytes: 1024 },
  })
  assert.deepEqual(counterOf(db, 'orgs/o1'), { count: 1, bytes: 1024 })
})

test('a media document written without the helper is what drift MEASURES', async () => {
  // The regression this whole issue is about, reproduced: the document lands,
  // the counter does not move, and the host is under-reported for good.
  const db = fakeFirestore()
  await db
    .collection('hosts')
    .doc('h1')
    .collection('media')
    .doc('rogue')
    .set({ fileName: 'rogue.jpg', sizeBytes: 561000 }, { merge: true })
  const drift = await measureMediaCounterDrift(hostRef(db))
  assert.equal(drift.reconciled, false)
  assert.equal(drift.bytesDrift, -561000)
})
