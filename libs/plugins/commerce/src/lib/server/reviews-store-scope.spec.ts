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
 * The store-wide reviews read (`GET /api/commerce/reviews?scope=store`), for
 * the storefront home's reviews band: the latest APPROVED reviews across every
 * product, newest first, with the aggregate over all approved ones — behind
 * the same `productReviews` entitlement the submit path checks.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

interface Review {
  id: string
  productId: string
  status: string
  rating: number
  body: string
  authorName: string
  verified?: boolean
  createdAtMs: number
}

const mockReviews: Review[] = []
const mockProducts: Record<string, Record<string, unknown>> = {}
const mockOrg: { org: Record<string, unknown> | null } = { org: null }
interface MockQueryState {
  where: unknown[]
  orderBy?: unknown[]
  limit?: number
  after?: string
}
const mockQueries: MockQueryState[] = []

/** One filter, equality or `in`, as the reads use them. */
const mockMatches = (row: Record<string, unknown>, [field, op, value]: [string, string, unknown]) =>
  op === 'in' ? (value as unknown[]).includes(row[field]) : row[field] === value

/**
 * The reviews collection as an immutable query, as Firestore's is: each call
 * answers a new query, so one base query reused for the list and the
 * aggregates is never changed by either. A list read records its shape.
 */
function reviewsQuery(state: MockQueryState = { where: [] }): any {
  const next = (patch: Partial<MockQueryState>) => reviewsQuery({ ...state, ...patch })
  const matching = () =>
    mockReviews.filter((review) =>
      (state.where as Array<[string, string, unknown]>).every((filter) =>
        mockMatches(review as unknown as Record<string, unknown>, filter),
      ),
    )
  return {
    where: (...args: unknown[]) => next({ where: [...state.where, args] }),
    orderBy: (...args: unknown[]) => next({ orderBy: args }),
    startAfter: (doc: { id: string }) => next({ after: doc.id }),
    limit: (count: number) => next({ limit: count }),
    get: async () => {
      mockQueries.push(state)
      let rows = matching()
      if (state.orderBy) rows = [...rows].sort((a, b) => b.createdAtMs - a.createdAtMs)
      if (state.after) rows = rows.slice(rows.findIndex((row) => row.id === state.after) + 1)
      if (state.limit) rows = rows.slice(0, state.limit)
      return {
        docs: rows.map((review) => ({
          id: review.id,
          get: (field: string) => (review as unknown as Record<string, unknown>)[field],
        })),
      }
    },
    aggregate: () => ({
      get: async () => {
        const rows = matching()
        return {
          data: () => ({
            count: rows.length,
            sum: rows.reduce((sum, row) => sum + row.rating, 0),
          }),
        }
      },
    }),
  }
}

/** The products collection: a document by id, and the equality query for hidden ones. */
function productsCollection() {
  const filters: Array<[string, string, unknown]> = []
  const query = {
    where: (field: string, op: string, value: unknown) => {
      filters.push([field, op, value])
      return query
    },
    limit: () => query,
    get: async () => ({
      docs: Object.entries(mockProducts)
        .filter(([, data]) => filters.every((filter) => mockMatches(data, filter)))
        .map(([id]) => ({ id })),
    }),
    doc: (id: string) => ({
      id,
      path: `products/${id}`,
      get: async () => ({ id, exists: Boolean(mockProducts[id]), data: () => mockProducts[id] }),
    }),
  }
  return query
}

jest.mock('@aglyn/tenant-data-admin', () => ({
  getOrgForHost: async () => ({ org: mockOrg.org }),
  firebaseAdmin: {
    app: () => ({
      firestore: () => ({
        collection: () => ({
          doc: () => ({
            collection: (name: string) => (name === 'reviews' ? reviewsQuery() : productsCollection()),
          }),
        }),
        getAll: async (...refs: Array<{ id: string }>) =>
          refs.map((ref) => ({
            id: ref.id,
            exists: Boolean(mockProducts[ref.id]),
            data: () => mockProducts[ref.id],
          })),
      }),
    }),
  },
}))

