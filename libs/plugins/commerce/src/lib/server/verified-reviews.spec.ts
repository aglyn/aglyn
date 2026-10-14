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

import type { PluginApiRequest, PluginApiResponse } from '@aglyn/aglyn/server'

/**
 * Verified-buyer reviews end to end (AGL-3736), against an in-memory
 * Firestore: the review route (who is verified, what is published, what is
 * refused, the rate limit), the single-use review links, and the
 * review-request email's scheduler and hourly sweep.
 *
 * No network: `sendEmail` is a double, and the sweep's every write lands in
 * the map below so the assertions are about the rows a real run leaves.
 */

// ---------------------------------------------------------------------------
// In-memory Firestore
// ---------------------------------------------------------------------------

const mockDocs = new Map<string, Record<string, any>>()
const mockDelete = Symbol('delete')
let mockAutoId = 0

function mockApply(previous: Record<string, any> | undefined, patch: Record<string, any>) {
  const next: Record<string, any> = { ...(previous ?? {}) }
  for (const [key, value] of Object.entries(patch)) {
    if (value === mockDelete) delete next[key]
    else next[key] = value
  }
  return next
}

function mockSnapshot(path: string): any {
  const data = mockDocs.get(path)
  return {
    id: path.split('/').pop(),
    exists: data !== undefined,
    ref: mockDocRef(path),
    data: () => (data ? { ...data } : undefined),
    get: (field: string) => data?.[field],
  }
}

function mockDocRef(path: string): any {
  const parts = path.split('/')
  return {
    id: parts[parts.length - 1],
    path,
    parent: {
      id: parts[parts.length - 2],
      parent: parts.length > 2 ? { id: parts[parts.length - 3] } : null,
    },
    get: async () => mockSnapshot(path),
    set: async (value: Record<string, any>, options?: { merge?: boolean }) => {
      mockDocs.set(path, options?.merge ? mockApply(mockDocs.get(path), value) : { ...value })
    },
    update: async (value: Record<string, any>) => {
      if (!mockDocs.has(path)) throw new Error(`NOT_FOUND ${path}`)
      mockDocs.set(path, mockApply(mockDocs.get(path), value))
    },
    collection: (name: string) => mockQuery({ collection: `${path}/${name}` }),
  }
}

interface MockQueryState {
  collection?: string
  group?: string
  filters?: Array<[string, string, unknown]>
  order?: [string, string]
  max?: number
}

function mockQuery(state: MockQueryState): any {
  const matches = () => {
    let rows = [...mockDocs.keys()]
      .filter((path) => {
        const parts = path.split('/')
        if (state.collection) {
          return path.startsWith(`${state.collection}/`) && parts.length === state.collection.split('/').length + 1
        }
        return parts.length % 2 === 0 && parts[parts.length - 2] === state.group
      })
      .map(mockSnapshot)
      .filter((snapshot) =>
        (state.filters ?? []).every(([field, op, value]) => {
          const actual = snapshot.get(field)
          if (op === '==') return actual === value
          if (op === '<=') return actual !== undefined && actual <= (value as number)
          throw new Error(`op ${op}`)
        }),
      )
    if (state.order) {
      const [field, direction] = state.order
      rows = rows.sort((a, b) => (a.get(field) - b.get(field)) * (direction === 'desc' ? -1 : 1))
    }
    return state.max ? rows.slice(0, state.max) : rows
  }
  return {
    doc: (id?: string) => mockDocRef(`${state.collection}/${id ?? `auto-${++mockAutoId}`}`),
    where: (field: string, op: string, value: unknown) =>
      mockQuery({ ...state, filters: [...(state.filters ?? []), [field, op, value]] }),
    orderBy: (field: string, direction = 'asc') => mockQuery({ ...state, order: [field, direction] }),
    limit: (max: number) => mockQuery({ ...state, max }),
    get: async () => {
      const docs = matches()
      return { docs, size: docs.length, empty: docs.length === 0 }
    },
    add: async (value: Record<string, any>) => {
      const ref = mockDocRef(`${state.collection}/auto-${++mockAutoId}`)
      mockDocs.set(ref.path, { ...value })
      return ref
    },
  }
}

