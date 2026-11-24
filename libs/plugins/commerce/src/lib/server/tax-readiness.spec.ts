/**
 * @jest-environment node
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
 * `GET /api/commerce/tax-readiness` (AGL-4245): whether sales tax lets
 * shoppers check out, for the Taxes and Payments cards.
 *
 * Pinned here: who may read it; that it answers both checkout refusals the
 * way checkout makes them; that Stripe is asked on the store's own account
 * and the answer is reused for a minute; and that reading the store as no
 * longer blocked drops the refusal marker, so the owner's alert clears.
 */

const mockVerifyIdToken = jest.fn()
const docs = new Map<string, Record<string, any>>()
let entitled = true
let sellerAccount: string | null = 'acct_seller'

function snapshot(path: string) {
  const data = docs.get(path)
  return { exists: data !== undefined, data: () => data, get: (field: string) => data?.[field] }
}

function docRef(path: string): any {
  return {
    get: async () => snapshot(path),
    delete: async () => void docs.delete(path),
    collection: (name: string) => ({ doc: (id: string) => docRef(`${path}/${name}/${id}`) }),
  }
}

const fakeFirestore = {
  collection: (name: string) => ({ doc: (id: string) => docRef(`${name}/${id}`) }),
}

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  firebaseAdmin: {
    app: () => ({
      auth: () => ({ verifyIdToken: (...args: unknown[]) => mockVerifyIdToken(...args) }),
      firestore: () => fakeFirestore,
    }),
  },
  isImpersonationSession: () => false,
  emailUnverifiedResponse: () => Response.json({ error: 'Verify your email' }, { status: 403 }),
  getOrgForHost: async () => ({ orgId: 'org-1', org: { ownerUid: 'owner-1', plan: 'pro' } }),
  lockdownRefusal: async () => null,
  hostDisplayName: (_data: unknown, hostId: string) => hostId,
  notifyHostManagers: jest.fn(),
  raiseOperatorAlert: jest.fn(),
}))

jest.mock('@aglyn/tenant-data-admin/server/id-token-refusal', () => ({
  __esModule: true,
  invalidIdTokenResponse: () => null,
}))

jest.mock('@aglyn/aglyn/server', () => ({
  __esModule: true,
  checkEntitlement: () => entitled,
  pluginRequestFromWeb: async (request: Request) => {
    const url = new URL(request.url)
    return {
      method: request.method,
      query: Object.fromEntries(url.searchParams.entries()),
      headers: { authorization: request.headers.get('authorization') ?? undefined },
      body: '',
    }
  },
}))

jest.mock('./seller-stripe-account', () => ({
  __esModule: true,
  directSellerAccountForHost: async () => sellerAccount,
  fetchSellerStripeTaxSettings: (...args: unknown[]) => mockSettings(...args),
  sellerHasActiveTaxRegistration: (...args: unknown[]) => mockRegistration(...args),
}))

const mockSettings = jest.fn()
const mockRegistration = jest.fn()

import {
  cachedSellerStripeTaxStatus,
  resetSellerStripeTaxCacheForTests,
  SELLER_STRIPE_TAX_CACHE_MS,
  taxReadinessHandler,
} from './tax-readiness'

const PENDING = { status: 'pending', head_office: null, defaults: { tax_code: null } }
const ACTIVE = { status: 'active', head_office: { address: { country: 'US' } }, defaults: { tax_code: 'txcd_1' } }
const MARKER = 'hosts/host-1/settings/taxCheckoutRefusal'

function seed(tax: Record<string, unknown> | undefined, roles: Record<string, string> = { 'uid-admin': 'admin' }) {
  docs.set('hosts/host-1', { name: 'Acme', memberRoles: roles })
  if (tax) docs.set('hosts/host-1/settings/store', { tax })
}

async function read(query = '?hostId=host-1', uid = 'uid-admin') {
  mockVerifyIdToken.mockResolvedValue({ uid, email_verified: true })
  const response = await taxReadinessHandler(
    new Request(`https://app.aglyn.com/api/commerce/tax-readiness${query}`, {
      headers: { authorization: 'Bearer token' },
    }),
  )
  return { status: response.status, body: (await response.json()) as Record<string, any> }
}

beforeEach(() => {
  docs.clear()
  entitled = true
  sellerAccount = 'acct_seller'
  mockSettings.mockReset()
  mockRegistration.mockReset()
  mockSettings.mockResolvedValue(PENDING)
  mockRegistration.mockResolvedValue(false)
  resetSellerStripeTaxCacheForTests()
})