import { readStoreReviews, reviewerShortName, reviewsHandler } from './reviews'

const review = (id: string, patch: Partial<Review> = {}): Review => ({
  id,
  productId: 'p1',
  status: 'approved',
  rating: 5,
  body: `Review ${id}`,
  authorName: 'Jane Doe',
  createdAtMs: Number(id.replace(/\D/g, '')) || 1,
  ...patch,
})

async function get(query: Record<string, string>) {
  const result = { status: 0, body: undefined as any, headers: {} as Record<string, unknown> }
  const res: any = {
    status(code: number) {
      result.status = code
      return res
    },
    json(body: unknown) {
      result.body = body
    },
    setHeader(name: string, value: unknown) {
      result.headers[name] = value
    },
  }
  await reviewsHandler({ method: 'GET', query, body: {}, headers: {}, cookies: {}, socket: {} } as never, res)
  return result
}

beforeEach(() => {
  mockReviews.splice(0, mockReviews.length)
  mockQueries.splice(0, mockQueries.length)
  for (const key of Object.keys(mockProducts)) delete mockProducts[key]
  mockOrg.org = { entitlements: { features: { productReviews: true } } }
  mockProducts['p1'] = { name: 'Candle Gift Set', slug: 'candle-gift-set', status: 'active' }
  mockProducts['p2'] = { name: 'Old Candle', slug: 'old-candle', status: 'archived' }
})

