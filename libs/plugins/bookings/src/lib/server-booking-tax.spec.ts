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
 * The paid-booking session's TAX DECISION (AGL-2000).
 *
 * AGL-1953 made every commerce path state its tax decision explicitly.
 * Bookings sat outside that sweep and stated nothing: no `automatic_tax`, no
 * `tax_rates`, no manual line, and no comment — so a paid service booking
 * charged list price untaxed in both merchant tax modes, and the omission was
 * indistinguishable from an oversight because nothing asserted it.
 *
 * That is what this file fixes. The decision (a goods sales rate must not be
 * applied to a service, and the commerce plugin's settings were never meant to
 * cover this surface) now lives in `server.ts`, and these tests are what make
 * it a DECISION rather than a gap: a future change adding `automatic_tax` here
 * breaks a red test that says why it should not.
 *
 * No Stripe path is exercised beyond the stubbed session POST — localhost
 * carries the LIVE secret key, so `global.fetch` is replaced for the suite and
 * every call is asserted by exact URL.
 */

const stripePosts: Array<{ url: string; params: URLSearchParams }> = []

jest.mock('@aglyn/aglyn/server', () => ({
  registerPluginApiRoute: () => undefined,
  registerPluginConfigSchema: () => undefined,
  registerPluginJob: () => undefined,
  registerBillingWebhookHandler: () => undefined,
  checkEntitlement: () => true,
  resolveBrandingProfile: () => ({ name: 'Acme' }),
}))

jest.mock('@aglyn/tenant-runtime', () => ({
  emitHostEvent: () => undefined,
}))

jest.mock('@aglyn/shared-util-email', () => ({
  isEmailConfigured: () => false,
  loadHostEmail: async () => null,
  renderLoadedHostEmail: () => ({ subject: '', html: '' }),
  sendEmail: async () => undefined,
}))

jest.mock('firebase-admin/firestore', () => ({
  FieldValue: { serverTimestamp: () => 'NOW', delete: () => 'DELETE' },
}))

jest.mock('@aglyn/tenant-data-admin', () => {
  const bookings = new Map<string, Record<string, unknown>>()
  let autoId = 0
  // Open every day, so the slot maths is not what this suite is about. The
  // REAL `computeOpenSlots` still picks the instant below — stubbing the slot
  // logic would let a tax assertion pass against a booking that never happened.
  const serviceDoc = {
    name: 'Deep tissue massage',
    durationMinutes: 60,
    priceUsd: 75,
    timezone: 'UTC',
    windows: {
      0: [{ start: 0, end: 1440 }],
      1: [{ start: 0, end: 1440 }],
      2: [{ start: 0, end: 1440 }],
      3: [{ start: 0, end: 1440 }],
      4: [{ start: 0, end: 1440 }],
      5: [{ start: 0, end: 1440 }],
      6: [{ start: 0, end: 1440 }],
    },
  }
  const state = { service: serviceDoc, bookings }
  const bookingsCollection = {
    doc: (id?: string) => {
      const key = id ?? `booking-${++autoId}`
      return { id: key, path: `bookings/${key}` }
    },
    where: () => bookingsCollection,
    limit: () => bookingsCollection,
    add: async (data: Record<string, unknown>) => {
      const key = `added-${++autoId}`
      bookings.set(key, data)
      return { id: key }
    },
  }
  const hostRef = {
    get: async () => ({ exists: true, get: () => undefined }),
    collection: (name: string) =>
      name === 'bookings' || name === 'events' || name === 'notifications'
        ? bookingsCollection
        : {
            add: async () => ({ id: 'x' }),
            doc: () => ({
              get: async () => ({
                exists: true,
                data: () => state.service,
                get: (field: string) =>
                  (state.service as Record<string, unknown>)[field],
              }),
            }),
          },
  }
  return {
    __state: state,
    firebaseAdmin: {
      app: () => ({
        firestore: () => ({
          collection: () => ({ doc: () => hostRef }),
          runTransaction: async (fn: any) =>
            fn({
              get: async () => ({ docs: [] }),
              set: (ref: any, data: Record<string, unknown>) => {
                bookings.set(ref.id, data)
              },
            }),
        }),
      }),
      firestore: { FieldValue: { serverTimestamp: () => 'NOW' } },
    },
    getOrgForHost: async () => ({ orgId: 'org-1', org: { plan: 'pro' } }),
    resolveOrgIdForHost: async () => 'org-1',
    meterHostEmail: async () => undefined,
    notifyHostManagers: async () => undefined,
    upsertHostContact: () => undefined,
    getPluginConfig: async () => ({}),
    renderHostEmailWithTokens: (value: string) => value,
  }
})

import { bookHandler } from './server'
import { computeOpenSlots } from './model'

