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
 * The terms of sale at the booth (AGL-4038, Terms 4.28): accepted on the
 * register tablet or on the customer display before paying, recorded with
 * the version, time, method, register user and device, copied onto the
 * hardware order; and the receipt-and-sign notice when neither was used.
 */
import type { PluginApiRequest, PluginApiResponse } from '@aglyn/aglyn/server'
import { resetFakeFirestore } from '../testing/fake-firestore'

let mockSell = true
const mockAudits: Array<Record<string, any>> = []

jest.mock('@aglyn/tenant-runtime/org-permissions', () => ({
  resolveOrgPermissions: async () => ({ permissions: { managePos: true, posSell: mockSell } }),
}))
jest.mock('@aglyn/tenant-data-admin', () => {
  const fake = jest.requireActual('../testing/fake-firestore')
  return {
    firebaseAdmin: {
      app: () => ({
        auth: () => ({
          verifyIdToken: async (token: string) => {
            if (token !== 'cashier') throw Object.assign(new Error('expired'), { code: 'auth/id-token-expired' })
            return { uid: 'cashier-1', email_verified: true }
          },
        }),
        firestore: () => fake.fakeFirestore,
      }),
      firestore: { FieldValue: fake.fakeFieldValue },
    },
    getOrgForHost: async () => ({
      orgId: 'org-seller',
      org: { id: 'org-seller', plan: 'business', subscriptionStatus: 'active', ownerUid: 'owner' },
    }),
    getPluginConfig: async () => ({}),
    consumeRateLimit: async () => ({ allowed: true }),
  }
})
jest.mock('@aglyn/tenant-data-admin/server/admin-audit-write', () => ({
  addAdminAudit: async (_firestore: unknown, entry: Record<string, any>) => {
    mockAudits.push(entry)
    return { id: 'audit' }
  },
}))
jest.mock('@aglyn/tenant-data-admin/server/admin-audit', () => ({ maskEmailAddress: () => '***' }))

import { fakeDocs } from '../testing/fake-firestore'
import { POS_HARDWARE_ENV, type PosHardwareOrder } from '../model/pos-hardware'
import { POS_HARDWARE_TERMS_VERSION } from '../model/pos-hardware-terms'
import { posHardwareSaleHandler } from './pos-hardware-sale'
import { posDisplayHandler, posDisplayStateId, sha256 } from './pos-display'

const ENV_KEYS = [POS_HARDWARE_ENV.inPersonEnabled, POS_HARDWARE_ENV.sellerHostId, POS_HARDWARE_ENV.sellerOrgId]
const TOKEN = 'd'.repeat(48)
const STATE = `posDisplayStates/${posDisplayStateId('host-seller', 'register-1')}`
const HW_ID = 'hw_aaaaaaaaaaaaaaaaaaaa'

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
    setHeader() {},
  } as unknown as PluginApiResponse
  return { res, result }
}

async function sale(body: Record<string, unknown>) {
  const { res, result } = response()
  await posHardwareSaleHandler(
    {
      method: 'POST',
      query: {},
      body: { hostId: 'host-seller', ...body },
      headers: { authorization: 'Bearer cashier', 'user-agent': 'RegisterTablet/1.0', 'x-forwarded-for': '203.0.113.7' },
      cookies: {},
      socket: {},
    } as unknown as PluginApiRequest,
    res,
  )
  return result
}

async function display(body: Record<string, unknown>, token = TOKEN) {
  const { res, result } = response()
  await posDisplayHandler(
    {
      method: 'POST',
      query: {},
      body,
      headers: { 'x-pos-display-token': token, 'user-agent': 'DisplayTablet/2.0', 'x-forwarded-for': '198.51.100.9' },
      cookies: {},
      socket: {},
    } as unknown as PluginApiRequest,
    res,
  )
  return result
}

const registerOrder = (id: string) => fakeDocs.get(`hosts/host-seller/orders/${id}`) as Record<string, any>

beforeEach(() => {
  resetFakeFirestore()
  mockSell = true
  mockAudits.length = 0
  process.env[POS_HARDWARE_ENV.inPersonEnabled] = 'true'
  process.env[POS_HARDWARE_ENV.sellerHostId] = 'host-seller'
  process.env[POS_HARDWARE_ENV.sellerOrgId] = 'org-seller'
  fakeDocs.set('hosts/host-seller', { name: 'Booth', orgId: 'org-seller' })
  fakeDocs.set('hosts/host-seller/registers/register-1', { name: 'Front' })
  fakeDocs.set(`posDisplayTokens/${sha256(TOKEN)}`, {
    hostId: 'host-seller',
    registerId: 'register-1',
    mode: 'display',
    lastSeenAtMs: Date.now(),
  })
  fakeDocs.set('hosts/host-seller/orders/sale-1', {
    status: 'pending',
    lineItems: [{ productId: 'reader', name: 'Stripe Reader S710', quantity: 1, unitAmountCents: 30_000 }],
    hardwareSalePending: true,
  })
  fakeDocs.set('hosts/host-seller/orders/shirt-1', {
    status: 'pending',
    lineItems: [{ productId: 'shirt', name: 'T-shirt', quantity: 1, unitAmountCents: 2_500 }],
  })
})

afterAll(() => {
  for (const key of ENV_KEYS) delete process.env[key]
})

