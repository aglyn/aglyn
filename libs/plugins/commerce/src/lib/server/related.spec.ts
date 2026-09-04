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

/**
 * Related products must read a STABLE sample.
 *
 * Both fallback branches page a collection that can be larger than the bound:
 * 100 orders for co-purchase pairs, 300 products for tag/category neighbours.
 * A bare `limit()` leaves the backend free to pick which documents come back,
 * so the same product answered one request from one slice and the next from
 * another — a "bought together" row that reshuffled with nothing behind it.
 *
 * The fix is an explicit order, and document id is the only field that can
 * carry it: orders store their timestamp as `createdAtMs` on some documents
 * and `createdAt: {seconds}` on others (which is why `orderCreatedAtMs`
 * exists), and an `orderBy` on either shape drops every order written in the
 * other. So this asserts the ORDERING, not a particular set of ids — the set
 * is exactly what was unstable.
 */

const HOST_ID = 'host_shop'
const PRODUCT_ID = 'p_anchor'

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  firebaseAdmin: {
    app: jest.fn(),
    firestore: { FieldPath: { documentId: () => '__name__' } },
  },
}))

import { firebaseAdmin } from '@aglyn/tenant-data-admin'
import { relatedHandler } from './related'

/** Every `orderBy` field the handler asked for, in call order. */
let orderedBy: string[] = []
/** Collections the handler paged, so an unordered read is attributable. */
let pagedCollections: string[] = []

const seed = (options: {
  product: Record<string, unknown>
  orders?: Record<string, unknown>[]
  products?: { id: string; data: Record<string, unknown> }[]
}) => {
  orderedBy = []
  pagedCollections = []
  const page = (name: string, docs: any[]) => {
    const query: any = {
      orderBy: (field: string) => {
        orderedBy.push(`${name}:${String(field)}`)
        return query
      },
      limit: () => query,
      get: async () => {
        pagedCollections.push(name)
        return { docs }
      },
    }
    return query
  }
  const hostRef = {
    collection: (name: string) => {
      if (name === 'orders') {
        return page(
          'orders',
          (options.orders ?? []).map((data) => ({ data: () => data })),
        )
      }
      const productsQuery = page(
        'products',
        (options.products ?? []).map((entry) => ({
          id: entry.id,
          data: () => entry.data,
        })),
      )
      // `products` is reached BOTH as a paged query and as a single doc.
      productsQuery.doc = () => ({
        get: async () => ({ data: () => options.product }),
      })
      return productsQuery
    },
  }
  ;(firebaseAdmin.app as jest.Mock).mockReturnValue({
    firestore: () => ({ collection: () => ({ doc: () => hostRef }) }),
  })
}

const run = async () => {
  const res: any = {
    statusCode: 0,
    body: undefined,
    setHeader: () => undefined,
    status(code: number) {
      this.statusCode = code
      return this
    },
    json(payload: unknown) {
      this.body = payload
      return this
    },
  }
  await relatedHandler(
    { query: { hostId: HOST_ID, productId: PRODUCT_ID } } as any,
    res,
  )
  return res
}

describe('relatedHandler sampling', () => {
  afterEach(() => jest.clearAllMocks())

  it('orders the co-purchase order scan by document id', async () => {
    seed({
      // No curated list, so the handler falls through to orders.
      product: { tags: [], categoryIds: [] },
      orders: [
        { lineItems: [{ productId: PRODUCT_ID }, { productId: 'p_mug' }] },
      ],
    })

    const res = await run()

    expect(pagedCollections).toContain('orders')
    expect(orderedBy).toContain('orders:__name__')
    expect(res.body).toEqual({ productIds: ['p_mug'] })
  })

  it('orders the tag/category neighbour scan by document id', async () => {
    seed({
      product: { tags: ['ceramic'], categoryIds: [] },
      // No order yields a pair, so the third branch runs.
      orders: [],
      products: [
        { id: 'p_bowl', data: { status: 'active', tags: ['ceramic'] } },
      ],
    })

    const res = await run()

    expect(orderedBy).toContain('products:__name__')
    expect(res.body).toEqual({ productIds: ['p_bowl'] })
  })

  it('reads neither collection when the product curates its own list', async () => {
    // The cheap path stays cheap: a curated list must not pay for either scan.
    seed({ product: { relatedProductIds: ['p_one', 'p_two'] } })

    const res = await run()

    expect(pagedCollections).toEqual([])
    expect(res.body).toEqual({ productIds: ['p_one', 'p_two'] })
  })
})
