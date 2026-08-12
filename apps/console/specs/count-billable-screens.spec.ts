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

import { countBillableScreens } from '../app/api/hosts/resources/count-billable-screens'

/**
 * Minimal stand-in for the admin SDK's snapshot/ref surface.
 *
 * ONE collection, since AGL-1400: the count reads `screens` and nothing else.
 * A second bucket used to be needed here because the exclusion for a
 * collection's entry template was a JOIN against the `collections` collection —
 * which is the shape that produced four issues, and the reason this fake
 * throws now if anything reaches for another collection.
 */
function hostRef(screens: Array<Record<string, unknown> & { id: string }>) {
  return {
    collection: (name: string) => {
      if (name !== 'screens') {
        throw new Error(`countBillableScreens must read only screens, not ${name}`)
      }
      return {
        select: () => ({
          get: async () => ({
            docs: screens.map((row) => ({
              id: String(row['id'] ?? ''),
              get: (field: string) => row[field],
            })),
          }),
        }),
      }
    },
  }
}

/**
 * The bypass AGL-1383 closed, stated as its invariant.
 *
 * `deletedAt` and `kind: 'email'` are ordinary fields on the screen's own
 * document and the rules let an editor write them. Counting by subtracting on
 * those fields alone meant one `updateDoc` took a page off the plan while the
 * host's routing map still pointed at it and the runtime still served it — the
 * client controlling the PREDICATE, where AGL-1173 and AGL-1360 had already
 * closed the client controlling the NUMBER.
 *
 * So these assert the same sentence from both sides: what the site routes is
 * what the plan pays for, and a document does not get to excuse itself.
 */
describe('a routed screen counts, whatever its document claims (AGL-1383)', () => {
  it('counts a published screen that calls itself an email', async () => {
    const count = await countBillableScreens(
      hostRef([{ id: 'home' }, { id: 'free', kind: 'email' }]),
      { home: '/', free: 'pricing' },
    )
    expect(count).toBe(2)
  })

  it('counts a published screen that calls itself deleted', async () => {
    const count = await countBillableScreens(
      hostRef([{ id: 'home' }, { id: 'free', deletedAt: { seconds: 1 } }]),
      { home: '/', free: 'pricing' },
    )
    expect(count).toBe(2)
  })

  // Both fields at once, which is what a client that reads the source would
  // actually send — neither excuse is checked before the routing map.
  it('counts a published screen claiming both', async () => {
    const count = await countBillableScreens(
      hostRef([{ id: 'free', kind: 'email', deletedAt: { seconds: 1 } }]),
      { free: 'pricing' },
    )
    expect(count).toBe(1)
  })

  // The honest trade this leaves: dropping the routing entry stops the count,
  // and stops the page. Unpublish and delete both do exactly this.
  it('stops counting once the screen leaves the routing map', async () => {
    const count = await countBillableScreens(
      hostRef([{ id: 'home' }, { id: 'gone', deletedAt: { seconds: 1 } }]),
      { home: '/' },
    )
    expect(count).toBe(1)
  })

  // The positive control that matters most: an email document is authored on
  // the Emails page and never published, so it never enters the map and never
  // costs the plan a screen. Breaking this would charge every campaign
  // template against `screensPerHost`.
  it('does not count an email screen that was never published', async () => {
    const count = await countBillableScreens(
      hostRef([
        { id: 'home' },
        { id: 'welcome-email', kind: 'email' },
        { id: 'winback-email', kind: 'email' },
      ]),
      { home: '/' },
    )
    expect(count).toBe(1)
  })

  // And the map is not the whole answer either, which is why this counts by
  // routing FIRST rather than by routing ONLY. An unpublished screen is still
  // a screen the plan sold — counting only routed screens would have handed
  // every free site unlimited drafts, a change to what the product charges for
  // rather than a fix to a bypass.
  it('still counts an unpublished draft', async () => {
    const count = await countBillableScreens(
      hostRef([{ id: 'home' }, { id: 'draft' }]),
      { home: '/' },
    )
    expect(count).toBe(2)
  })

  it('tolerates a host with no routing map at all', async () => {
    // A host created before its first publish has no `screens` field; the
    // count must fall back to the document rather than throw or count zero.
    expect(await countBillableScreens(hostRef([{ id: 'draft' }]))).toBe(1)
    expect(await countBillableScreens(hostRef([{ id: 'draft' }]), null)).toBe(1)
  })
})

