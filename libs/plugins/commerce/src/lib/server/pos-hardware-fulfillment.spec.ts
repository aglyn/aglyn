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
 * The platform's fulfillment of a shipped hardware order (AGL-4038): bought
 * in from the supplier, received, set up, shipped with tracking, delivered.
 * Driven through the real staff route with Firestore, Stripe's reader
 * registration and email faked at their edges:
 *
 * - an order moves Ordered → Received → Shipped → Delivered, one step at a
 *   time, and does not ship until every reader's serial is recorded;
 * - a reader is registered to the buyer's store by its code before it ships,
 *   when the store can take it; an order from our own store nobody is
 *   attached to yet is refused with the way it gets set up instead;
 * - an order whose readers were all registered before it shipped reads Set
 *   up once delivered, and its delivery email says it is already set up;
 * - a serial already on another order is refused, and nothing is set up
 *   once the order has shipped.
 */

import { fakeDocs, resetFakeFirestore } from '../testing/fake-firestore'

const mockSent: Array<Record<string, any>> = []
const mockAudits: Array<Record<string, any>> = []
const mockRegistered: Array<Record<string, unknown>> = []

jest.mock('@aglyn/tenant-data-admin', () => {
  const fake = jest.requireActual('../testing/fake-firestore')
  return {
    firebaseAdmin: {
      app: () => ({
        auth: () => ({
          verifyIdToken: async (token: string) => {
            if (token !== 'staff-super') throw Object.assign(new Error('expired'), { code: 'auth/id-token-expired' })
            return { uid: 'staff-1', email: 'ops@example.com', email_verified: true, staff: true, staffRole: 'super' }
          },
        }),
        firestore: () => fake.fakeFirestore,
      }),
      firestore: { FieldValue: fake.fakeFieldValue },
    },
    getOrgForHost: async (hostId: string) => ({
      orgId: hostId === 'host-1' ? 'org-1' : 'org-seller',
      org: { id: 'org-1', plan: 'business', subscriptionStatus: 'active', ownerUid: 'owner-1' },
    }),
    hostDisplayName: (host: Record<string, unknown>, id: string) => String(host['name'] ?? id),
    meterPlatformEmail: async () => undefined,
    raiseOperatorAlert: async () => ({ outcome: 'sent' }),
    emailUnverifiedResponse: () => Response.json({ error: 'Verify your email' }, { status: 403 }),
    isImpersonationSession: () => false,
  }
})
jest.mock('@aglyn/tenant-data-admin/server/host-console-link', () => ({
  hostConsoleUrl: async (hostId: string, link: string) => `https://console.example.com/acme/hosts/${hostId}${link}`,
}))
jest.mock('@aglyn/tenant-data-admin/server/admin-audit-write', () => ({
  addAdminAudit: async (_firestore: unknown, entry: Record<string, any>) => {
    mockAudits.push(entry)
    return { id: 'audit' }
  },
}))
jest.mock('@aglyn/tenant-data-admin/server/email-suppression', () => ({
  filterSuppressedEmails: async (addresses: string[]) => addresses,
}))
jest.mock('@aglyn/tenant-data-admin/server/render-system-email', () => ({
  orgSystemEmailBrand: async () => ({ merge: {}, options: {}, fromName: '' }),
  renderSystemEmailContent: async (key: string, merge: Record<string, string>, _brand: unknown, fallback: { subject: string }) => ({
    subject: fallback.subject,
    html: `<p>${key}</p>`,
    text: JSON.stringify(merge),
  }),
}))
jest.mock('@aglyn/shared-util-email', () => ({
  ...jest.requireActual('@aglyn/shared-util-email/pos-hardware-emails'),
  sendEmail: async (message: Record<string, any>) => {
    mockSent.push(message)
    return { sent: true }
  },
}))
// Stripe's reader registration, as the POS devices card makes it.
jest.mock('./pos-readers', () => ({
  registerPosTerminalReader: async (input: Record<string, unknown>) => {
    mockRegistered.push(input)
    return { ok: true, id: `tmr_${mockRegistered.length}`, reader: { serialNumber: null } }
  },
}))

import { POS_HARDWARE_EMAIL_KEYS } from '@aglyn/shared-util-email/pos-hardware-emails'
import type { PosHardwareOrder } from '../model/pos-hardware'
import { posHardwareAdminOrders } from './pos-hardware-admin'

