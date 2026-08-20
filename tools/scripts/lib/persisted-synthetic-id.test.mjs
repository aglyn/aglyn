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

// AGL-1889 — the finder that decides whether a persisted synthetic `$id` is
// still in production, and the gate that stops a clean answer from being
// vacuous.
//
//   node --test tools/scripts/lib/persisted-synthetic-id.test.mjs
//   npm run test:synthetic-id

import assert from 'node:assert/strict'
import test from 'node:test'

import {
  PositiveControlError,
  assertPositiveControl,
  countNestedSyntheticIds,
  hasPersistedSyntheticId,
  scrubPlan,
} from './persisted-synthetic-id.mjs'

/**
 * A besigner screen: `nodes` is a map of canvas nodes, and every node
 * legitimately stores its own `$id`. This is the shape that made the original
 * finder's positive control worth keeping — it is the reason a finder that
 * matches nothing at the top level is not automatically a broken finder.
 */
const BESIGNER_SCREEN = {
  slug: 'home',
  nodes: {
    root: { $id: 'root', type: 'Box', nodes: ['a', 'b'] },
    a: { $id: 'a', type: 'Text', props: { text: 'hi' } },
    b: { $id: 'b', type: 'Box', nodes: [{ $id: 'b1', type: 'Text' }] },
  },
}

/** The real defect: `$id` stored as a TOP-LEVEL field of the document. */
const CORRUPT_PRODUCT = {
  $id: '3kSqI_EGFP',
  name: 'Cake',
  priceUsd: 12,
}

test('a top-level `$id` is the defect and is reported', () => {
  assert.equal(hasPersistedSyntheticId(CORRUPT_PRODUCT), true)
})

test('a nested `$id` is NOT the defect — besigner nodes store their own', () => {
  assert.equal(hasPersistedSyntheticId(BESIGNER_SCREEN), false)
})

test('an absent `$id` is not the defect', () => {
  assert.equal(hasPersistedSyntheticId({ name: 'Cake' }), false)
})

test('a top-level `$id` holding `undefined` is still a persisted key', () => {
  // Firestore cannot store `undefined`, but a fake or an export round trip
  // can produce it. Keying off the VALUE rather than the key is how a finder
  // reports zero on a document that carries the artifact.
  assert.equal(hasPersistedSyntheticId({ $id: undefined }), true)
})

test('the positive control counts nested `$id` keys', () => {
  // root, a, b, b1 — four nodes, four keys.
  assert.equal(countNestedSyntheticIds(BESIGNER_SCREEN), 4)
})

test('the positive control ignores the top-level key it is controlling for', () => {
  // Otherwise a corrupt document would supply its own control and a sweep
  // that found nothing else would still look "proven".
  assert.equal(countNestedSyntheticIds(CORRUPT_PRODUCT), 0)
})

test('the positive control does not descend into non-plain Firestore values', () => {
  // Timestamp/GeoPoint/DocumentReference/Buffer carry class instances whose
  // internals are not document data. Walking them is how a finder invents
  // matches, or crashes on a circular reference.
  class Timestamp {
    constructor(seconds) {
      this.seconds = seconds
      this.$id = 'not-document-data'
    }
  }
  assert.equal(countNestedSyntheticIds({ createdAt: new Timestamp(1) }), 0)
})

test('a clean sweep with a DEAD control throws rather than reporting zero', () => {
  // The whole point. "No hits" from a finder that cannot see the key is the
  // reassuring verdict for every possible tree, and the original pass kept a
  // control precisely so a re-run could not produce one.
  assert.throws(
    () => assertPositiveControl({ nestedKeys: 0, documentsScanned: 1830 }),
    PositiveControlError,
  )
})

test('a live control passes the gate', () => {
  assert.doesNotThrow(() =>
    assertPositiveControl({ nestedKeys: 418, documentsScanned: 1830 }),
  )
})

test('a control that saw no documents at all throws', () => {
  // Credentials pointed at an empty project reports zero hits too.
  assert.throws(
    () => assertPositiveControl({ nestedKeys: 0, documentsScanned: 0 }),
    PositiveControlError,
  )
})

test('a scrub is planned only for EXPLICITLY named documents', () => {
  const plan = scrubPlan(['hosts/4uYCmrbU5t/products/3kSqI_EGFP'])
  assert.deepEqual(plan, [
    { path: 'hosts/4uYCmrbU5t/products/3kSqI_EGFP', field: '$id' },
  ])
})

test('a scrub refuses an empty target list', () => {
  // A scrub with no named paths must not degrade into "everything found",
  // which is how a repair becomes a broad script over a collection.
  assert.throws(() => scrubPlan([]), /explicit/i)
})

test('a scrub refuses a collection path', () => {
  // `hosts/x/products` is a COLLECTION — an odd number of segments. Handing
  // one to a scrub is the sweep this must never become.
  assert.throws(() => scrubPlan(['hosts/4uYCmrbU5t/products']), /document/i)
})
