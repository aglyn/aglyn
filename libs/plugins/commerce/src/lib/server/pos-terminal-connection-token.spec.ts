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
 * The native Aglyn POS app's Terminal door (AGL-3618): the same gate as a
 * sale, a token only ever scoped to THIS site's Location, a Location registered once
 * however often it is asked for, and nothing minted while the store cannot
 * take cards.
 */

import type { PluginApiRequest, PluginApiResponse } from '@aglyn/aglyn/server'
import { fakeDocs, resetFakeFirestore } from '../testing/fake-firestore'

let mockMerchantReady = true
let mockManagePos = true
let mockPlan = 'business'

jest.mock('@aglyn/tenant-runtime/org-permissions', () => ({
  resolveOrgPermissions: async () => ({ permissions: { managePos: mockManagePos } }),
}))
jest.mock('@aglyn/tenant-data-admin/server/payment-provider', () => ({
  merchantAccountIsReady: () => mockMerchantReady,
}))
jest.mock('@aglyn/tenant-data-admin', () => {
  const fake = jest.requireActual('../testing/fake-firestore')
  return {
    firebaseAdmin: {
      app: () => ({
        auth: () => ({
          verifyIdToken: async (token: string) => {
            if (token === 'bad') throw Object.assign(new Error('Firebase ID token has expired.'), { code: 'auth/id-token-expired' })
            return { uid: token === 'other' ? 'stranger' : 'cashier-1' }
          },
        }),
        firestore: () => fake.fakeFirestore,
      }),
      firestore: { FieldValue: fake.fakeFieldValue },
    },
    getOrgForHost: async () => ({
      orgId: 'org-1',
      org: { id: 'org-1', plan: mockPlan, subscriptionStatus: 'active', ownerUid: 'owner-1', slug: 'acme' },
    }),
  }
})

import { posTerminalConnectionTokenHandler, readPosTerminalAddress } from './pos-terminal-connection-token'

interface StripeCall {
  method: string
  path: string
  key: string | null
  params: URLSearchParams
}
const stripeCalls: StripeCall[] = []
let locationCounter = 0

