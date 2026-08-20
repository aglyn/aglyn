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
 *
 * @jest-environment node
 */

/**
 * THE PURCHASED BADGE AND THE INSTALL GATE ANSWER THE SAME QUESTION (AGL-2158).
 *
 * THE DEFECT. `hasLivePurchase` — the gate on all eight ways into paid
 * content — treats a purchase carrying `refundedAt` as absent (AGL-1546). The
 * listing page carried its own copy of the question,
 * `some(p => p.listingId === listingId)`, with no refund test at all. So a
 * refunded buyer was shown as an owner: the "Purchased" badge, no buy button,
 * and a 402 from every install route. They could neither install it nor buy
 * it again.
 *
 * WHY THE PREDICATE MOVED rather than being patched in place. Patching the
 * component would have produced a SECOND correct copy, and a second copy is
 * how the first one drifted. `purchase-entitlement.ts` is a server module and
 * a client component cannot import it, so the pure predicate lives in the
 * model — which is context-free by construction and already imported by both
 * sides.
 *
 * The last describe is the wiring guard: a predicate extracted for sharing is
 * only shared while both call sites still call it, and nothing else in a
 * green suite would notice one of them quietly restating it.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import {
  hasLivePurchaseOf,
  isLivePurchase,
  licensedOrgIdsFor,
} from './marketplace'

describe('isLivePurchase (AGL-2158)', () => {
  it('is true for an ordinary purchase', () => {
    expect(isLivePurchase({ listingId: 'listing-1' })).toBe(true)
  })

  it('is FALSE once a refund or a lost dispute stamped it', () => {
    // The one case the two predicates disagreed about.
    expect(isLivePurchase({ listingId: 'listing-1', refundedAt: 'NOW' })).toBe(
      false,
    )
  })

  it('treats every shape `refundedAt` actually takes as refunded', () => {
    // A Firestore Timestamp server-side, a client Timestamp in the browser,
    // an ISO string in an export — all truthy. `!= null` would have been the
    // same here, but a truthiness test is what the server has always used and
    // the two must not differ even in their edge behaviour.
    for (const stamp of [
      { seconds: 1, nanoseconds: 0 },
      new Date(),
      '2026-08-18T00:00:00.000Z',
      1,
    ]) {
      expect(isLivePurchase({ refundedAt: stamp })).toBe(false)
    }
  })

  it('a purchase written before AGL-1546 has no field at all and still entitles', () => {
    expect(isLivePurchase({})).toBe(true)
    expect(isLivePurchase({ refundedAt: undefined })).toBe(true)
    expect(isLivePurchase({ refundedAt: null })).toBe(true)
  })

  it('is false for nothing', () => {
    expect(isLivePurchase(null)).toBe(false)
    expect(isLivePurchase(undefined)).toBe(false)
  })
})

describe('hasLivePurchaseOf (AGL-2158)', () => {
  it('is false when only a refunded purchase of this listing exists', () => {
    expect(
      hasLivePurchaseOf(
        [{ listingId: 'listing-1', refundedAt: 'NOW' }],
        'listing-1',
      ),
    ).toBe(false)
  })

  it('a re-purchase after a refund entitles again, sitting beside the refunded one', () => {
    // Re-buying writes a fresh session-keyed document; the refunded one must
    // not veto it.
    expect(
      hasLivePurchaseOf(
        [
          { listingId: 'listing-1', refundedAt: 'NOW' },
          { listingId: 'listing-1' },
        ],
        'listing-1',
      ),
    ).toBe(true)
  })

  it('never answers for a different listing', () => {
    // The client passes every purchase the buyer has — its query narrows by
    // buyer only — so the listing filter belongs inside the predicate.
    expect(hasLivePurchaseOf([{ listingId: 'listing-2' }], 'listing-1')).toBe(
      false,
    )
  })

  it('is false for an empty or absent list, and for a missing listing id', () => {
    expect(hasLivePurchaseOf([], 'listing-1')).toBe(false)
    expect(hasLivePurchaseOf(null, 'listing-1')).toBe(false)
    expect(hasLivePurchaseOf([{ listingId: 'listing-1' }], '')).toBe(false)
  })
})

describe('licensedOrgIdsFor — WHICH workspace holds it (AGL-2331)', () => {
  // What the console licences panel and the listing page's "you own this in
  // another workspace" notice are built on. The question has no answer at all
  // while entitlement is person-scoped, and it is the question an agency has
  // to answer before deciding whether to buy again.
  const listingId = 'listing-1'

  it('names each licensed org once, in document order', () => {
    expect(
      licensedOrgIdsFor(
        [
          { listingId, buyerOrgId: 'org-b' },
          { listingId, buyerOrgId: 'org-a' },
          { listingId, buyerOrgId: 'org-b' },
        ],
        listingId,
      ),
    ).toEqual(['org-b', 'org-a'])
  })

  it('omits a refunded licence — it is not held any more', () => {
    expect(
      licensedOrgIdsFor(
        [{ listingId, buyerOrgId: 'org-a', refundedAt: 'THEN' }],
        listingId,
      ),
    ).toEqual([])
  })

  it('INVENTS NO ORG for a legacy purchase that names none', () => {
    // The surface has to say "every workspace you belong to" rather than
    // guess a workspace — guessing one is the silent reinterpretation this
    // whole change refuses to make.
    expect(licensedOrgIdsFor([{ listingId, buyerUid: 'buyer-1' }], listingId)).toEqual(
      [],
    )
  })

  it('ignores other listings', () => {
    expect(
      licensedOrgIdsFor([{ listingId: 'other', buyerOrgId: 'org-a' }], listingId),
    ).toEqual([])
  })
})

describe('both sides still CALL the shared predicate (AGL-2158)', () => {
  const read = (relative: string) =>
    readFileSync(join(__dirname, '..', relative), 'utf8')

  it('the install gate delegates to it', () => {
    const source = read('server/purchase-entitlement.ts')
    // `hasOrgLicenceOf` since AGL-2331 — the same shared predicate, now asked
    // about the ORGANIZATION as well as the refund. The guard follows the
    // rename rather than being dropped: what it protects is that the server
    // module calls the model's answer instead of restating one.
    expect(source).toContain('hasOrgLicenceOf(')
    // The restated form this file used to end with.
    expect(source).not.toMatch(/some\(\s*\(purchase\)\s*=>\s*!purchase\.get/)
  })

  it('the listing page delegates to it, and does not restate it', () => {
    const source = read('components/listing-content.component.tsx')
    // Org-scoped since AGL-2331, and the org is what the CTA now turns on:
    // reading the person-scoped answer here would put the page back in the
    // disagreement with the install routes that AGL-2158 closed.
    expect(source).toContain(
      'hasOrgLicenceOf(purchaseDocs ?? [], listingId, { orgId, uid: user?.uid })',
    )
    // The exact predicate that diverged: a listing-id match with no refund
    // test. Pinned as a string because that is what came back.
    expect(source).not.toContain('purchase.listingId === listingId')
  })

  it('every paid-content door hands the gate an ORG (AGL-2331)', () => {
    // The wiring proof, and the reason `buyerOrgId` is a REQUIRED property
    // rather than an optional one: a model change the install path does not
    // read fixes nothing, and the way that happens is one of nine doors
    // quietly omitting the argument. TypeScript already refuses a missing
    // required property; this says the same thing where a reviewer can see
    // the whole set at once, and it fails when door number ten is added
    // without it.
    const doors = [
      'server/install.ts',
      'server/install-plugin.ts',
      'server/install-theme.ts',
      'server/install-template.ts',
      'server/install-layout.ts',
      'server/install-email-template.ts',
      'server/install-dataset-schema.ts',
      'server/update-artifact.ts',
      'server/checkout.ts',
    ]
    for (const door of doors) {
      expect([door, read(door).includes('buyerOrgId')]).toEqual([door, true])
    }
  })
})