const mockFirestore: any = {
  collection: (name: string) => mockQuery({ collection: name }),
  collectionGroup: (name: string) => mockQuery({ group: name }),
  getAll: async (...refs: any[]) => refs.map((ref) => mockSnapshot(ref.path)),
  batch: () => {
    const writes: Array<() => void> = []
    return {
      set: (ref: any, value: Record<string, any>) => {
        writes.push(() => mockDocs.set(ref.path, { ...value }))
      },
      commit: async () => writes.forEach((write) => write()),
    }
  },
  runTransaction: async (body: (transaction: any) => Promise<any>) => {
    const writes: Array<() => void> = []
    const transaction = {
      get: async (ref: any) => mockSnapshot(ref.path),
      update: (ref: any, value: Record<string, any>) => {
        writes.push(() => mockDocs.set(ref.path, mockApply(mockDocs.get(ref.path), value)))
      },
      set: (ref: any, value: Record<string, any>) => {
        writes.push(() => mockDocs.set(ref.path, { ...value }))
      },
      create: (ref: any, value: Record<string, any>) => {
        writes.push(() => {
          if (mockDocs.has(ref.path)) throw new Error(`ALREADY_EXISTS ${ref.path}`)
          mockDocs.set(ref.path, { ...value })
        })
      },
    }
    const result = await body(transaction)
    writes.forEach((write) => write())
    return result
  },
}

// ---------------------------------------------------------------------------
// Module doubles
// ---------------------------------------------------------------------------

const mockRateLimit = jest.fn(async (_key: string, _options: unknown) => ({
  allowed: true,
  count: 1,
  resetMs: Date.now() + 60_000,
}))
const mockOrg: { org: Record<string, unknown> } = {
  org: { id: 'org-1', plan: 'business', ownerUid: 'owner-1' },
}

jest.mock('@aglyn/tenant-data-admin', () => ({
  consumeRateLimit: (key: string, options: unknown) => mockRateLimit(key, options),
  getOrgForHost: async () => mockOrg,
  hostSendingIdentity: async () => null,
  meterHostEmail: async () => undefined,
  firebaseAdmin: {
    app: () => ({ firestore: () => mockFirestore }),
    firestore: {
      FieldValue: { delete: () => mockDelete },
      Timestamp: { fromMillis: (ms: number) => ({ toMillis: () => ms }) },
    },
  },
}))

jest.mock('@aglyn/tenant-data-admin/server/host-email-tokens', () => ({
  loadHostEmailWithTokens: async () => null,
  renderLoadedHostEmailWithTokens: () => null,
}))

const mockSend = jest.fn(async (_message: any): Promise<any> => ({ sent: true }))
jest.mock('@aglyn/shared-util-email', () => ({
  sendEmail: (message: unknown) => mockSend(message),
  sendFailureReason: (result: any) => (!result || result.sent ? null : (result.reason ?? null)),
  isDeferrableSendResult: (result: any) =>
    Boolean(result && !result.sent && ['rate-limited', 'frequency-capped'].includes(result.reason)),
}))

/** The signed-in site member, when a test signs one in. */
let mockMember: Record<string, unknown> | null = null
jest.mock('./membership', () => ({
  ...jest.requireActual('./membership'),
  readActiveMemberSession: async () =>
    mockMember
      ? {
          status: 'active',
          memberId: 'member-1',
          member: {
            exists: true,
            id: 'member-1',
            get: (field: string) => mockMember?.[field],
            data: () => mockMember,
          },
        }
      : { status: 'anonymous' },
}))

import { reviewsHandler } from './reviews'
import {
  hashReviewToken,
  inspectReviewToken,
  newReviewToken,
  plausibleReviewToken,
  reviewTokenVerdict,
} from './review-tokens'
import {
  composeReviewRequest,
  scanReviewRequests,
  scheduleReviewRequest,
  scheduleReviewRequestFromEvent,
} from './review-requests'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const DAY = 24 * 60 * 60 * 1000
const HOST = 'hosts/host-1'
const ORDER = `${HOST}/orders/order-1`
const unlocked = { isLocked: async () => false }