const fetchMock = jest.fn(async (url: any, init: any) => {
  const target = new URL(String(url))
  const path = target.pathname.replace(/^\/v1\//, '')
  const method = String(init?.method ?? 'GET')
  const params = new URLSearchParams(String(init?.body ?? ''))
  const key = (init?.headers?.['Idempotency-Key'] as string | undefined) ?? null
  stripeCalls.push({ method, path, key, params })
  if (path === 'terminal/connection_tokens') {
    return { ok: true, status: 200, json: async () => ({ secret: `pst_test_${params.get('location')}` }) }
  }
  if (path === 'terminal/locations') {
    return { ok: true, status: 200, json: async () => ({ id: `tml_new${++locationCounter}`, livemode: false }) }
  }
  return { ok: false, status: 404, json: async () => ({ error: { message: 'nope' } }) }
})

function response() {
  const result = { status: 0, body: undefined as any }
  const res = {
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
    setHeader() {},
    redirect() {},
    end() {},
  } as unknown as PluginApiResponse
  return { res, result }
}

async function call(body: Record<string, unknown>, token = 'staff', method = 'POST') {
  const { res, result } = response()
  const req: PluginApiRequest = {
    method,
    query: {},
    body: { hostId: 'host-1', ...body },
    headers: { authorization: `Bearer ${token}` },
    cookies: {},
    socket: {},
  }
  await posTerminalConnectionTokenHandler(req, res)
  return result
}

const ADDRESS = { line1: '1 Main St', city: 'Austin', state: 'TX', postalCode: '78701', country: 'us' }

beforeAll(() => {
  ;(global as any).fetch = fetchMock
})

beforeEach(() => {
  resetFakeFirestore()
  stripeCalls.length = 0
  locationCounter = 0
  mockMerchantReady = true
  mockManagePos = true
  mockPlan = 'business'
  process.env.STRIPE_SECRET_KEY = 'sk_test_fake'
  delete process.env.STRIPE_TERMINAL_LIVE_ENABLED
  fakeDocs.set('hosts/host-1', { name: 'Corner Cafe', memberRoles: { 'cashier-1': 'editor' } })
  fakeDocs.set('hosts/other-host', { name: 'Elsewhere', memberRoles: { stranger: 'admin' } })
  fakeDocs.set('hosts/host-1/terminal/config', { stripeLocationId: 'tml_ours' })
  fakeDocs.set('hosts/other-host/terminal/config', { stripeLocationId: 'tml_theirs' })
  fakeDocs.set('profiles/owner-1', { stripeAccountId: 'acct_merchant', stripeChargesEnabled: true })
})

describe('the gate', () => {
  it('refuses without a token, with a bad token, and with GET', async () => {
    const { res, result } = response()
    await posTerminalConnectionTokenHandler(
      { method: 'POST', query: {}, body: { hostId: 'host-1' }, headers: {}, cookies: {}, socket: {} },
      res,
    )
    expect(result.status).toBe(401)
    expect((await call({}, 'bad')).status).toBe(401)
    expect((await call({}, 'staff', 'GET')).status).toBe(405)
    expect(stripeCalls).toHaveLength(0)
  })

  it('refuses a member of another site, even one that names this site', async () => {
    const result = await call({}, 'other')
    expect(result.status).toBe(403)
    expect(stripeCalls).toHaveLength(0)
  })

  it('refuses without managePos, and without the pos entitlement', async () => {
    mockManagePos = false
    expect((await call({})).status).toBe(403)
    mockManagePos = true
    mockPlan = 'free'
    expect((await call({})).status).toBe(403)
    expect(stripeCalls).toHaveLength(0)
  })

  it('refuses a viewer', async () => {
    fakeDocs.set('hosts/host-1', { memberRoles: { 'cashier-1': 'viewer' } })
    expect((await call({})).status).toBe(403)
  })
})

describe('token', () => {
  it('mints a token scoped to this site’s Location, with the merchant to show', async () => {
    const result = await call({})
    expect(result.status).toBe(200)
    expect(result.body).toEqual({
      secret: 'pst_test_tml_ours',
      locationId: 'tml_ours',
      merchantAccountId: 'acct_merchant',
      merchantDisplayName: 'Corner Cafe',
      testMode: true,
    })
    expect(stripeCalls).toEqual([
      expect.objectContaining({ method: 'POST', path: 'terminal/connection_tokens' }),
    ])
    expect(stripeCalls[0].params.get('location')).toBe('tml_ours')
  })

  it('never mints an unscoped token: no Location is a 409 the app can act on', async () => {
    fakeDocs.delete('hosts/host-1/terminal/config')
    const result = await call({ action: 'token' })
    expect(result.status).toBe(409)
    expect(result.body.code).toBe('location-required')
    expect(stripeCalls).toHaveLength(0)
  })

  it('mints nothing while the store cannot take card payments', async () => {
    mockMerchantReady = false
    const result = await call({})
    expect(result.status).toBe(409)
    expect(result.body.code).toBe('merchant-not-ready')
    expect(stripeCalls).toHaveLength(0)
  })

  it('mints nothing in live mode until Terminal live mode is switched on', async () => {
    process.env.STRIPE_SECRET_KEY = 'sk_live_fake'
    const off = await call({})
    expect(off.status).toBe(409)
    expect(off.body.code).toBe('terminal-unavailable')
    process.env.STRIPE_TERMINAL_LIVE_ENABLED = 'true'
    const on = await call({})
    expect(on.status).toBe(200)
    expect(on.body.testMode).toBe(false)
  })
})

describe('status', () => {
  it('reports readiness without minting', async () => {
    fakeDocs.delete('hosts/host-1/terminal/config')
    const result = await call({ action: 'status' })
    expect(result.body).toEqual({ available: true, testMode: true, merchantReady: true, locationReady: false })
    expect(stripeCalls).toHaveLength(0)
  })
})

describe('location', () => {
  it('registers the Location once, from the store address, on the platform', async () => {
    fakeDocs.delete('hosts/host-1/terminal/config')
    const first = await call({ action: 'location', address: ADDRESS })
    expect(first).toEqual({ status: 200, body: { locationId: 'tml_new1' } })
    const created = stripeCalls.find((entry) => entry.path === 'terminal/locations')!
    expect(created.key).toBe('pos-location:host-1')
    expect(created.params.get('address[country]')).toBe('US')
    expect(created.params.get('metadata[hostId]')).toBe('host-1')
    expect(created.params.get('display_name')).toBe('Corner Cafe')
    expect(fakeDocs.get('hosts/host-1/terminal/config')?.['stripeLocationId']).toBe('tml_new1')

    // Asked again: the same Location, and Stripe is not asked twice.
    const again = await call({ action: 'location', address: ADDRESS })
    expect(again.body).toEqual({ locationId: 'tml_new1' })
    expect(stripeCalls.filter((entry) => entry.path === 'terminal/locations')).toHaveLength(1)

    // And a token now mints against it.
    expect((await call({})).body.locationId).toBe('tml_new1')
  })

  it('refuses an incomplete address with words to show', async () => {
    fakeDocs.delete('hosts/host-1/terminal/config')
    const result = await call({ action: 'location', address: { line1: '1 Main St' } })
    expect(result.status).toBe(400)
    expect(result.body.error).toMatch(/street, city, postal code and country/)
    expect(stripeCalls).toHaveLength(0)
  })

  it('refuses an unknown action', async () => {
    expect((await call({ action: 'mint-anything' })).status).toBe(400)
  })
})

describe('readPosTerminalAddress', () => {
  it('bounds every field and uppercases the country', () => {
    expect(readPosTerminalAddress({ ...ADDRESS, line1: 'x'.repeat(500), line2: '' })).toEqual({
      line1: 'x'.repeat(200),
      city: 'Austin',
      state: 'TX',
      postalCode: '78701',
      country: 'US',
    })
    expect(readPosTerminalAddress('nope')).toBeUndefined()
  })
})