describe('the store-wide reviews read', () => {
  it('lists approved reviews only, newest first, with the aggregate over every approved one', async () => {
    mockReviews.push(
      review('r1', { rating: 4 }),
      review('r3', { rating: 5, verified: true }),
      review('r2', { status: 'pending', rating: 1 }),
      review('r4', { rating: 3, productId: 'p2' }),
    )
    const { reviews, aggregate } = await readStoreReviews('host-1', 2)
    expect(reviews.map((entry) => entry.id)).toEqual(['r4', 'r3'])
    expect(aggregate).toEqual({ count: 3, average: 4 })
    // The reviewed product's name only while it is on sale.
    expect(reviews[1]).toMatchObject({ productName: 'Candle Gift Set', productSlug: 'candle-gift-set', verified: true })
    expect(reviews[0]).not.toHaveProperty('productName')
    expect(mockQueries[0]).toMatchObject({
      where: [['status', '==', 'approved']],
      orderBy: ['createdAtMs', 'desc'],
      limit: 2,
    })
  })

  /*
   * A product sold in person only (AGL-4060): its reviews show on the site by
   * default, marked Sold in store and never linked; hidden when the store
   * chooses, from the list and the average alike; online products unchanged.
   */
  it('shows the reviews of a product sold in person only by default, marked Sold in store and unlinked', async () => {
    mockProducts['p3'] = { name: 'Trucker Hat', slug: 'trucker-hat', status: 'active', sellOnline: false }
    mockReviews.push(review('r1', { productId: 'p3', rating: 3 }), review('r2'))
    const { reviews, aggregate } = await readStoreReviews('host-1')
    const inStore = reviews.find((entry) => entry.id === 'r1')
    expect(inStore).toMatchObject({ productName: 'Trucker Hat', soldInStore: true })
    expect(inStore).not.toHaveProperty('productSlug')
    expect(aggregate).toEqual({ count: 2, average: 4 })
    // A product sold online is named and linked as it always was.
    expect(reviews.find((entry) => entry.id === 'r2')).toEqual(
      expect.objectContaining({ productName: 'Candle Gift Set', productSlug: 'candle-gift-set' }),
    )
    expect(reviews.find((entry) => entry.id === 'r2')).not.toHaveProperty('soldInStore')
  })

  it('keeps the reviews of a product the store hides off the list and out of the average', async () => {
    mockProducts['p3'] = { name: 'Trucker Hat', status: 'active', sellOnline: false, inStoreReviews: 'hide' }
    mockReviews.push(
      review('r5', { productId: 'p3', rating: 1 }),
      review('r4', { productId: 'p3', rating: 1 }),
      review('r3', { productId: 'p3', rating: 1 }),
      review('r2', { rating: 5 }),
      review('r1', { rating: 4 }),
    )
    const { reviews, aggregate } = await readStoreReviews('host-1', 2)
    // The band still fills from the reviews it may show, past the hidden ones.
    expect(reviews.map((entry) => entry.id)).toEqual(['r2', 'r1'])
    expect(aggregate).toEqual({ count: 2, average: 4.5 })
  })

  it('answers a hidden product’s own reviews as none, and an online product’s as before', async () => {
    mockProducts['p3'] = { name: 'Trucker Hat', status: 'active', sellOnline: false, inStoreReviews: 'hide' }
    mockReviews.push(review('r1', { productId: 'p3' }))
    const hidden = await get({ hostId: 'host-1', productId: 'p3' })
    expect(hidden.status).toBe(200)
    expect(hidden.body).toEqual({ reviews: [], aggregate: { count: 0, average: 0 } })
  })

  it('ignores the choice on a product sold online', async () => {
    mockProducts['p1'] = { ...mockProducts['p1'], inStoreReviews: 'hide' }
    mockReviews.push(review('r1'))
    const { reviews, aggregate } = await readStoreReviews('host-1')
    expect(reviews[0]).toMatchObject({ productSlug: 'candle-gift-set' })
    expect(aggregate.count).toBe(1)
  })

  it('names a reviewer by first name and last initial, never the full name or email', async () => {
    mockReviews.push(review('r1', { authorName: 'Jane Q Doe' }))
    const { reviews } = await readStoreReviews('host-1')
    expect(reviews[0].authorName).toBe('Jane D.')
    expect(reviews[0]).not.toHaveProperty('authorEmail')
    expect(reviewerShortName('Cher')).toBe('Cher')
    expect(reviewerShortName('  ')).toBe('Anonymous')
  })

  it('caps the list at twelve', async () => {
    await readStoreReviews('host-1', 500)
    expect(mockQueries[0].limit).toBe(12)
  })

  it('answers the route with scope=store and no product', async () => {
    mockReviews.push(review('r1'))
    const result = await get({ hostId: 'host-1', scope: 'store', limit: '6' })
    expect(result.status).toBe(200)
    expect(result.body.reviews).toHaveLength(1)
    expect(result.body.aggregate).toEqual({ count: 1, average: 5 })
  })

  it('answers empty, not an error, where the plan has no reviews', async () => {
    mockOrg.org = null
    mockReviews.push(review('r1'))
    const result = await get({ hostId: 'host-1', scope: 'store' })
    expect(result.status).toBe(200)
    expect(result.body).toEqual({ reviews: [], aggregate: { count: 0, average: 0 } })
  })

  it('still refuses a product read with no product', async () => {
    expect((await get({ hostId: 'host-1' })).status).toBe(400)
  })

  it('is served by a declared composite index (status, createdAtMs desc)', () => {
    const config = JSON.parse(
      readFileSync(join(__dirname, '../../../../../../cloud/firebase-firestore.indexes.json'), 'utf8'),
    ) as { indexes: Array<{ collectionGroup: string; queryScope: string; fields: Array<{ fieldPath: string; order?: string }> }> }
    const shapes = config.indexes
      .filter((index) => index.collectionGroup === 'reviews' && index.queryScope === 'COLLECTION')
      .map((index) => index.fields.map((field) => `${field.fieldPath}:${field.order}`).join(' > '))
    expect(shapes).toContain('status:ASCENDING > createdAtMs:DESCENDING')
  })
})