function seed(
  options: {
    reviews?: Record<string, unknown>
    order?: Record<string, unknown>
  } = {},
) {
  mockDocs.set(HOST, { subdomain: 'shop', businessName: 'Bean Co' })
  mockDocs.set(`${HOST}/settings/store`, {
    pdpScreenId: 'pdp',
    ...(options.reviews ? { reviews: options.reviews } : {}),
  })
  mockDocs.set(`${HOST}/products/mug`, { name: 'Mug', slug: 'mug', status: 'active' })
  mockDocs.set(`${HOST}/products/tee`, { name: 'Tee', slug: 'tee', status: 'active' })
  mockDocs.set(ORDER, {
    number: 1001,
    status: 'paid',
    channel: 'online',
    customerEmail: 'buyer@example.com',
    lineItems: [
      { productId: 'mug', name: 'Mug', productType: 'physical', quantity: 1, unitAmountCents: 1200 },
      { productId: 'tee', name: 'Tee', productType: 'physical', quantity: 1, unitAmountCents: 2000 },
    ],
    ...options.order,
  })
}

function reviews(): Array<Record<string, any>> {
  return [...mockDocs.entries()]
    .filter(([path]) => path.startsWith(`${HOST}/reviews/`))
    .map(([, value]) => value)
}

function tokenRows(): Array<[string, Record<string, any>]> {
  return [...mockDocs.entries()].filter(([path]) => path.startsWith(`${HOST}/reviewTokens/`))
}

/** Mints a link the way the sweep does, and returns the raw token. */
function mintToken(patch: Record<string, unknown> = {}): string {
  const token = newReviewToken()
  mockDocs.set(`${HOST}/reviewTokens/${hashReviewToken(token)}`, {
    orderId: 'order-1',
    productId: 'mug',
    email: 'buyer@example.com',
    createdAtMs: Date.now(),
    expiresAtMs: Date.now() + 60 * DAY,
    usedAtMs: null,
    ...patch,
  })
  return token
}

async function call(method: 'GET' | 'POST', input: Record<string, unknown>) {
  const result = { status: 0, body: undefined as any, headers: {} as Record<string, string> }
  const res: PluginApiResponse = {
    status(code: number) {
      result.status = code
      return res
    },
    json(body: unknown) {
      result.body = body
    },
    send(body: unknown) {
      result.body = body
    },
    setHeader(name: string, value: string) {
      result.headers[name] = value
    },
    redirect() {
      /* unused */
    },
    end() {
      /* unused */
    },
  } as unknown as PluginApiResponse
  await reviewsHandler(
    {
      method,
      query: method === 'GET' ? { hostId: 'host-1', productId: 'mug', ...input } : {},
      body: method === 'POST' ? { hostId: 'host-1', productId: 'mug', rating: 4, body: 'Solid mug.', ...input } : undefined,
      headers: { 'x-forwarded-for': '203.0.113.9' },
      cookies: {},
      socket: { remoteAddress: '203.0.113.9' },
    } as unknown as PluginApiRequest,
    res,
  )
  return result
}

beforeEach(() => {
  mockDocs.clear()
  mockMember = null
  mockRateLimit.mockClear()
  mockSend.mockReset()
  mockSend.mockImplementation(async () => ({ sent: true }))
  jest.spyOn(console, 'info').mockImplementation(() => undefined)
  jest.spyOn(console, 'error').mockImplementation(() => undefined)
})

afterEach(() => {
  jest.restoreAllMocks()
})

// ---------------------------------------------------------------------------
// The review route
// ---------------------------------------------------------------------------

