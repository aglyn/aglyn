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

/** Minimal stand-in for the admin SDK's snapshot/ref surface. */
function hostRef(
  screens: Array<Record<string, unknown> & { id: string }>,
  collections: Array<Record<string, unknown>> = [],
) {
  const snapshot = (rows: Array<Record<string, unknown>>) => ({
    docs: rows.map((row) => ({
      id: String(row['id'] ?? ''),
      get: (field: string) => row[field],
    })),
  })
  return {
    collection: (name: string) => ({
      select: () => ({
        get: async () =>
          snapshot(name === 'screens' ? screens : collections),
      }),
    }),
  }
}

/**
 * The bypass AGL-1383 closed, stated as its invariant.
 *
 * `deletedAt` and `kind` are ordinary fields on the screen's own document and
 * the rules let an editor write them. Counting by subtracting on those fields
 * alone meant one `updateDoc` took a page off the plan while the host's routing
 * map still pointed at it and the runtime still served it — the client
 * controlling the PREDICATE, where AGL-1173 and AGL-1360 had already closed the
 * client controlling the NUMBER.
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

  // A template's map entry is what makes the compose pipeline pick it up
  // (AGL-1267 drops it from routing at request time), so the reachability test
  // has to keep answering "not a page" for one.
  it('still excludes a collection template screen while it is routed', async () => {
    const count = await countBillableScreens(
      hostRef(
        [{ id: 'home' }, { id: 'blogList' }],
        [{ id: 'blog', listScreenId: 'blogList' }],
      ),
      { home: '/', blogList: 'blog' },
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

  it('does not count a collection list or entry template screen', async () => {
    const count = await countBillableScreens(
      hostRef(
        [{ id: 'home' }, { id: 'blogList' }, { id: 'blogEntry' }],
        [{ id: 'blog', listScreenId: 'blogList', entryScreenId: 'blogEntry' }],
      ),
    )
    expect(count).toBe(1)
  })

  it('honours the legacy templateScreenId field', async () => {
    const count = await countBillableScreens(
      hostRef(
        [{ id: 'home' }, { id: 'legacyTmpl' }],
        [{ id: 'blog', templateScreenId: 'legacyTmpl' }],
      ),
    )
    expect(count).toBe(1)
  })

  // A collection can point at a screen that was since deleted, and two
  // collections can share one template — neither may discount a real screen
  // twice or discount a screen that no longer exists.
  it('ignores dangling and duplicated template references', async () => {
    const count = await countBillableScreens(
      hostRef(
        [{ id: 'home' }, { id: 'shared' }],
        [
          { id: 'blog', listScreenId: 'shared', entryScreenId: 'gone' },
          { id: 'news', listScreenId: 'shared' },
        ],
      ),
    )
    expect(count).toBe(1)
  })

  it('ignores empty and non-string template references', async () => {
    const count = await countBillableScreens(
      hostRef(
        [{ id: 'home' }],
        [{ id: 'blog', listScreenId: '', entryScreenId: 42 }],
      ),
    )
    expect(count).toBe(1)
  })
})