describe('taxReadinessHandler (AGL-4245)', () => {
  it('answers 404 to someone who does not work the store, and never asks Stripe', async () => {
    seed({ mode: 'stripe' })
    const { status } = await read('?hostId=host-1', 'uid-stranger')
    expect(status).toBe(404)
    expect(mockSettings).not.toHaveBeenCalled()
  })

  it('refuses without a token, without a site, and for anything but GET', async () => {
    const noToken = await taxReadinessHandler(new Request('https://app.aglyn.com/api/commerce/tax-readiness?hostId=host-1'))
    expect(noToken.status).toBe(401)
    expect((await read('')).status).toBe(400)
    const post = await taxReadinessHandler(
      new Request('https://app.aglyn.com/api/commerce/tax-readiness?hostId=host-1', { method: 'POST' }),
    )
    expect(post.status).toBe(405)
  })

  it('says checkout is blocked when Stripe Tax is chosen and not on, with what is left', async () => {
    seed({ mode: 'stripe' })
    docs.set(MARKER, { reason: 'stripe-tax-not-active', firstAtMs: 10, lastAtMs: 20, count: 2 })
    const { status, body } = await read()
    expect(status).toBe(200)
    expect(body).toEqual({
      mode: 'stripe',
      direct: true,
      stripeTax: {
        readable: true,
        active: false,
        missing: ['head-office', 'tax-code', 'registration'],
        hasRegistration: false,
      },
      blocked: 'stripe-tax-not-active',
      refusedAtMs: 20,
    })
    expect(mockSettings).toHaveBeenCalledWith('acct_seller')
    // Still blocked: the marker stays, so the owner is not told again.
    expect(docs.has(MARKER)).toBe(true)
  })

  it('says a store that never chose is blocked', async () => {
    seed(undefined)
    const { body } = await read()
    expect(body.mode).toBeNull()
    expect(body.blocked).toBe('tax-undecided')
  })

  it('clears the refusal marker once the store reads as no longer blocked', async () => {
    seed({ mode: 'stripe' })
    docs.set(MARKER, { reason: 'stripe-tax-not-active', firstAtMs: 10, lastAtMs: 20, count: 2 })
    mockSettings.mockResolvedValue(ACTIVE)
    mockRegistration.mockResolvedValue(true)
    const { body } = await read()
    expect(body.blocked).toBeNull()
    expect(body.stripeTax.active).toBe(true)
    expect(docs.has(MARKER)).toBe(false)
  })

  it('asks Stripe nothing for a store on the platform account', async () => {
    sellerAccount = null
    seed({ mode: 'stripe' })
    const { body } = await read()
    expect(body).toMatchObject({ direct: false, stripeTax: null, blocked: null })
    expect(mockSettings).not.toHaveBeenCalled()
  })

  it('answers 402 when the plan does not include selling', async () => {
    entitled = false
    seed({ mode: 'stripe' })
    expect((await read()).status).toBe(402)
  })
})

describe('cachedSellerStripeTaxStatus (AGL-4245)', () => {
  const depsAt = (clock: { now: number }) => ({
    settings: mockSettings,
    registration: mockRegistration,
    now: () => clock.now,
  })

  it('reuses one answer for a minute, and asks again after it', async () => {
    const clock = { now: 1_000 }
    await cachedSellerStripeTaxStatus('acct_1', {}, depsAt(clock))
    clock.now += SELLER_STRIPE_TAX_CACHE_MS - 1
    await cachedSellerStripeTaxStatus('acct_1', {}, depsAt(clock))
    expect(mockSettings).toHaveBeenCalledTimes(1)
    clock.now += 1
    await cachedSellerStripeTaxStatus('acct_1', {}, depsAt(clock))
    expect(mockSettings).toHaveBeenCalledTimes(2)
  })

  it('lets "Check again" past the cache, but not twice in a few seconds', async () => {
    const clock = { now: 1_000 }
    await cachedSellerStripeTaxStatus('acct_1', {}, depsAt(clock))
    clock.now += 1_000
    await cachedSellerStripeTaxStatus('acct_1', { fresh: true }, depsAt(clock))
    expect(mockSettings).toHaveBeenCalledTimes(1)
    clock.now += 5_000
    mockSettings.mockResolvedValue(ACTIVE)
    const status = await cachedSellerStripeTaxStatus('acct_1', { fresh: true }, depsAt(clock))
    expect(mockSettings).toHaveBeenCalledTimes(2)
    expect(status.active).toBe(true)
  })

  it('never keeps an unreadable answer', async () => {
    const clock = { now: 1_000 }
    mockSettings.mockResolvedValue(null)
    const status = await cachedSellerStripeTaxStatus('acct_1', {}, depsAt(clock))
    expect(status.readable).toBe(false)
    await cachedSellerStripeTaxStatus('acct_1', {}, depsAt(clock))
    expect(mockSettings).toHaveBeenCalledTimes(2)
  })
})
