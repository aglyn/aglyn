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

import type { PluginContactCaptureRequest } from '@aglyn/aglyn/plugin-manager/plugin-contact-capture'
import type { PluginPersonSearchRequest } from '@aglyn/aglyn/plugin-manager/plugin-person-records'
import { posOpsHarness, type PosOpsHarness } from '../testing/pos-ops-harness'
import { handlePosCustomer, POS_CUSTOMER_PAID_STATUSES, type PosCustomerDeps } from './pos-customer'

jest.mock('@aglyn/tenant-data-admin', () => ({ firebaseAdmin: {} }))
jest.mock('@aglyn/tenant-runtime/org-permissions', () => ({ resolveOrgPermissions: jest.fn() }))

/**
 * The customer at the register (AGL-3609): searched through the person
 * records seam — never the CRM's collections — added through the capture
 * door, and their history read from commerce's own orders.
 */

let h: PosOpsHarness
let deps: PosCustomerDeps
let searches: PluginPersonSearchRequest[]
let captures: PluginContactCaptureRequest[]
let keepsPeople: boolean

const customer = (body: Record<string, unknown>, uid = 'cashier') =>
  handlePosCustomer(deps, h.request(uid, { hostId: 'shop', ...body }))

beforeEach(() => {
  h = posOpsHarness()
  searches = []
  captures = []
  keepsPeople = true
  deps = {
    ...h.deps,
    searchPeople: async (request) => {
      searches.push(request)
      if (!keepsPeople) return null
      return [
        {
          kind: 'contact',
          id: 'c-dana',
          email: 'dana@acme.com',
          data: { name: ' Dana Whitfield ', phone: '+1 555 123 4567', email: 'dana@acme.com' },
        },
      ]
    },
    captureContact: async (request) => {
      captures.push(request)
      if (!keepsPeople) return null
      return { ok: true, record: 'contact', contactId: 'c-new', created: true }
    },
    // The aggregate as Firestore answers it, over this in-memory site's
    // orders: the same filter the real one sends.
    orderStats: async (hostRef, emailLower) => {
      const snapshot = await hostRef
        .collection('orders')
        .where('customerEmailLower', '==', emailLower)
        .where('status', 'in', [...POS_CUSTOMER_PAID_STATUSES])
        .get()
      const rows = snapshot.docs.map((doc) => doc.data() ?? {})
      return {
        orderCount: rows.length,
        spentCents: rows.reduce((sum, row) => sum + Number(row['totals']?.totalCents ?? 0), 0),
        refundedCents: rows.reduce((sum, row) => sum + Number(row['refundedCents'] ?? 0), 0),
      }
    },
  }
})

describe('searching for a customer', () => {
  it('asks the person records seam for this site, and lists name, email and phone', async () => {
    const outcome = await customer({ action: 'search', text: 'dana' })
    expect(searches).toEqual([{ hostId: 'shop', orgId: 'org-1', text: 'dana', limit: 10 }])
    expect(outcome.body).toEqual({
      available: true,
      customers: [{ kind: 'contact', id: 'c-dana', name: 'Dana Whitfield', email: 'dana@acme.com', phone: '+1 555 123 4567' }],
    })
  })

  it('says the search is unavailable when no plugin keeps people, rather than "nobody"', async () => {
    keepsPeople = false
    expect((await customer({ action: 'search', text: 'dana' })).body).toEqual({ available: false, customers: [] })
  })

  it('does not ask for one character', async () => {
    await customer({ action: 'search', text: 'd' })
    expect(searches).toHaveLength(0)
  })

  it('refuses a member who cannot work the register', async () => {
    expect((await customer({ action: 'search', text: 'dana' }, 'viewer')).status).toBe(403)
    expect(searches).toHaveLength(0)
  })
})

describe("a customer's history here", () => {
  it('counts paid orders and nets refunds out of lifetime spend', async () => {
    const order = (id: string, data: Record<string, unknown>) =>
      h.memory.seed(`hosts/shop/orders/${id}`, { customerEmailLower: 'dana@acme.com', ...data })
    order('a', { status: 'paid', totals: { totalCents: 5000 } })
    order('b', { status: 'refunded', totals: { totalCents: 2000 }, refundedCents: 2000 })
    order('c', { status: 'fulfilled', totals: { totalCents: 1500 }, refundedCents: 500 })
    order('d', { status: 'pending', totals: { totalCents: 9999 } })
    order('e', { status: 'cancelled', totals: { totalCents: 9999 } })
    h.memory.seed('hosts/other/orders/f', { customerEmailLower: 'dana@acme.com', status: 'paid', totals: { totalCents: 777 } })
    const outcome = await customer({ action: 'stats', email: 'Dana@Acme.com ' })
    expect(outcome.body).toEqual({ orderCount: 3, lifetimeSpendCents: 6000 })
  })

  it('refuses something that is not an address', async () => {
    expect((await customer({ action: 'stats', email: 'dana' })).status).toBe(400)
  })
})

describe('quick-adding a customer', () => {
  it('captures them as a customer the member added, with the phone as a fill', async () => {
    const outcome = await customer({ action: 'create', name: 'Pat Lee', email: 'PAT@example.com', phone: '(555) 222-3333' })
    expect(outcome.body).toMatchObject({
      available: true,
      created: true,
      customer: { kind: 'contact', id: 'c-new', email: 'pat@example.com', name: 'Pat Lee' },
    })
    expect(captures[0]).toMatchObject({
      actor: { kind: 'member', uid: 'cashier' },
      hostId: 'shop',
      identity: { email: 'pat@example.com', name: 'Pat Lee' },
      surface: 'relationship',
      lifecycleFloor: 'customer',
      profileFill: { phone: '(555) 222-3333' },
    })
    expect(captures[0]!.marketingConsent).toBeUndefined()
  })

  it('needs an email, and a phone that looks like one', async () => {
    expect((await customer({ action: 'create', name: 'Pat' })).status).toBe(400)
    expect((await customer({ action: 'create', email: 'pat@example.com', phone: 'call me' })).status).toBe(400)
    expect(captures).toHaveLength(0)
  })

  it('still attaches the email to the sale when no plugin keeps people', async () => {
    keepsPeople = false
    const outcome = await customer({ action: 'create', email: 'pat@example.com' })
    expect(outcome.body).toMatchObject({ available: false, customer: { email: 'pat@example.com', id: '' } })
  })
})
