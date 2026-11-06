/**
 * @jest-environment node
 *
 * Must stay the FIRST block comment in the file — Jest reads the pragma only
 * from the opening docblock.
 *
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

/**
 * A SALE THAT SELLS A PRODUCT OUT REACHES THE CACHED STOREFRONT (AGL-4121).
 *
 * The product page and every grid bake the sold-out verdict into the cached
 * HTML, which is now held for a week. Checkout, the register, returns and
 * cancellations never dropped it, so a sold-out product kept offering itself.
 * They drop it now — on a FLIP only, so an ordinary sale costs nothing — with
 * an outbox entry first so the console's drain retries a refused drop.
 */

const mockDrops: Array<{ hostIds: readonly string[]; reason: string }> = []
let mockDropComplete = true
jest.mock('@aglyn/aglyn/plugin-manager/plugin-site-cache', () => ({
  __esModule: true,
  dropPluginSiteCache: async (request: { hostIds: readonly string[]; reason: string }) => {
    mockDrops.push(request)
    return { dropped: 1, skipped: 0, complete: mockDropComplete }
  },
}))

const mockOutbox = new Map<string, Record<string, unknown>>()
const mockFirestore = {
  collection: (name: string) => ({
    doc: (id: string) => ({
      set: async (data: Record<string, unknown>) => {
        mockOutbox.set(`${name}/${id}`, data)
      },
      delete: async () => {
        mockOutbox.delete(`${name}/${id}`)
      },
    }),
  }),
}
const mockNotifications: unknown[] = []
jest.mock('@aglyn/tenant-data-admin/server/firebase-admin', () => ({
  __esModule: true,
  firebaseAdmin: { app: () => ({ firestore: () => mockFirestore }) },
}))
jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  notifyHostManagers: (...args: unknown[]) => {
    mockNotifications.push(args)
  },
}))
jest.mock('firebase-admin/firestore', () => ({
  FieldValue: { serverTimestamp: () => '__now__' },
}))

import { dropStorefrontPages, soldOutMoved, soldOutSignature } from './sold-out-drop'
import { decrementVariantStock } from './reserve-stock'

const product = (inventory: number | null, extra: Record<string, unknown> = {}) =>
  ({
    variants: [
      { id: 'v1', priceUsd: 10, inventory },
      { id: 'v2', priceUsd: 10, inventory: 5 },
    ],
    ...extra,
  }) as never

beforeEach(() => {
  mockDrops.length = 0
  mockOutbox.clear()
  mockDropComplete = true
  jest.spyOn(console, 'error').mockImplementation(() => undefined)
})

afterEach(() => jest.restoreAllMocks())

describe('what counts as a flip', () => {
  it('a variant reaching zero is one, a unit off a stocked variant is not', () => {
    expect(soldOutMoved(product(1), product(0))).toBe(true)
    expect(soldOutMoved(product(7), product(6))).toBe(false)
  })

  it('coming back in stock is one too', () => {
    expect(soldOutMoved(product(0), product(3))).toBe(true)
  })

  it('a backorder product never shows sold out, so never flips', () => {
    expect(
      soldOutMoved(product(1, { oversellPolicy: 'backorder' }), product(0, { oversellPolicy: 'backorder' })),
    ).toBe(false)
  })

  it('an untracked variant shows nothing to flip', () => {
    expect(soldOutSignature(product(null))).toBe(soldOutSignature(product(null)))
  })
})

describe('the drop', () => {
  it('stages an outbox entry, drops the site, and releases the entry', async () => {
    await dropStorefrontPages({ hostId: 'shop', reason: 'a sale sold out a product' })
    expect(mockDrops).toEqual([{ hostIds: ['shop'], reason: 'a sale sold out a product' }])
    expect(mockOutbox.size).toBe(0)
  })

  it('keeps the entry for the drain when the drop did not certainly land', async () => {
    mockDropComplete = false
    await dropStorefrontPages({ hostId: 'shop', reason: 'a sale sold out a product' })
    expect([...mockOutbox.values()]).toEqual([
      expect.objectContaining({ hostId: 'shop', entireHost: true, paths: ['/'], attempts: 0 }),
    ])
  })
})

describe('decrementVariantStock drops the storefront on a flip only', () => {
  class Store {
    data: Record<string, unknown>
    constructor(inventory: number) {
      this.data = { name: 'Widget', variants: [{ id: 'v1', priceUsd: 10, inventory }] }
    }
    runTransaction = async <T>(fn: (tx: unknown) => Promise<T>) =>
      fn({
        get: async () => ({ exists: true, data: () => JSON.parse(JSON.stringify(this.data)) }),
        set: (ref: { path?: string }, value: Record<string, unknown>) => {
          if (ref.path === 'products') this.data = { ...this.data, ...value }
        },
      })
  }
  const hostRef = {
    collection: (name: string) => ({ doc: () => ({ path: name }) }),
  }

  it('drops when the sale takes the last unit', async () => {
    const store = new Store(1)
    await decrementVariantStock({
      firestore: store,
      hostRef,
      hostId: 'shop',
      productId: 'widget',
      variantId: 'v1',
      quantity: 1,
    })
    expect(mockDrops.map((drop) => drop.hostIds)).toEqual([['shop']])
  })

  it('drops nothing for a sale that leaves stock on the shelf', async () => {
    const store = new Store(5)
    await decrementVariantStock({
      firestore: store,
      hostRef,
      hostId: 'shop',
      productId: 'widget',
      variantId: 'v1',
      quantity: 1,
    })
    expect(mockDrops).toEqual([])
  })
})