describe('POST commerce/reviews under the default (verified) policy', () => {
  it('refuses a typed email with 403 — the buyer’s own address included', async () => {
    seed()
    const result = await call('POST', { authorName: 'Eve', authorEmail: 'buyer@example.com' })
    expect(result.status).toBe(403)
    expect(result.body.code).toBe('verified_purchase_required')
    expect(reviews()).toEqual([])
  })

  it('publishes a review from a valid link as verified, and spends the link', async () => {
    seed()
    const token = mintToken()
    const first = await call('POST', { reviewToken: token, authorName: 'Bea' })
    expect(first.status).toBe(200)
    expect(first.body).toMatchObject({ verified: true, pending: false })
    const [review] = reviews()
    expect(review).toMatchObject({
      productId: 'mug',
      verified: true,
      verifiedVia: 'token',
      status: 'approved',
      orderId: 'order-1',
      authorEmail: 'buyer@example.com',
    })
    const [[, row]] = tokenRows()
    expect(row.usedAtMs).toEqual(expect.any(Number))

    // Single use: the same link again is refused, and nothing new lands.
    const second = await call('POST', { reviewToken: token, authorName: 'Bea' })
    expect(second.status).toBe(403)
    expect(second.body.code).toBe('review_token_used')
    expect(reviews()).toHaveLength(1)
  })

  it('refuses an expired link, a link for another product, and a made-up one', async () => {
    seed()
    const expired = mintToken({ expiresAtMs: Date.now() - 1 })
    expect((await call('POST', { reviewToken: expired })).body.code).toBe('review_token_expired')
    const forTee = mintToken({ productId: 'tee' })
    expect((await call('POST', { reviewToken: forTee })).body.code).toBe('review_token_invalid')
    expect((await call('POST', { reviewToken: newReviewToken() })).body.code).toBe('review_token_invalid')
    expect((await call('POST', { reviewToken: 'short' })).body.code).toBe('review_token_invalid')
    expect(reviews()).toEqual([])
  })

  it('verifies a signed-in member whose PROVEN email bought it, once per product', async () => {
    seed()
    mockMember = { email: 'buyer@example.com', displayName: 'Bea B', emailVerifiedAtMs: 1 }
    const first = await call('POST', {})
    expect(first.status).toBe(200)
    expect(reviews()[0]).toMatchObject({
      verified: true,
      verifiedVia: 'member',
      status: 'approved',
      memberId: 'member-1',
      authorName: 'Bea B',
    })
    const again = await call('POST', {})
    expect(again.status).toBe(409)
    expect(again.body.code).toBe('already_reviewed')
  })

  it('does NOT verify a member who registered with a buyer’s address and never proved it', async () => {
    seed()
    mockMember = { email: 'buyer@example.com', displayName: 'Eve' }
    const result = await call('POST', {})
    expect(result.status).toBe(403)
    expect(result.body.code).toBe('verified_purchase_required')
  })

  it('does not verify a member whose line was refunded', async () => {
    seed({ order: { refundedLineItemIds: [0] } })
    mockMember = { email: 'buyer@example.com', emailVerifiedAtMs: 1 }
    expect((await call('POST', {})).status).toBe(403)
  })

  it('a review link proves a signed-in member’s matching email', async () => {
    seed()
    mockDocs.set(`${HOST}/siteMembers/member-1`, { email: 'buyer@example.com' })
    mockMember = { email: 'buyer@example.com' }
    await call('POST', { reviewToken: mintToken() })
    expect(mockDocs.get(`${HOST}/siteMembers/member-1`)?.['emailVerifiedAtMs']).toEqual(expect.any(Number))
  })
})

describe('POST commerce/reviews under the anyone policy', () => {
  it('holds an unverified review as pending and keeps the email unverified', async () => {
    seed({ reviews: { policy: 'anyone' } })
    const result = await call('POST', { authorName: 'Sam', authorEmail: 'Sam@Example.com' })
    expect(result.status).toBe(200)
    expect(result.body).toMatchObject({ pending: true, verified: false })
    expect(reviews()[0]).toMatchObject({
      verified: false,
      status: 'pending',
      authorEmail: 'sam@example.com',
    })
  })

  it('still publishes a verified buyer at once', async () => {
    seed({ reviews: { policy: 'anyone' } })
    await call('POST', { reviewToken: mintToken() })
    expect(reviews()[0]).toMatchObject({ verified: true, status: 'approved' })
  })

  it('requires a name and a valid email from an anonymous reviewer', async () => {
    seed({ reviews: { policy: 'anyone' } })
    expect((await call('POST', { authorName: 'Sam', authorEmail: 'nope' })).status).toBe(400)
  })
})

