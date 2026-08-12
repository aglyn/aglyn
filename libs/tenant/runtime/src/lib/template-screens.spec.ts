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

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  firebaseAdmin: { app: jest.fn() },
}))

import { firebaseAdmin } from '@aglyn/tenant-data-admin'
import {
  COLLECTION_TEMPLATE_SCREEN_FIELDS,
  collectTemplateScreenIds,
  getTemplateScreenIds,
} from './template-screens'

const snapshotOf = (docs: Array<Record<string, unknown>>) => ({
  docs: docs.map((fields) => ({ get: (field: string) => fields[field] })),
})

const docOf = (fields: Record<string, unknown>) => ({
  get: (field: string) => fields[field],
})

describe('collectTemplateScreenIds (AGL-1267, AGL-1270)', () => {
  it('collects list, entry and legacy template ids', () => {
    const ids = collectTemplateScreenIds({
      collections: snapshotOf([
        { listScreenId: 'list-1', entryScreenId: 'entry-1' },
        // A host predating the AGL-551 list/entry split.
        { templateScreenId: 'legacy-1' },
      ]),
    })

    expect([...ids].sort()).toEqual(['entry-1', 'legacy-1', 'list-1'])
  })

  it('collects the commerce PDP and catalog-collection templates', () => {
    // AGL-1270: these live on settings/store, not on a collection doc, which
    // is the whole reason AGL-1267's subtraction never reached them.
    const ids = collectTemplateScreenIds({
      storeSettings: docOf({
        pdpScreenId: 'pdp-1',
        collectionScreenId: 'plp-1',
        // Neighbouring store settings must not be mistaken for screen ids.
        currency: 'USD',
      }),
    })

    expect([...ids].sort()).toEqual(['pdp-1', 'plp-1'])
  })

  it('unions both sources', () => {
    const ids = collectTemplateScreenIds({
      collections: snapshotOf([{ entryScreenId: 'entry-1' }]),
      storeSettings: docOf({ pdpScreenId: 'pdp-1' }),
    })

    expect([...ids].sort()).toEqual(['entry-1', 'pdp-1'])
  })

  it('ignores unset, blank and non-string fields from either source', () => {
    const ids = collectTemplateScreenIds({
      collections: snapshotOf([
        { listScreenId: '', entryScreenId: null, templateScreenId: undefined },
        { listScreenId: 42 },
        {},
      ]),
      storeSettings: docOf({ pdpScreenId: '', collectionScreenId: null }),
    })

    expect(ids.size).toBe(0)
  })

  it('tolerates either source being absent', () => {
    // A host with commerce disabled has no store settings doc; a host with no
    // collections yields an empty query. Neither is an error.
    expect(collectTemplateScreenIds({}).size).toBe(0)
    expect(
      collectTemplateScreenIds({ collections: null, storeSettings: null }).size,
    ).toBe(0)
  })
})

