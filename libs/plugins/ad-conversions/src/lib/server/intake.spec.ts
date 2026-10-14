/**
 * @jest-environment node
 */
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

import { intakeOrderPaid, recordOrderConsent, reportLead, type IntakeDeps } from './intake'
import { emptyConnection } from './store'
import { createMemoryAdConversionStore } from '../testing/memory-store'

/**
 * The consent gate and the queue (AGL-3694): nothing is owed without a
 * consent that grants, a redelivered order is owed once, and a test-mode
 * order is never owed as live.
 */

const HOST_ID = 'host-1'
const NOW = Date.UTC(2026, 9, 8, 12, 0, 0)

const HOST = {
  analytics: { gaMeasurementId: 'G-ABC1234', adTags: { meta: '1234567890', tiktok: 'C4ABCDEFGH1234567890', pinterest: '2612345678901' } },
  consent: { advertising: true },
}

const WIRE = {
  v: 1,
  status: 'accepted',
  advertising: true,
  at: NOW - 60_000,
  country: 'US',
  url: 'https://shop.example.com/cart?email=x@example.com',
  lead: 'lead-123',
  ids: { fbp: 'fb.1.1.2', ttp: 'ttp-1', epik: 'epik-1' },
}

const FACTS = { userAgent: 'Mozilla/5.0', ip: '203.0.113.9', gpc: false }

function setup(options: { host?: Record<string, unknown> | null; enabled?: boolean; providers?: Array<'meta' | 'tiktok' | 'pinterest'> } = {}) {
  const memory = createMemoryAdConversionStore()
  for (const provider of options.providers ?? ['meta']) {
    memory.connections.set(`${HOST_ID}_${provider}`, {
      ...emptyConnection({ orgId: 'org-1', hostId: HOST_ID, provider, nowMs: NOW }),
      sealedToken: 'sealed',
      ...(provider === 'pinterest' ? { adAccountId: '549755885175' } : {}),
    })
  }
  const deps: IntakeDeps = {
    store: memory.store,
    host: async () => (options.host === undefined ? HOST : options.host) as never,
    enabled: async () => options.enabled !== false,
    now: () => NOW,
  }
  return { memory, deps }
}

const paid = (orderId: string, attempt = 1) => ({
  id: `env-${orderId}-${attempt}`,
  event: 'order.paid',
  hostId: HOST_ID,
  orgId: 'org-1',
  occurredAtMs: NOW,
  attempt,
  payload: {
    order: {
      id: orderId,
      currency: 'usd',
      customerEmail: 'Shopper@Example.com',
      customerName: 'Sam Shopper',
      lineItems: [{ productId: 'prod-1', name: 'Mug', quantity: 2, unitAmountCents: 1000 }],
      totals: { itemsCents: 2000, taxCents: 165, totalCents: 2665 },
      shippingAddress: { city: 'San Francisco', state: 'CA', postalCode: '94107', country: 'US' },
    },
  },
})

describe('a checkout’s consent', () => {
  it('is recorded when it grants advertising on a site with a connection', async () => {
    const { memory, deps } = setup()
    expect(await recordOrderConsent(deps, { hostId: HOST_ID, orderKey: 'cs_live_1', wire: WIRE, ...FACTS })).toBe(true)
    const consent = memory.consents.get(`${HOST_ID}_cs_live_1`)
    expect(consent).toMatchObject({ orgId: 'org-1', status: 'accepted', ip: '203.0.113.9', ids: { fbp: 'fb.1.1.2' } })
    // Origin and path only: the query string never reaches the store.
    expect(consent?.url).toBe('https://shop.example.com/cart')
  })

  it.each([
    ['a refusal', { ...WIRE, status: 'declined' }, FACTS, HOST],
    ['a GPC opt-out', { ...WIRE, status: 'gpc-opt-out' }, FACTS, HOST],
    ['an analytics-only record', { ...WIRE, advertising: false }, FACTS, HOST],
    ['a request carrying GPC', WIRE, { ...FACTS, gpc: true }, HOST],
    ['a site that does not ask about advertising', WIRE, FACTS, { ...HOST, consent: {} }],
    ['a site running its own consent tool', WIRE, FACTS, { ...HOST, consent: { advertising: true, disabled: true } }],
    ['no wire at all', null, FACTS, HOST],
  ])('is NOT recorded for %s', async (_label, wire, facts, host) => {
    const { memory, deps } = setup({ host })
    expect(await recordOrderConsent(deps, { hostId: HOST_ID, orderKey: 'cs_live_1', wire, ...facts })).toBe(false)
    expect(memory.consents.size).toBe(0)
  })

  it('is not recorded on a site with no connection, or with the plugin off', async () => {
    const none = setup({ providers: [] })
    expect(await recordOrderConsent(none.deps, { hostId: HOST_ID, orderKey: 'cs_live_1', wire: WIRE, ...FACTS })).toBe(false)
    const off = setup({ enabled: false })
    expect(await recordOrderConsent(off.deps, { hostId: HOST_ID, orderKey: 'cs_live_1', wire: WIRE, ...FACTS })).toBe(false)
  })
})