describe('the rate limit', () => {
  it('limits per address before reading anything, and answers 429 with Retry-After', async () => {
    seed({ reviews: { policy: 'anyone' } })
    mockRateLimit.mockImplementationOnce(async () => ({
      allowed: false,
      count: 11,
      resetMs: Date.now() + 30_000,
    }))
    const result = await call('POST', { authorName: 'Sam', authorEmail: 'sam@example.com' })
    expect(result.status).toBe(429)
    expect(result.body.code).toBe('review_rate_limited')
    expect(result.headers['Retry-After']).toBeDefined()
    expect(mockRateLimit.mock.calls[0][0]).toBe('commerce-review:ip:host-1:203.0.113.9')
    expect(reviews()).toEqual([])
  })

  it('also limits a signed-in member per day', async () => {
    seed()
    mockMember = { email: 'buyer@example.com', emailVerifiedAtMs: 1 }
    await call('POST', {})
    expect(mockRateLimit.mock.calls.map(([key]) => key)).toContain('commerce-review:member:host-1:member-1')
  })
})

describe('GET commerce/reviews?mode=eligibility', () => {
  it('tells an anonymous visitor on a verified store to sign in', async () => {
    seed()
    const result = await call('GET', { mode: 'eligibility' })
    expect(result.status).toBe(200)
    expect(result.headers['Cache-Control']).toBe('private, no-store')
    expect(result.body).toMatchObject({ enabled: true, policy: 'verified', canReview: false })
  })

  it('opens the form for a valid link without spending it', async () => {
    seed()
    const token = mintToken()
    const result = await call('GET', { mode: 'eligibility', review: token })
    expect(result.body).toMatchObject({ canReview: true, verifiedVia: 'token' })
    expect(tokenRows()[0][1].usedAtMs).toBeNull()
  })

  it('reports why a link does not work', async () => {
    seed()
    const used = mintToken({ usedAtMs: 5 })
    const result = await call('GET', { mode: 'eligibility', review: used })
    expect(result.body).toMatchObject({ canReview: false, tokenProblem: 'review_token_used' })
  })
})

// ---------------------------------------------------------------------------
// The links
// ---------------------------------------------------------------------------