const ORDER_ID = 'hw_0123456789abcdef0123'
const ORDER_PATH = `orgs/org-1/hardwareOrders/${ORDER_ID}`

async function staff(body: Record<string, unknown>) {
  const answer = await posHardwareAdminOrders(
    new Request('https://console.example.com/api/commerce/admin/hardware-orders', {
      method: 'POST',
      headers: { authorization: 'Bearer staff-super', 'content-type': 'application/json' },
      body: JSON.stringify({ orgId: 'org-1', orderId: ORDER_ID, ...body }),
    }),
  )
  return { status: answer.status, body: (await answer.json()) as any }
}

const step = (status: string, extra: Record<string, unknown> = {}) => staff({ action: 'update', status, ...extra })
const order = () => fakeDocs.get(ORDER_PATH) as PosHardwareOrder

/** An order from the Hardware card: two readers and a dock, for the buyer's store `host-1`. */
function seed(fields: Partial<PosHardwareOrder> = {}) {
  fakeDocs.set(ORDER_PATH, {
    orgId: 'org-1',
    hostId: 'host-1',
    status: 'paid',
    contactEmail: 'buyer@example.com',
    lines: [
      { sku: 'stripe-reader-s700', name: 'Touchscreen reader (S700)', quantity: 2, unitCents: 30_000, lineCents: 60_000 },
      { sku: 'stripe-reader-s700-dock', name: 'Charging dock', quantity: 1, unitCents: 5_000, lineCents: 5_000 },
    ],
    subtotalCents: 65_000,
    shipping: { method: 'standard', label: 'Standard shipping', cents: 1_000, name: 'Jordan Lee', phone: null, address: null },
    taxCents: 0,
    totalCents: 66_000,
    stripePaymentIntentId: 'pi_test_1',
    stripeHardwareOrderId: null,
    tracking: null,
    livemode: true,
    createdAtMs: 1,
    updatedAtMs: 1,
    paidAtMs: 1,
    ...fields,
  } as PosHardwareOrder)
}

beforeEach(() => {
  resetFakeFirestore()
  mockSent.length = 0
  mockAudits.length = 0
  mockRegistered.length = 0
  process.env['STRIPE_SECRET_KEY'] = 'sk_test_fake'
  fakeDocs.set('hosts/host-1', { name: 'Corner Cafe', orgId: 'org-1' })
  fakeDocs.set('hosts/host-1/terminal/config', { stripeLocationId: 'tml_1' })
  fakeDocs.set('orgs/org-1', { name: 'Acme' })
})