describe('order.paid', () => {
  it('owes a Purchase, hashed, under the id the browser tag used', async () => {
    const { memory, deps } = setup()
    await recordOrderConsent(deps, { hostId: HOST_ID, orderKey: 'cs_live_1', wire: WIRE, ...FACTS })
    expect(await intakeOrderPaid(deps, paid('cs_live_1'))).toBe(1)
    const owed = memory.events.get(`${HOST_ID}_meta_purchase.cs_live_1`)
    expect(owed).toMatchObject({
      status: 'pending',
      test: null,
      pixelId: '1234567890',
      event: {
        id: 'purchase.cs_live_1',
        name: 'purchase',
        currency: 'USD',
        // Ex-tax, as the browser's `purchase` value is.
        valueCents: 2500,
        orderId: 'cs_live_1',
        browser: { ip: '203.0.113.9', userAgent: 'Mozilla/5.0', fbp: 'fb.1.1.2' },
      },
    })
    expect(JSON.stringify(owed)).not.toMatch(/shopper@example\.com|Sam Shopper|San Francisco/i)
    expect(owed?.event.user.em).toMatch(/^[0-9a-f]{64}$/)
    // The consent has served its order.
    expect(memory.consents.size).toBe(0)
  })

  it('owes nothing when no consent was recorded: unknown is no', async () => {
    const { memory, deps } = setup()
    expect(await intakeOrderPaid(deps, paid('cs_live_2'))).toBe(0)
    expect(memory.events.size).toBe(0)
  })

  it('a redelivered order event is owed once', async () => {
    const { memory, deps } = setup()
    await recordOrderConsent(deps, { hostId: HOST_ID, orderKey: 'cs_live_1', wire: WIRE, ...FACTS })
    await intakeOrderPaid(deps, paid('cs_live_1', 1))
    // Even with the consent still on file, the owed event is the dedupe.
    await recordOrderConsent(deps, { hostId: HOST_ID, orderKey: 'cs_live_1', wire: WIRE, ...FACTS })
    expect(await intakeOrderPaid(deps, paid('cs_live_1', 2))).toBe(0)
    expect(memory.events.size).toBe(1)
  })

  it('a Stripe test-mode order is owed only with a test marker, never live', async () => {
    const { memory, deps } = setup({ providers: ['meta', 'tiktok', 'pinterest'] })
    memory.connections.get(`${HOST_ID}_tiktok`)!.testEventCode = 'TEST42'
    await recordOrderConsent(deps, { hostId: HOST_ID, orderKey: 'cs_test_1', wire: WIRE, ...FACTS })
    expect(await intakeOrderPaid(deps, paid('cs_test_1'))).toBe(2)
    // Meta has no test code: nothing owed to it.
    expect(memory.events.has(`${HOST_ID}_meta_purchase.cs_test_1`)).toBe(false)
    expect(memory.events.get(`${HOST_ID}_tiktok_purchase.cs_test_1`)?.test).toBe('TEST42')
    expect(memory.events.get(`${HOST_ID}_pinterest_purchase.cs_test_1`)?.test).toBe(true)
  })

  it('a live order never carries the test code', async () => {
    const { memory, deps } = setup()
    memory.connections.get(`${HOST_ID}_meta`)!.testEventCode = 'TEST42'
    await recordOrderConsent(deps, { hostId: HOST_ID, orderKey: 'cs_live_1', wire: WIRE, ...FACTS })
    await intakeOrderPaid(deps, paid('cs_live_1'))
    expect(memory.events.get(`${HOST_ID}_meta_purchase.cs_live_1`)?.test).toBeNull()
  })

  it('a pixel vendor with no pixel id on the site is owed nothing', async () => {
    const { memory, deps } = setup({ host: { ...HOST, analytics: { gaMeasurementId: 'G-ABC1234', adTags: {} } } })
    await memory.store.putConsent(`${HOST_ID}_cs_live_1`, {
      orgId: 'org-1', hostId: HOST_ID, orderKey: 'cs_live_1', status: 'accepted', consentAtMs: NOW, country: 'US',
      url: null, ids: {}, userAgent: null, ip: null, createdAtMs: NOW, expiresAt: new Date(NOW + 1000),
    })
    expect(await intakeOrderPaid(deps, paid('cs_live_1'))).toBe(0)
  })
})

describe('a lead', () => {
  it('is owed under the id its form minted, with the person hashed', async () => {
    const { memory, deps } = setup()
    const owed = await reportLead(deps, {
      hostId: HOST_ID,
      wire: WIRE,
      ...FACTS,
      person: { email: 'Lead@Example.com', phone: '+1 555 123 4567', name: 'Lee Lead' },
      formName: 'Contact',
    })
    expect(owed).toBe(1)
    const event = memory.events.get(`${HOST_ID}_meta_lead.lead-123`)
    expect(event).toMatchObject({ event: { id: 'lead.lead-123', name: 'lead', valueCents: null } })
    expect(JSON.stringify(event)).not.toMatch(/lead@example\.com|Lee Lead/i)
    expect(event?.emailHash).toMatch(/^[0-9a-f]{64}$/)
  })

  it('is not owed without consent, or without the id the browser sent it under', async () => {
    const { memory, deps } = setup()
    expect(await reportLead(deps, { hostId: HOST_ID, wire: { ...WIRE, status: 'opted-out' }, ...FACTS, person: {} })).toBe(0)
    const { lead: _lead, ...noLead } = WIRE
    expect(await reportLead(deps, { hostId: HOST_ID, wire: noLead, ...FACTS, person: {} })).toBe(0)
    expect(memory.events.size).toBe(0)
  })
})
