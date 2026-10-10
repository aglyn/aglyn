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
const mockQueries: Array<{ where: unknown[]; orderBy?: unknown[]; limit?: number }> = []

function reviewsQuery() {
  const state: { where: unknown[]; orderBy?: unknown[]; limit?: number } = { where: [] }
  mockQueries.push(state)
  const matching = () =>
    mockReviews.filter((review) =>
      (state.where as Array<[string, string, unknown]>).every(
        ([field, , value]) => (review as unknown as Record<string, unknown>)[field] === value,
      ),
    )
  const query = {
    where: (...args: unknown[]) => {
      state.where.push(args)
      return query
    },
    orderBy: (...args: unknown[]) => {
      state.orderBy = args
      return query
    },
    limit: (count: number) => {
      state.limit = count
      return query
    },
    get: async () => {
      let rows = matching()
      if (state.orderBy) rows = [...rows].sort((a, b) => b.createdAtMs - a.createdAtMs)
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
            average: rows.length ? rows.reduce((sum, row) => sum + row.rating, 0) / rows.length : null,
          }),
        }
      },
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
            collection: (name: string) =>
              name === 'reviews'
                ? reviewsQuery()
                : { doc: (id: string) => ({ id, path: `products/${id}` }) },
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