describe('ordered, received, set up, shipped, delivered', () => {
  it('moves one step at a time, and ships only once every reader’s serial is recorded', async () => {
    seed()
    expect((await step('ordered', { stripeHardwareOrderId: 'thor_1' })).status).toBe(200)
    // Received is its own step now: ordered no longer jumps to shipped.
    expect((await step('shipped', { tracking: { carrier: 'UPS', number: '1Z1' } })).status).toBe(409)
    expect((await step('received')).status).toBe(200)
    expect(order()).toMatchObject({ status: 'received', receivedAtMs: expect.any(Number) })
    expect(fakeDocs.get(`posHardwareSales/${ORDER_ID}`)).toMatchObject({ status: 'received', receivedAtMs: expect.any(Number) })

    const early = await step('shipped', { tracking: { carrier: 'UPS', number: '1Z1' } })
    expect(early.status).toBe(409)
    expect(early.body.error).toBe('Set every reader up first: 2 of 2 still need a serial number.')

    const serials = await staff({ action: 'serials', serials: [' wsc-1 ', 'WSC-2'] })
    expect(serials.status).toBe(200)
    expect(order().serialNumbers).toEqual(['WSC-1', 'WSC-2'])
    expect(serials.body.order.units.map((unit: { serialNumber: string }) => unit.serialNumber)).toEqual(['WSC-1', 'WSC-2'])
    expect(mockAudits.map((audit) => audit.action)).toContain('pos-hardware-order-serials')

    expect((await step('shipped', { tracking: { carrier: 'UPS', number: '1Z1' } })).status).toBe(200)
    expect(mockSent.map((message) => message.context)).toEqual([POS_HARDWARE_EMAIL_KEYS.shipped])
    expect((await step('delivered')).status).toBe(200)
    // Paired later by the buyer: still waiting to be set up on their store.
    expect(order().status).toBe('delivered')
    expect(JSON.parse(mockSent[1].text)['order.setupSteps']).toContain('generate a pairing code')
  })

  it('registers a reader to the buyer’s store before it ships; all registered reads Set up once delivered', async () => {
    seed({ status: 'received' })
    await staff({ action: 'serials', serials: ['WSC-1', 'WSC-2'] })
    const first = await staff({ action: 'register-reader', registrationCode: 'quick-brown-fox' })
    expect(first.status).toBe(200)
    expect(mockRegistered[0]).toMatchObject({ hostId: 'host-1', orgId: 'org-1', uid: 'staff-1', registrationCode: 'quick-brown-fox' })
    expect(order().units?.map((unit) => unit.readerId)).toEqual(['tmr_1', null])
    await staff({ action: 'register-reader', registrationCode: 'lazy-dog' })
    expect(order().units?.map((unit) => [unit.serialNumber, unit.readerId, unit.hostId])).toEqual([
      ['WSC-1', 'tmr_1', 'host-1'],
      ['WSC-2', 'tmr_2', 'host-1'],
    ])
    // Every reader is set up: there is nothing more to register.
    const more = await staff({ action: 'register-reader', registrationCode: 'one-more' })
    expect(more.status).toBe(409)
    expect(more.body.error).toBe('Every reader on this order is registered.')
    expect(mockRegistered).toHaveLength(2)

    await step('shipped', { tracking: { carrier: 'UPS', number: '1Z1' } })
    await step('delivered')
    expect(order()).toMatchObject({ status: 'registered', deliveredAtMs: expect.any(Number), registeredAtMs: expect.any(Number) })
    const delivered = mockSent.find((message) => message.context === POS_HARDWARE_EMAIL_KEYS.delivered)
    expect(JSON.parse(delivered!.text)['order.setupSteps']).toContain('We set your reader up on your store before it shipped.')
  })

  it('asks for the store’s plan and Location before registering', async () => {
    seed({ status: 'received' })
    fakeDocs.delete('hosts/host-1/terminal/config')
    const answer = await staff({ action: 'register-reader', registrationCode: 'quick-brown-fox' })
    expect(answer.status).toBe(409)
    expect(answer.body.reason).toBe('needs-address')
    expect(mockRegistered).toHaveLength(0)
  })

  it('refuses to register a reader of an order from our store nobody is attached to yet, and says how it is set up', async () => {
    seed({
      status: 'received',
      hostId: '',
      source: 'storefront',
      attachment: { state: 'pending', email: 'buyer@example.com', uid: null, orgId: null, hostId: null, attachedBy: null, attachedAtMs: null },
    })
    const answer = await staff({ action: 'register-reader', registrationCode: 'quick-brown-fox' })
    expect(answer.status).toBe(409)
    expect(answer.body.error).toMatch(/^Attach the order to the buyer’s workspace first/)
    // Its serials are still recorded, so the reader finds its order when the buyer pairs it.
    expect((await staff({ action: 'serials', serials: ['WSC-1', 'WSC-2'] })).status).toBe(200)
  })

  it('refuses a serial already on another order, one listed twice, and more serials than readers', async () => {
    seed({ status: 'received' })
    fakeDocs.set('orgs/org-2/hardwareOrders/hw_ffffffffffffffffffff', { orgId: 'org-2', status: 'shipped', serialNumbers: ['WSC-9'] })
    expect((await staff({ action: 'serials', serials: ['WSC-9'] })).body.error).toBe('Serial number WSC-9 is already on another order.')
    expect((await staff({ action: 'serials', serials: ['A', 'a'] })).body.error).toBe('A serial number is listed twice.')
    expect((await staff({ action: 'serials', serials: ['A', 'B', 'C'] })).body.error).toBe('This order has 2 readers.')
  })

  it('sets nothing up once the order has shipped', async () => {
    seed({ status: 'shipped' })
    expect((await staff({ action: 'serials', serials: ['WSC-1'] })).status).toBe(409)
    expect((await staff({ action: 'register-reader', registrationCode: 'quick-brown-fox' })).status).toBe(409)
    expect(mockRegistered).toHaveLength(0)
  })
})