describe('review tokens', () => {
  it('are 32 URL-safe characters, stored only as a hash', () => {
    const token = newReviewToken()
    expect(plausibleReviewToken(token)).toBe(true)
    expect(hashReviewToken(token)).toMatch(/^[0-9a-f]{64}$/)
    expect(hashReviewToken(token)).not.toContain(token)
    expect(plausibleReviewToken('../etc')).toBe(false)
  })

  it('judge product, use and expiry', () => {
    const row = { productId: 'mug', usedAtMs: null, expiresAtMs: 100 }
    expect(reviewTokenVerdict(row, 'mug', 50)).toBeNull()
    expect(reviewTokenVerdict(row, 'tee', 50)).toBe('review_token_invalid')
    expect(reviewTokenVerdict({ ...row, usedAtMs: 1 }, 'mug', 50)).toBe('review_token_used')
    expect(reviewTokenVerdict(row, 'mug', 100)).toBe('review_token_expired')
    expect(reviewTokenVerdict(null, 'mug', 50)).toBe('review_token_invalid')
  })

  it('are looked up by hash, never by the raw token', async () => {
    seed()
    const token = mintToken()
    expect(mockDocs.has(`${HOST}/reviewTokens/${token}`)).toBe(false)
    expect((await inspectReviewToken(mockFirestore, 'host-1', token, 'mug')).ok).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// The review-request email
// ---------------------------------------------------------------------------

describe('scheduling the review request', () => {
  it('stamps a fulfilled order once, at the 3-day minimum', async () => {
    seed()
    expect(await scheduleReviewRequest({ hostId: 'host-1', orderId: 'order-1', fulfilledAtMs: 1_000 }, mockFirestore)).toBe(true)
    expect(mockDocs.get(ORDER)).toMatchObject({
      reviewRequest: { state: 'scheduled', fulfilledAtMs: 1_000 },
      reviewRequestDueAtMs: 1_000 + 3 * DAY,
    })
    // A redelivered event, or the delivery after the shipment, does nothing.
    expect(await scheduleReviewRequest({ hostId: 'host-1', orderId: 'order-1', fulfilledAtMs: 9_000 }, mockFirestore)).toBe(false)
    expect(mockDocs.get(ORDER)?.['reviewRequest'].fulfilledAtMs).toBe(1_000)
  })

  it('schedules order.paid only when nothing on the order ships', async () => {
    seed()
    const paid = { event: 'order.paid', hostId: 'host-1', occurredAtMs: 7, payload: { order: { id: 'order-1' } } }
    await scheduleReviewRequestFromEvent(paid, mockFirestore)
    expect(mockDocs.get(ORDER)?.['reviewRequest']).toBeUndefined()

    seed({
      order: {
        lineItems: [{ productId: 'mug', name: 'E-book', productType: 'digital', quantity: 1, unitAmountCents: 900 }],
      },
    })
    await scheduleReviewRequestFromEvent(paid, mockFirestore)
    expect(mockDocs.get(ORDER)?.['reviewRequest']).toMatchObject({ state: 'scheduled', fulfilledAtMs: 7 })
  })

  it('never schedules a register sale or a refunded order', async () => {
    seed({ order: { channel: 'pos' } })
    expect(await scheduleReviewRequest({ hostId: 'host-1', orderId: 'order-1', fulfilledAtMs: 1 }, mockFirestore)).toBe(false)
    seed({ order: { status: 'refunded' } })
    expect(await scheduleReviewRequest({ hostId: 'host-1', orderId: 'order-1', fulfilledAtMs: 1 }, mockFirestore)).toBe(false)
  })
})

describe('the hourly review-request sweep', () => {
  const fulfilledAtMs = Date.UTC(2026, 9, 1)

  async function scheduleAndSweep(nowMs: number, gate = unlocked) {
    await scheduleReviewRequest({ hostId: 'host-1', orderId: 'order-1', fulfilledAtMs }, mockFirestore)
    return scanReviewRequests(gate, { firestore: mockFirestore, nowMs })
  }

  it('waits for the store’s delay (7 days by default), then sends one email with a link per product', async () => {
    seed()
    // Day 4: the 3-day stamp is due, but the store asks for 7 — pushed out.
    const early = await scheduleAndSweep(fulfilledAtMs + 4 * DAY)
    expect(early.sent).toBe(0)
    expect(mockSend).not.toHaveBeenCalled()
    expect(mockDocs.get(ORDER)?.['reviewRequestDueAtMs']).toBe(fulfilledAtMs + 7 * DAY)

    const due = await scanReviewRequests(unlocked, { firestore: mockFirestore, nowMs: fulfilledAtMs + 7 * DAY })
    expect(due.sent).toBe(1)
    expect(mockSend).toHaveBeenCalledTimes(1)
    const message = mockSend.mock.calls[0][0]
    expect(message.to).toBe('buyer@example.com')
    // Through the marketing seam: suppression and unsubscribe apply.
    expect(message.marketing).toMatchObject({ hostId: 'host-1' })
    // The site's own origin (subdomain `shop`), not a platform URL.
    const siteBase = String(message.marketing.siteBase)
    expect(siteBase).toMatch(/^https:\/\/shop\./)
    expect(message.text).toContain(`${siteBase}/products/mug?review=`)
    expect(message.text).toMatch(/\/products\/mug\?review=[A-Za-z0-9_-]{32}/)
    expect(message.text).toMatch(/\/products\/tee\?review=/)

    // One hashed row per product, bound to the order and the buyer.
    const rows = tokenRows().map(([, row]) => row)
    expect(rows.map((row) => row.productId).sort()).toEqual(['mug', 'tee'])
    for (const row of rows) {
      expect(row).toMatchObject({ orderId: 'order-1', email: 'buyer@example.com', usedAtMs: null })
      expect(row.expiresAtMs - row.createdAtMs).toBe(60 * DAY)
    }
    expect(mockDocs.get(ORDER)).toMatchObject({ reviewRequest: { state: 'sent', productIds: ['mug', 'tee'] } })
    expect(mockDocs.get(ORDER)?.['reviewRequestDueAtMs']).toBeUndefined()

    // Idempotent: another beat sends nothing.
    await scanReviewRequests(unlocked, { firestore: mockFirestore, nowMs: fulfilledAtMs + 8 * DAY })
    expect(mockSend).toHaveBeenCalledTimes(1)
  })

  it('honors a shorter delay', async () => {
    seed({ reviews: { requestDelayDays: 3 } })
    expect((await scheduleAndSweep(fulfilledAtMs + 3 * DAY)).sent).toBe(1)
  })

  it('leaves out a line refunded by name', async () => {
    seed({ order: { refundedLineItemIds: [1] } })
    await scheduleAndSweep(fulfilledAtMs + 7 * DAY)
    const text = mockSend.mock.calls[0][0].text as string
    expect(text).toContain('/products/mug?review=')
    expect(text).not.toContain('/products/tee')
  })

  it('skips an order refunded after it was scheduled, sending nothing', async () => {
    seed()
    await scheduleReviewRequest({ hostId: 'host-1', orderId: 'order-1', fulfilledAtMs }, mockFirestore)
    mockDocs.set(ORDER, { ...mockDocs.get(ORDER), status: 'refunded' })
    const result = await scanReviewRequests(unlocked, { firestore: mockFirestore, nowMs: fulfilledAtMs + 7 * DAY })
    expect(result.skipped).toBe(1)
    expect(mockSend).not.toHaveBeenCalled()
    expect(mockDocs.get(ORDER)?.['reviewRequest']).toMatchObject({ state: 'skipped', reason: 'not_applicable' })
  })

  it('skips when the store turned the email off', async () => {
    seed({ reviews: { requestEmail: false } })
    const result = await scheduleAndSweep(fulfilledAtMs + 7 * DAY)
    expect(result.skipped).toBe(1)
    expect(mockSend).not.toHaveBeenCalled()
    expect(mockDocs.get(ORDER)?.['reviewRequest']).toMatchObject({ state: 'skipped', reason: 'disabled' })
  })

  it('records a suppressed or unsubscribed buyer as skipped, never retried', async () => {
    seed()
    mockSend.mockImplementation(async () => ({ sent: false, reason: 'suppressed' }))
    const result = await scheduleAndSweep(fulfilledAtMs + 7 * DAY)
    expect(result.skipped).toBe(1)
    expect(mockDocs.get(ORDER)?.['reviewRequest']).toMatchObject({ state: 'skipped', reason: 'suppressed' })
    expect(mockDocs.get(ORDER)?.['reviewRequestDueAtMs']).toBeUndefined()
  })

  it('retries a frequency-capped send an hour later', async () => {
    seed()
    const now = fulfilledAtMs + 7 * DAY
    mockSend.mockImplementation(async () => ({ sent: false, reason: 'frequency-capped' }))
    const result = await scheduleAndSweep(now)
    expect(result.deferred).toBe(1)
    expect(mockDocs.get(ORDER)).toMatchObject({
      reviewRequestDueAtMs: now + 60 * 60 * 1000,
      reviewRequest: { state: 'scheduled' },
    })
  })

  it('leaves a locked-down host’s request in place', async () => {
    seed()
    const result = await scheduleAndSweep(fulfilledAtMs + 7 * DAY, { isLocked: async () => true })
    expect(result.skippedLocked).toBe(1)
    expect(mockSend).not.toHaveBeenCalled()
    expect(mockDocs.get(ORDER)?.['reviewRequestDueAtMs']).toBeDefined()
  })

  it('skips a store whose plan has no reviews', async () => {
    seed()
    mockOrg.org = { id: 'org-1', plan: 'free', ownerUid: 'owner-1' }
    try {
      const result = await scheduleAndSweep(fulfilledAtMs + 7 * DAY)
      expect(result.skipped).toBe(1)
      expect(mockSend).not.toHaveBeenCalled()
    } finally {
      mockOrg.org = { id: 'org-1', plan: 'business', ownerUid: 'owner-1' }
    }
  })
})

describe('composeReviewRequest', () => {
  it('names the product when there is one, and the store when there are several', () => {
    const one = composeReviewRequest({
      businessName: 'Bean Co',
      orderNumber: '#1001',
      lines: [{ productId: 'mug', name: 'Mug', url: 'https://x/products/mug?review=t' }],
    })
    expect(one.subject).toBe('How is your Mug?')
    expect(one.tokens['review.url']).toBe('https://x/products/mug?review=t')
    const two = composeReviewRequest({
      businessName: 'Bean Co',
      orderNumber: '#1001',
      lines: [
        { productId: 'mug', name: 'Mug', url: 'a' },
        { productId: 'tee', name: 'Tee', url: 'b' },
      ],
    })
    expect(two.subject).toBe('How was your order from Bean Co?')
    expect(two.text).toContain('works once, for 60 days')
  })
})