describe('the terms of sale on the register tablet (AGL-4038)', () => {
  it('shows the version, sections, link and summary', async () => {
    const terms = await sale({ action: 'terms' })
    expect(terms.status).toBe(200)
    expect(terms.body).toMatchObject({ version: POS_HARDWARE_TERMS_VERSION, sections: '4.26–4.32' })
    expect(terms.body.url).toMatch(/\/legal\/terms$/)
    expect(terms.body.summary.length).toBeGreaterThan(3)
  })

  it('records the acceptance with the version, time, register user and device, once', async () => {
    const accepted = await sale({ action: 'accept-terms', registerOrderId: 'sale-1' })
    expect(accepted.status).toBe(200)
    const held = registerOrder('sale-1')['hardwareTermsAcceptance']
    expect(held).toMatchObject({
      version: POS_HARDWARE_TERMS_VERSION,
      sections: '4.26–4.32',
      method: 'tablet',
      atMs: expect.any(Number),
      staffUid: 'cashier-1',
      userAgent: 'RegisterTablet/1.0',
    })
    expect(mockAudits.map((entry) => entry.action)).toEqual(['pos-hardware-terms-accepted'])
    // Accepted again: the first stands.
    await sale({ action: 'accept-terms', registerOrderId: 'sale-1' })
    expect(registerOrder('sale-1')['hardwareTermsAcceptance']).toEqual(held)
    expect((await sale({ action: 'terms-status', registerOrderId: 'sale-1' })).body.acceptance).toMatchObject({ method: 'tablet' })
  })

  it('reaches the hardware order the sale already became, replacing its notice', async () => {
    fakeDocs.set('hosts/host-seller/orders/sale-1', { ...registerOrder('sale-1'), status: 'paid', hardwareOrderId: HW_ID })
    fakeDocs.set(`posHardwareSales/${HW_ID}`, { orgId: 'org-buyer' })
    fakeDocs.set(`orgs/org-buyer/hardwareOrders/${HW_ID}`, {
      orgId: 'org-buyer',
      termsAcceptance: { version: 'v20', sections: '4.26–4.32', method: 'notice', atMs: 1, staffUid: null, ip: null, userAgent: null },
    })
    await sale({ action: 'accept-terms', registerOrderId: 'sale-1' })
    expect((fakeDocs.get(`orgs/org-buyer/hardwareOrders/${HW_ID}`) as PosHardwareOrder).termsAcceptance).toMatchObject({
      method: 'tablet',
      staffUid: 'cashier-1',
    })
  })

  it('is for a sale with a card reader, by someone who may sell at the register', async () => {
    expect((await sale({ action: 'accept-terms', registerOrderId: 'shirt-1' })).status).toBe(404)
    expect((await sale({ action: 'accept-terms', registerOrderId: 'nope' })).status).toBe(404)
    fakeDocs.set('hosts/host-seller/orders/sale-1', { ...registerOrder('sale-1'), status: 'voided' })
    expect((await sale({ action: 'accept-terms', registerOrderId: 'sale-1' })).status).toBe(409)
    mockSell = false
    expect((await sale({ action: 'terms' })).status).toBe(403)
  })
})

describe('the terms of sale on the customer display (AGL-4038)', () => {
  const showing = (order = 'sale-1') =>
    fakeDocs.set(STATE, {
      mode: 'screen',
      screen: { pluginId: 'commerce', path: '/hardware-terms', params: { order } },
      updatedAtMs: Date.now(),
    })

  it('reads and accepts only the sale the register put on this display, naming who put it there', async () => {
    expect((await sale({ action: 'terms-on-display', registerOrderId: 'sale-1' })).status).toBe(200)
    expect((await display({ action: 'hardware-terms', order: 'sale-1' })).status).toBe(409)
    showing()
    const read = await display({ action: 'hardware-terms', order: 'sale-1' })
    expect(read.status).toBe(200)
    expect(read.body).toMatchObject({ sections: '4.26–4.32', items: ['1 × Stripe Reader S710'], acceptance: null })
    // Another sale's id on this display's screen is refused.
    expect((await display({ action: 'hardware-terms', order: 'shirt-1' })).status).toBe(409)
    expect((await display({ action: 'accept-hardware-terms', order: 'sale-1' })).status).toBe(400)
    const accepted = await display({ action: 'accept-hardware-terms', order: 'sale-1', accept: true })
    expect(accepted.status).toBe(200)
    expect(registerOrder('sale-1')['hardwareTermsAcceptance']).toMatchObject({
      method: 'display',
      staffUid: 'cashier-1',
      userAgent: 'DisplayTablet/2.0',
    })
    // The display goes back to the register's own screen.
    expect(fakeDocs.get(STATE)).toMatchObject({ mode: 'idle' })
  })

  it('refuses an unpaired display and a kiosk', async () => {
    showing()
    expect((await display({ action: 'hardware-terms', order: 'sale-1' }, 'x'.repeat(48))).status).toBe(401)
    fakeDocs.set(`posDisplayTokens/${sha256(TOKEN)}`, { hostId: 'host-seller', registerId: 'register-1', mode: 'kiosk', lastSeenAtMs: Date.now() })
    expect((await display({ action: 'accept-hardware-terms', order: 'sale-1', accept: true })).status).toBe(403)
  })
})