describe('countBillableScreens (AGL-1173)', () => {
  it('counts ordinary screens', async () => {
    const count = await countBillableScreens(
      hostRef([{ id: 'a' }, { id: 'b' }, { id: 'c' }]),
      { a: '/', b: 'about', c: 'contact' },
    )
    expect(count).toBe(3)
  })

  // Delete stamps `deletedAt` instead of removing the doc, so counting raw
  // docs meant deleting a screen never freed a slot — a dead end on free.
  it('does not count soft-deleted screens', async () => {
    const count = await countBillableScreens(
      hostRef([{ id: 'a' }, { id: 'b', deletedAt: { seconds: 1 } }]),
    )
    expect(count).toBe(1)
  })

  // Email screens live on the Emails page and were already hidden from the
  // screens list's count; enforcement charged for them anyway.
  it('does not count email screens', async () => {
    const count = await countBillableScreens(
      hostRef([{ id: 'a' }, { id: 'e', kind: 'email' }]),
    )
    expect(count).toBe(1)
  })

  // AGL-1173's charge, unchanged and now stated on the screen itself: one
  // screen serving every entry at no URL of its own is not a page, and adding a
  // blog must not cost two of the free plan's five before the first page.
  it('does not count a collection entry template', async () => {
    const count = await countBillableScreens(
      hostRef([{ id: 'home' }, { id: 'blogEntry', kind: 'template' }]),
    )
    expect(count).toBe(1)
  })
})

/**
 * The exclusion is a property of the SCREEN (AGL-1400).
 *
 * It used to be a join: this function read the `collections` collection and
 * subtracted whatever screen ids the template pointers named. Every issue in
 * that arc was the same sentence — the other side of the join is editable, so
 * "is this screen a page?" had an answer the metered party could rewrite
 * (AGL-1383 froze two fields, AGL-1387 found a third exclusion was reachable,
 * AGL-1390 found the pointer could be toggled in a loop).
 *
 * The tests below are the ones that used to be phrased in pointers. Same
 * product facts, asked of one document.
 */
describe('a template is a template because it says so (AGL-1400)', () => {
  // The one place `kind` outranks the routing map, and the reason it can: an
  // entry template is routed ON PURPOSE (publishing is how the compose pipeline
  // picks it up; AGL-1267 drops it from routing at request time), and no client
  // writes this value — demotion lowers the count, promotion is gated.
  it('does not count a template even while it is routed', async () => {
    const count = await countBillableScreens(
      hostRef([{ id: 'home' }, { id: 'blogEntry', kind: 'template' }]),
      { home: '/', blogEntry: 'blog-entry-template' },
    )
    expect(count).toBe(1)
  })

  // AGL-1387, restated: `/{collectionSlug}` renders a LIST template as an
  // ordinary designed page, so it is never stamped and it counts like any other
  // screen — whether it is published at its collection's root, routed somewhere
  // else entirely (the live shape on aglyn.com), or never published at all.
  it('counts a list template, which is an ordinary page', async () => {
    const rows = [{ id: 'home' }, { id: 'blogList' }]
    expect(
      await countBillableScreens(hostRef(rows), { home: '/', blogList: 'blog' }),
    ).toBe(2)
    expect(
      await countBillableScreens(hostRef(rows), {
        home: '/',
        blogList: 'blog-list-template',
      }),
    ).toBe(2)
    expect(await countBillableScreens(hostRef(rows), { home: '/' })).toBe(2)
  })

  // Two collections can share one entry template, and a collection can point at
  // a screen that no longer exists. Neither is a fact about the count any more:
  // the screen documents are the whole population, so a template is subtracted
  // exactly once and a dangling pointer subtracts nothing.
  it('subtracts one screen per template document, never per pointer', async () => {
    const count = await countBillableScreens(
      hostRef([
        { id: 'home' },
        { id: 'shared', kind: 'template' },
        { id: 'alsoShared', kind: 'template' },
      ]),
    )
    expect(count).toBe(1)
  })

  // A screen the plan sold and nothing serves still counts, whether it is an
  // unpublished draft or a template a collection stopped pointing at. What ends
  // the charge is `kind`, and only the gated promotion brings it back.
  it('leaves an orphaned template excluded until it is promoted', async () => {
    expect(
      await countBillableScreens(
        hostRef([{ id: 'home' }, { id: 'orphan', kind: 'template' }]),
      ),
    ).toBe(1)
    expect(
      await countBillableScreens(
        hostRef([{ id: 'home' }, { id: 'orphan', kind: 'page' }]),
      ),
    ).toBe(2)
  })

  // The positive control that matters most: `/blog` is served this way on
  // every site that has not designed a list screen — the built-in themed list
  // (AGL-551) composes from the collection itself, with no screen document
  // anywhere. Charging for it would bill every blog for a page nobody authored.
  it('costs nothing for a collection with no template screens', async () => {
    const count = await countBillableScreens(hostRef([{ id: 'home' }]), {
      home: '/',
    })
    expect(count).toBe(1)
  })
})