const service = (
  jest.requireMock('@aglyn/tenant-data-admin') as {
    __state: { service: any }
  }
).__state.service

/**
 * A real bookable instant, from the real slot generator — never a hand-picked
 * timestamp that happens to line up today and stops lining up tomorrow.
 */
function nextBookableStart(): number {
  const from = Date.now() + 3 * 24 * 60 * 60_000
  const slots = computeOpenSlots(
    service,
    from,
    from + 2 * 24 * 60 * 60_000,
    [],
    1,
  )
  if (!slots.length) throw new Error('the fixture service has no open slot')
  return slots[0].startsAtMs
}

const makeRes = () => {
  const res: any = {
    statusCode: 0,
    body: undefined as unknown,
    status(code: number) {
      res.statusCode = code
      return res
    },
    json(payload: unknown) {
      res.body = payload
      return res
    },
  }
  return res
}

const makeReq = () =>
  ({
    method: 'POST',
    body: {
      hostId: 'host-1',
      serviceId: 'service-1',
      startsAtMs: nextBookableStart(),
      name: 'Dana',
      email: 'dana@example.com',
    },
    headers: { host: 'shop.example.com', 'x-forwarded-for': '203.0.113.9' },
    socket: { remoteAddress: '203.0.113.9' },
    query: {},
    cookies: {},
  }) as any

const originalFetch = global.fetch
const ORIGINAL_KEY = process.env.STRIPE_SECRET_KEY

beforeAll(() => {
  global.fetch = jest.fn(async (url: any, init?: any) => {
    const address = String(url)
    if (address === 'https://api.stripe.com/v1/checkout/sessions') {
      stripePosts.push({
        url: address,
        params: new URLSearchParams(String(init?.body ?? '')),
      })
      return {
        ok: true,
        json: async () => ({ url: 'https://checkout.stripe.com/c/pay/x' }),
      }
    }
    throw new Error(`Unexpected fetch to ${address}`)
  }) as unknown as typeof fetch
  process.env.STRIPE_SECRET_KEY = 'sk_test_bookings_spec'
})

afterAll(() => {
  global.fetch = originalFetch
  if (ORIGINAL_KEY === undefined) delete process.env.STRIPE_SECRET_KEY
  else process.env.STRIPE_SECRET_KEY = ORIGINAL_KEY
})

beforeEach(() => {
  stripePosts.length = 0
})

describe('a paid booking states its tax decision (AGL-2000)', () => {
  it('creates the session — the positive control for everything below', async () => {
    // If the handler stopped charging at all, every "no tax" assertion here
    // would pass vacuously. This is the assertion that stops that.
    const res = makeRes()
    await bookHandler(makeReq(), res)
    expect(res.statusCode).toBe(200)
    expect(stripePosts).toHaveLength(1)
    const params = stripePosts[0].params
    expect(params.get('line_items[0][price_data][unit_amount]')).toBe('7500')
    expect(params.get('metadata[type]')).toBe('booking-payment')
  })

  it('carries NO tax parameter of any kind, deliberately', async () => {
    const res = makeRes()
    await bookHandler(makeReq(), res)
    const params = stripePosts[0].params
    // Stripe Tax would compute a GOODS rate on a service — it has no service
    // tax code from this handler.
    expect(params.get('automatic_tax[enabled]')).toBeNull()
    // Nor a Tax Rate on the line…
    expect(params.get('line_items[0][tax_rates][0]')).toBeNull()
    // …nor the AGL-1711 second line that carries commerce's manual tax…
    expect(params.get('line_items[1][price_data][unit_amount]')).toBeNull()
    // …nor a metadata witness claiming a tax figure that was never charged.
    expect(params.get('metadata[taxCents]')).toBeNull()
  })

  it('charges the service price and nothing on top', async () => {
    // The arithmetic statement of the same decision: whatever the merchant
    // configured in Commerce → Taxes, the client pays list price here.
    const res = makeRes()
    await bookHandler(makeReq(), res)
    const params = stripePosts[0].params
    const keys = [...params.keys()].filter((key) =>
      key.startsWith('line_items['),
    )
    // Exactly ONE line item: quantity, currency, unit_amount, product name.
    expect(keys.every((key) => key.startsWith('line_items[0]'))).toBe(true)
  })

  it('stamps the metadata the tax ledger needs to file the sale', async () => {
    // AGL-2000's other half: the sale was absent from SESSION_TYPES, so an
    // untaxed booking left no row at all. The recorder joins on these two.
    const res = makeRes()
    await bookHandler(makeReq(), res)
    const params = stripePosts[0].params
    expect(params.get('metadata[type]')).toBe('booking-payment')
    expect(params.get('metadata[hostId]')).toBe('host-1')
  })
})