describe('getTemplateScreenIds (AGL-1267, AGL-1270, AGL-1400)', () => {
  const collectionsQuery = {
    select: jest.fn(() => collectionsQuery),
    limit: jest.fn(() => collectionsQuery),
    get: jest.fn(),
  }
  const screensQuery = {
    where: jest.fn(() => screensQuery),
    select: jest.fn(() => screensQuery),
    limit: jest.fn(() => screensQuery),
    get: jest.fn(),
  }
  const storeDoc = { get: jest.fn() }

  /** `hosts/{id}` with its three sources wired to the mocks above. */
  const wireHost = () => {
    ;(firebaseAdmin.app as jest.Mock).mockReturnValue({
      firestore: () => ({
        collection: () => ({
          doc: () => ({
            collection: (name: string) =>
              name === 'settings'
                ? { doc: () => storeDoc }
                : name === 'screens'
                  ? screensQuery
                  : collectionsQuery,
          }),
        }),
      }),
    })
  }

  beforeEach(() => {
    jest.clearAllMocks()
    collectionsQuery.get.mockResolvedValue(snapshotOf([]))
    screensQuery.get.mockResolvedValue({ docs: [] })
    storeDoc.get.mockResolvedValue(docOf({}))
    wireHost()
  })

  // AGL-1400: the half that reaches a template no pointer names. Clearing a
  // collection's `entryScreenId` leaves the screen a template on purpose, and
  // without this it would be reachable at its own slug again — AGL-1267, back.
  it('unions the screens that say they are templates', async () => {
    screensQuery.get.mockResolvedValue({ docs: [{ id: 'orphan-1' }] })
    collectionsQuery.get.mockResolvedValue(
      snapshotOf([{ entryScreenId: 'entry-1' }]),
    )

    const ids = await getTemplateScreenIds({ hostId: 'host-1' })

    expect([...ids].sort()).toEqual(['entry-1', 'orphan-1'])
    expect(screensQuery.where).toHaveBeenCalledWith('kind', '==', 'template')
    // Ids only: a large site's screen documents must not ride the render path.
    expect(screensQuery.select).toHaveBeenCalledWith()
  })

  it('projects the collections read onto exactly the three template fields', async () => {
    collectionsQuery.get.mockResolvedValue(
      snapshotOf([{ entryScreenId: 'entry-1' }]),
    )

    const ids = await getTemplateScreenIds({ hostId: 'host-1' })

    expect(ids.has('entry-1')).toBe(true)
    expect(collectionsQuery.select).toHaveBeenCalledWith(
      ...COLLECTION_TEMPLATE_SCREEN_FIELDS,
    )
  })

  it('unions the store templates into the same set', async () => {
    collectionsQuery.get.mockResolvedValue(
      snapshotOf([{ entryScreenId: 'entry-1' }]),
    )
    storeDoc.get.mockResolvedValue(
      docOf({ pdpScreenId: 'pdp-1', collectionScreenId: 'plp-1' }),
    )

    const ids = await getTemplateScreenIds({ hostId: 'host-1' })

    expect([...ids].sort()).toEqual(['entry-1', 'pdp-1', 'plp-1'])
  })

  it('issues both reads CONCURRENTLY, not one after the other', async () => {
    // AGL-1152: this is on every render's critical path, so widening it must
    // not buy a second serial round trip. Assert the store read starts before
    // the collections read has resolved.
    const order: string[] = []
    let releaseCollections = () => undefined as void
    screensQuery.get.mockImplementation(async () => {
      order.push('screens:start')
      return { docs: [] }
    })
    collectionsQuery.get.mockImplementation(
      () =>
        new Promise((resolve) => {
          order.push('collections:start')
          releaseCollections = () => resolve(snapshotOf([]))
        }),
    )
    storeDoc.get.mockImplementation(async () => {
      order.push('store:start')
      releaseCollections()
      return docOf({})
    })

    await getTemplateScreenIds({ hostId: 'host-1' })

    expect(order).toEqual(['screens:start', 'collections:start', 'store:start'])
  })

  it('fails OPEN with an empty set when both reads fail', async () => {
    // This read sits on the critical path of every tenant page render. A
    // transient Firestore error must degrade to "the template is briefly
    // reachable again", never to a site-wide 404.
    screensQuery.get.mockRejectedValue(new Error('deadline exceeded'))
    collectionsQuery.get.mockRejectedValue(new Error('deadline exceeded'))
    storeDoc.get.mockRejectedValue(new Error('deadline exceeded'))
    const consoleError = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined)

    await expect(getTemplateScreenIds({ hostId: 'host-1' })).resolves.toEqual(
      new Set(),
    )

    consoleError.mockRestore()
  })

  it('fails open PER SOURCE — one failure keeps the other source', async () => {
    // A store-settings failure has no business re-exposing the blog's entry
    // template, and vice versa.
    const consoleError = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined)

    collectionsQuery.get.mockResolvedValue(
      snapshotOf([{ entryScreenId: 'entry-1' }]),
    )
    screensQuery.get.mockRejectedValue(new Error('unavailable'))
    storeDoc.get.mockRejectedValue(new Error('unavailable'))
    expect([...(await getTemplateScreenIds({ hostId: 'host-1' }))]).toEqual([
      'entry-1',
    ])

    collectionsQuery.get.mockRejectedValue(new Error('unavailable'))
    screensQuery.get.mockResolvedValue({ docs: [{ id: 'orphan-1' }] })
    storeDoc.get.mockResolvedValue(docOf({ pdpScreenId: 'pdp-1' }))
    expect([...(await getTemplateScreenIds({ hostId: 'host-1' }))].sort()).toEqual([
      'orphan-1',
      'pdp-1',
    ])

    consoleError.mockRestore()
  })

  it('fails OPEN when building the refs throws outright', async () => {
    ;(firebaseAdmin.app as jest.Mock).mockImplementation(() => {
      throw new Error('no app')
    })
    const consoleError = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined)

    await expect(getTemplateScreenIds({ hostId: 'host-1' })).resolves.toEqual(
      new Set(),
    )

    consoleError.mockRestore()
  })
})
