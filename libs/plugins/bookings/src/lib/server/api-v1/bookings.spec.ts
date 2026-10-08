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
 * `/v1/sites/{siteId}/bookings` (AGL-3643): the scope before the plan, the
 * plan before the read, the published shape, and the filters a list takes.
 */

const pages: Array<{ filters: Array<[string, unknown]>; url: string }> = []

jest.mock('@aglyn/tenant-data-admin/server/api-v1-kit', () => {
  const actual = jest.requireActual('@aglyn/tenant-data-admin/server/api-v1-kit')
  return {
    ...actual,
    paginate: async (query: { filters: Array<[string, unknown]>; docs: unknown[] }, url: URL) => {
      pages.push({ filters: query.filters, url: url.toString() })
      return { docs: query.docs, nextCursor: null }
    },
  }
})

import type { ApiV1Context } from '@aglyn/tenant-data-admin/server/api-v1-kit'
import { handleBookings } from './bookings'

type Doc = Record<string, unknown>

const HOUR = 3_600_000
const START = Date.UTC(2026, 9, 14, 15)

const STORED: Record<string, Doc> = {
  b1: {
    serviceId: 'svc1',
    serviceName: 'Consultation',
    name: 'Avery Chen',
    email: 'avery@example.com',
    status: 'confirmed',
    startsAtMs: START,
    endsAtMs: START + HOUR / 2,
    timezone: 'America/Chicago',
    paidAmountCents: 5413,
    taxCents: 413,
    paymentIntentId: 'pi_secret',
    crmRef: 'contact:abc',
  },
  b2: { serviceId: 'svc2', status: 'canceled', startsAtMs: START, endsAtMs: START + HOUR },
}

function firestoreDouble(stored: Record<string, Doc>) {
  const query = (filters: Array<[string, unknown]>) => ({
    filters,
    docs: Object.entries(stored)
      .filter(([, data]) => filters.every(([field, value]) => data[field] === value))
      .map(([id, data]) => ({ id, data: () => data })),
    where(field: string, _op: string, value: unknown) {
      return query([...filters, [field, value]])
    },
  })
  const bookings = {
    ...query([]),
    doc: (id: string) => ({
      get: async () => ({ id, exists: id in stored, data: () => stored[id] }),
    }),
  }
  return {
    collection: (name: string) => {
      expect(name).toBe('hosts')
      return {
        doc: (hostId: string) => {
          expect(hostId).toBe('h1')
          return { collection: (sub: string) => (expect(sub).toBe('bookings'), bookings) }
        },
      }
    },
  }
}

const ctx = (overrides: Partial<ApiV1Context> = {}): ApiV1Context =>
  ({
    orgId: 'org1',
    keyId: 'key_1',
    keyName: 'Zapier',
    scopes: ['bookings:read'],
    org: { plan: 'business', features: { bookings: true } },
    firestore: firestoreDouble(STORED),
    headers: { 'X-RateLimit-Limit': '120' },
    ...overrides,
  }) as unknown as ApiV1Context

const get = (path: string) => new Request(`https://app.aglyn.com/api${path}`)
const call = (path: string, context = ctx(), method = 'GET') => {
  const request = method === 'GET' ? get(path) : new Request(`https://app.aglyn.com/api${path}`, { method })
  const url = new URL(request.url)
  const segments = url.pathname.replace('/api/v1/', '').split('/').filter(Boolean)
  return handleBookings(request, context, segments, url)
}

beforeEach(() => {
  pages.length = 0
})

describe('GET /v1/sites/{siteId}/bookings (AGL-3643)', () => {
  it('reads one booking in the published shape, with none of Stripe’s handles or the CRM reference', async () => {
    const response = await call('/v1/sites/h1/bookings/b1')
    expect(response.status).toBe(200)
    expect(response.headers.get('X-RateLimit-Limit')).toBe('120')
    const body = await response.json()
    expect(body).toMatchObject({
      id: 'b1',
      object: 'booking',
      serviceId: 'svc1',
      status: 'confirmed',
      email: 'avery@example.com',
      startsAt: '2026-10-14T15:00:00.000Z',
      endsAt: '2026-10-14T15:30:00.000Z',
      timeZone: 'America/Chicago',
      currency: 'usd',
      paidCents: 5413,
      taxCents: 413,
      refundedCents: 0,
      checkedIn: false,
    })
    expect(JSON.stringify(body)).not.toMatch(/pi_secret|contact:abc/)
  })

  it('answers 404 for a booking that does not exist', async () => {
    const response = await call('/v1/sites/h1/bookings/nope')
    expect(response.status).toBe(404)
    expect((await response.json()).error.message).toBe('No such booking')
  })

  it('lists, filtered by status and service', async () => {
    const response = await call('/v1/sites/h1/bookings?status=canceled&serviceId=svc2')
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.data.map((one: { id: string }) => one.id)).toEqual(['b2'])
    expect(pages[0].filters).toEqual([
      ['status', 'canceled'],
      ['serviceId', 'svc2'],
    ])
  })

  it('refuses a status no booking is stored with', async () => {
    const response = await call('/v1/sites/h1/bookings?status=expired')
    expect(response.status).toBe(400)
    expect((await response.json()).error.code).toBe('validation_failed')
    expect(pages).toEqual([])
  })

  it('asks the scope before the plan, and the plan before reading', async () => {
    const noScope = await call('/v1/sites/h1/bookings', ctx({ scopes: ['orders:read'], org: {} }))
    expect(noScope.status).toBe(403)
    expect((await noScope.json()).error).toMatchObject({ type: 'insufficient_scope', code: 'bookings:read' })

    const noPlan = await call('/v1/sites/h1/bookings', ctx({ org: { plan: 'free' } as never }))
    expect(noPlan.status).toBe(403)
    expect((await noPlan.json()).error).toMatchObject({ type: 'plan_required', code: 'bookings' })
    expect(pages).toEqual([])
  })

  it('is read-only, and knows no deeper path', async () => {
    const post = await call('/v1/sites/h1/bookings', ctx(), 'POST')
    expect(post.status).toBe(405)
    expect(post.headers.get('Allow')).toBe('GET')
    const deeper = await call('/v1/sites/h1/bookings/b1/notes')
    expect(deeper.status).toBe(404)
  })
})
