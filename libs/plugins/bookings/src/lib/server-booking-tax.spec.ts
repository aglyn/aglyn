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

const stripePosts: Array<{
  url: string
  params: URLSearchParams
  headers: Record<string, string>
}> = []

jest.mock('@aglyn/aglyn/server', () => ({
  registerPluginApiRoute: () => undefined,
  registerPluginConfigSchema: () => undefined,
  registerPluginJob: () => undefined,
  registerBillingWebhookHandler: () => undefined,
  checkEntitlement: () => true,
  resolveBrandingProfile: () => ({ name: 'Acme' }),
  // The REAL fee resolver (AGL-2315). A stub returning a constant would let
  // this suite pass against a fee the plan ladder never priced. Required from
  // the source module rather than through `requireActual` on the whole
  // `/server` barrel, which drags in the realm server and the API adapter —
  // the `apply-publish-schedule.spec.ts` pattern.
  resolveTransactionFeePct: jest.requireActual(
    '../../../../aglyn/src/lib/app-utils/plan-entitlements',
  ).resolveTransactionFeePct,
  // The cents form the handler actually calls (AGL-2152) — the ladder's take
  // PLUS Stripe's processing cost, which on a destination charge is debited
  // from the PLATFORM's balance. Real for the same reason the rate above is.
  resolveTransactionFeeCents: jest.requireActual(
    '../../../../aglyn/src/lib/app-utils/plan-entitlements',
  ).resolveTransactionFeeCents,
  storefrontProcessingCostCents: jest.requireActual(
    '../../../../aglyn/src/lib/app-utils/plan-entitlements',
  ).storefrontProcessingCostCents,
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
  // The OWNER'S CONNECTED-ACCOUNT PROFILE (AGL-2315). A paid booking is a
  // destination charge, so the handler reads `profiles/{ownerUid}` for the
  // merchant's Stripe account before it will open a session. The double models
  // it because the double must model real semantics: without it every paid
  // test 409s on "Payments are not set up yet" and the suite reads as a red
  // that has nothing to do with what it asserts.
  const ownerProfile: Record<string, unknown> = {
    stripeAccountId: 'acct_merchant_1',
    stripeChargesEnabled: true,
  }
  const state = {
    service: serviceDoc,
    bookings,
    ownerProfile,
    /**
     * The COMMERCE plugin's `hosts/{hostId}/settings/store` document, which
     * is where the merchant's service tax rate lives (AGL-2028). Modelled
     * because the double must model real semantics: the handler reads a
     * `settings` collection by name, and a fake that answered the service
     * document for every collection would let a test "configure a rate" that
     * the handler could never actually have read.
     */
    store: {} as Record<string, unknown>,
    /** The org doc `getOrgForHost` answers with — the fee's own input. */
    org: { id: 'org-1', ownerUid: 'owner-1', plan: 'pro' } as Record<
      string,
      unknown
    >,
    /** Writes to every collection other than bookings/events/notifications. */
    written: {} as Record<string, Array<Record<string, unknown>>>,
  }
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
            // Every OTHER collection's writes, recorded by name (AGL-2303).
            // `leads` came through here and the double dropped it on the
            // floor, so nothing could see that the handler wrote a lead with
            // no name on it — the field `campaign-send` reads for merge tags.
            // A double that discards a write cannot fail on a wrong one.
            add: async (data: Record<string, unknown>) => {
              const written = state.written[name] ?? (state.written[name] = [])
              written.push(data)
              return { id: `${name}-${++autoId}` }
            },
            doc: () => ({
              get: async () =>
                name === 'settings'
                  ? {
                      exists: Object.keys(state.store).length > 0,
                      data: () => state.store,
                      get: (field: string) => state.store[field],
                    }
                  : {
                      exists: true,
                      data: () => state.service,
                      get: (field: string) =>
                        (state.service as Record<string, unknown>)[field],
                    },
            }),
          },
  }
  // Top-level collections are resolved BY NAME (AGL-2315). The old double
  // answered `hostRef` for every collection whatever it was called, so
  // `profiles` and `hosts` were the same object — a fake in which the owner's
  // Stripe account could not be told apart from the site document, and in
  // which a handler reading the WRONG collection would still pass.
  const profilesCollection = {
    doc: (uid: string) => ({
      id: uid,
      get: async () => ({
        exists: uid === state.org['ownerUid'],
        get: (field: string) =>
          uid === state.org['ownerUid'] ? state.ownerProfile[field] : undefined,
      }),
    }),
  }
  return {
    __state: state,
    firebaseAdmin: {
      app: () => ({
        firestore: () => ({
          collection: (name: string) =>
            name === 'profiles' ? profilesCollection : { doc: () => hostRef },
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
    getOrgForHost: async () => ({ orgId: 'org-1', org: state.org }),
    resolveOrgIdForHost: async () => 'org-1',
    meterHostEmail: async () => undefined,
    notifyHostManagers: async () => undefined,
    upsertHostContact: () => undefined,
    getPluginConfig: async () => ({}),
    renderHostEmailWithTokens: (value: string) => value,
    // Both booking paths now write their lead through the ONE bounded writer
    // (AGL-1529) instead of `hostRef.collection('leads').add(…)`. Recorded
    // into the same `written['leads']` the direct write landed in, so the
    // AGL-2303 payload assertions below keep reading the thing that was
    // stored — a double that answered `true` and forgot the payload could not
    // fail on a lead with no name on it, which is the bug they exist for.
    addHostLead: async (options: { lead: Record<string, unknown> }) => {
      const written = state.written['leads'] ?? (state.written['leads'] = [])
      written.push({ ...options.lead, createdAt: 'NOW' })
      return true
    },
  }
})

import {
  resolveTransactionFeeCents,
  storefrontProcessingCostCents,
} from '@aglyn/aglyn'
import { bookHandler } from './server'

/**
 * The mocked admin module's own state, so a write can be asserted rather than
 * merely not throwing (AGL-2303).
 */
const mockAdmin = jest.requireMock('@aglyn/tenant-data-admin') as {
  __state: {
    written: Record<string, Array<Record<string, unknown>>>
    store: Record<string, unknown>
  }
}
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

/**
 * The Nth OPEN slot, rather than the first one plus N × 6 hours (AGL-2486).
 *
 * The offset arithmetic was a clock-dependent test. `computeOpenSlots` walks
 * a 15-minute grid in absolute epoch terms and keeps only instants where
 * `minutes + duration <= window.end`, so on this fixture — 60 minutes against
 * windows that end at 1440 — nothing may START after 23:00. The fixture reads
 * as open 24/7 and is not: a slot cannot span midnight.
 *
 * `nextBookableStart()` is `now + 3 days` rounded up to the grid, so the
 * offsets moved with the wall clock. Measured: at 23:45 local the four
 * bookers landed at 04:45 / 10:45 / 16:45 / 22:45 and the suite was green; at
 * 00:29 they landed at 05:45 / 11:45 / 17:45 / 23:45 and the fourth 409'd
 * with "Slot unavailable" — the same tree, an hour apart. Two tests failed
 * naming Stripe params and a status code, neither of which was the fault.
 *
 * Asking the model for real slots removes the arithmetic entirely: whatever
 * it returns is open by construction, at any hour the suite happens to run.
 * The stride keeps them far enough apart that a slot one test holds cannot
 * collide with the next — consecutive open slots are 15 minutes apart and the
 * service books 60, so four is the minimum and eight is margin.
 */
function nthBookableStart(index: number): number {
  const from = Date.now() + 3 * 24 * 60 * 60_000
  const stride = 8
  const wanted = index * stride
  const slots = computeOpenSlots(
    service,
    from,
    from + 7 * 24 * 60 * 60_000,
    [],
    wanted + 1,
  )
  if (slots.length <= wanted) {
    throw new Error(
      `the fixture service has ${slots.length} open slots, needed ${wanted + 1}`,
    )
  }
  return slots[wanted].startsAtMs
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

const makeReq = (overrides: Record<string, unknown> = {}) =>
  ({
    method: 'POST',
    body: {
      hostId: 'host-1',
      serviceId: 'service-1',
      startsAtMs: nextBookableStart(),
      ...overrides,
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
        // AGL-2147: the money-safety half of this call is a HEADER, so the
        // capture has to keep the headers or the assertion below could only
        // ever be written against the body and would pass vacuously.
        headers: (init?.headers ?? {}) as Record<string, string>,
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
  // Per test. A merchant's tax settings leaking from one test into the next
  // is exactly how a "charges no tax by default" assertion goes green for the
  // wrong reason.
  for (const key of Object.keys(mockAdmin.__state.store)) {
    delete mockAdmin.__state.store[key]
  }
  // Per test, or an assertion about "the lead this booking wrote" would be an
  // assertion about every lead the suite has written so far.
  for (const key of Object.keys(mockAdmin.__state.written)) {
    delete mockAdmin.__state.written[key]
  }
})

describe('a paid booking with no service rate set charges no tax (AGL-2028)', () => {
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

    // THE GUARD ITSELF, widened (AGL-2028).
    //
    // The four assertions above are an allowlist of four exact keys, and a
    // change that adds tax by any other spelling walks straight past them:
    // `automatic_tax[liability][type]`, `tax_id_collection[enabled]`,
    // `line_items[0][price_data][tax_behavior]` and
    // `subscription_data[default_tax_rates][0]` are all real Stripe
    // parameters that this body would have carried silently.
    //
    // AGL-2028 exists because the AGL-2000 decision is a HOLDING position
    // that someone will come back and change — so the test whose job is to
    // make them come back here has to actually catch them. Stated as a
    // property over the whole emitted body rather than as a longer
    // allowlist, because the next spelling is by definition the one nobody
    // listed.
    //
    // Asserted on the SAME session this test already built rather than in a
    // test of its own: `bookHandler` holds the slot it books, so a second
    // call against the same fixture is refused and every assertion after it
    // would read an empty `stripePosts`.
    expect([...params.keys()].filter((key) => /tax/i.test(key))).toEqual([])
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

  it('is unmoved by the GOODS sales rate the merchant configured', async () => {
    // The reason a service field had to exist rather than a reuse of
    // `rates[]`. A store with a complete manual sales-tax setup — mode,
    // origin, a matching 8.25% zone rate — still charges nothing on an
    // appointment, because whether a service is taxable is a different
    // question with frequently the opposite answer.
    //
    // Without this, every "charges no tax" assertion above could hold merely
    // because the fixture store had no tax settings at all.
    mockAdmin.__state.store['tax'] = {
      mode: 'manual',
      origin: { country: 'US', state: 'TX' },
      rates: [{ country: 'US', state: 'TX', pct: 8.25, label: 'TX sales tax' }],
    }
    const res = makeRes()
    // Its own booker: `makeReq` pins one IP and the handler rate-limits on
    // it, so an extra test on the shared fixture pushes a LATER test past the
    // limit and turns it 429 for a reason that has nothing to do with tax.
    await bookHandler(
      {
        method: 'POST',
        body: {
          hostId: 'host-1',
          serviceId: 'service-1',
          startsAtMs: nextBookableStart(),
          name: 'Dana',
          email: 'dana-goods@example.com',
        },
        headers: {
          host: 'shop.example.com',
          'x-forwarded-for': '198.51.100.77',
        },
        socket: { remoteAddress: '198.51.100.77' },
        query: {},
        cookies: {},
      } as any,
      res,
    )
    expect(res.statusCode).toBe(200)
    const params = stripePosts[0].params
    expect([...params.keys()].filter((key) => /tax/i.test(key))).toEqual([])
    expect(params.get('line_items[0][price_data][unit_amount]')).toBe('7500')
  })
})

/**
 * THE MERCHANT'S OWN SERVICE RATE, CHARGED AND RECORDED (AGL-2028).
 *
 * AGL-2000 recorded "do not compute" as an explicit decision. It was honest
 * and it was a holding position, for one reason: the merchant had nowhere to
 * say what they owed. A service business is one of the three named ICPs and
 * in many states their services ARE taxable, so "Aglyn does not compute it"
 * could not stay the permanent answer.
 *
 * What has NOT changed is the reasoning underneath it. The goods `rates[]`
 * table is still not read here — the AGL-2000 block above pins that — and
 * Stripe Tax is still never asked, because it has no service tax code from
 * this handler and would compute against AGLYN's registrations (AGL-1904).
 * What changed is that `tax.service` exists: a flat rate, in the same Taxes
 * card, default off, that the merchant fills in for themselves.
 *
 * These tests assert the MECHANISM — the merchant's number is the one
 * charged, recorded and stamped — and state nothing about who must remit it.
 */
describe('a merchant-set service rate is charged and recorded (AGL-2028)', () => {
  const withService = (rate: Record<string, unknown>) => {
    mockAdmin.__state.store['tax'] = { service: rate }
  }

  /**
   * A BOOKER OF ITS OWN PER TEST, and the reason is not tidiness.
   *
   * `bookHandler` rate-limits per IP over a window. The shared `makeReq`
   * fixture pins one IP, so tests added to this file eventually push the
   * count past the limit and the handler answers 429 — at which point every
   * assertion about a session body is reading an empty `stripePosts` and the
   * failure names the wrong thing entirely. It bit this file once already.
   */
  let booker = 0
  const taxReq = () => {
    booker++
    return {
      method: 'POST',
      body: {
        hostId: 'host-1',
        serviceId: 'service-1',
        startsAtMs: nthBookableStart(booker),
        name: 'Dana',
        email: `dana-tax-${booker}@example.com`,
      },
      headers: {
        host: 'shop.example.com',
        'x-forwarded-for': `192.0.2.${booker}`,
      },
      socket: { remoteAddress: `192.0.2.${booker}` },
      query: {},
      cookies: {},
    } as any
  }

  it('adds the merchant’s rate as its own line on the session', async () => {
    withService({ pct: 6, label: 'State service tax' })
    const res = makeRes()
    await bookHandler(taxReq(), res)
    expect(res.statusCode).toBe(200)
    const params = stripePosts[0].params
    // $75 service, 6% = $4.50 on top.
    expect(params.get('line_items[0][price_data][unit_amount]')).toBe('7500')
    expect(params.get('line_items[1][price_data][unit_amount]')).toBe('450')
    // The merchant's OWN label reaches the client's receipt.
    expect(params.get('line_items[1][price_data][product_data][name]')).toBe(
      'State service tax',
    )
  })

  it('never asks Stripe Tax to compute it', async () => {
    // The line-item construction is the whole point (AGL-1711/AGL-1904): a
    // manual line keeps the tax the MERCHANT's. `automatic_tax` would compute
    // a GOODS rate on an appointment, against Aglyn's registrations.
    withService({ pct: 6 })
    const res = makeRes()
    await bookHandler(taxReq(), res)
    const params = stripePosts[0].params
    expect(params.get('automatic_tax[enabled]')).toBeNull()
    expect(params.get('line_items[0][tax_rates][0]')).toBeNull()
    expect(params.get('line_items[0][price_data][tax_behavior]')).toBeNull()
  })

  it('stamps the figure the tax ledger needs to record it', async () => {
    withService({ pct: 6 })
    const res = makeRes()
    await bookHandler(taxReq(), res)
    const params = stripePosts[0].params
    // Stripe is never told the second line is tax, so the session's own
    // metadata is the only witness — the same reason `checkout.ts` stamps it.
    expect(params.get('metadata[taxCents]')).toBe('450')
    expect(params.get('metadata[taxPct]')).toBe('6')
  })

  it('falls back to a plain label, never to a blank receipt line', async () => {
    withService({ pct: 6 })
    const res = makeRes()
    await bookHandler(taxReq(), res)
    expect(
      stripePosts[0].params.get(
        'line_items[1][price_data][product_data][name]',
      ),
    ).toBe('Service tax')
  })

  it('OFF stays off for a rate that is not a rate', async () => {
    // Zero, negative, non-numeric and a decimal-point typo (`825` for `8.25`)
    // all resolve to no tax rather than to a number the merchant did not
    // choose. Driven through the HANDLER, so this proves the handler emits no
    // line for them rather than only that the resolver returns zero.
    //
    // One booking per iteration with its own booker and IP: `bookHandler`
    // rate-limits per IP and holds the slot it books, so a shared fixture
    // would 429 or 409 and every assertion after the first would be reading
    // an empty `stripePosts`.
    for (const pct of [0, -6, Number.NaN, 825]) {
      stripePosts.length = 0
      withService({ pct })
      const res = makeRes()
      await bookHandler(taxReq(), res)
      expect(res.statusCode).toBe(200)
      expect([...stripePosts[0].params.keys()].filter((key) => /tax/i.test(key)))
        .toEqual([])
    }
  })

  it('keeps the platform take off the tax, and passes the card cost on all of it', async () => {
    // AGL-2317's rule, restated for a path that now carries tax: the take is
    // computed on the SERVICE, never on the state's money, while Stripe's
    // card cost is debited from the platform balance on the WHOLE charge and
    // so must be passed through on the whole charge (AGL-2152).
    withService({ pct: 6 })
    const taxed = makeRes()
    await bookHandler(taxReq(), taxed)
    const feeWithTax = Number(
      stripePosts[0].params.get(
        'payment_intent_data[application_fee_amount]',
      ),
    )

    stripePosts.length = 0
    delete mockAdmin.__state.store['tax']
    const plain = makeRes()
    await bookHandler(taxReq(), plain)
    expect(plain.statusCode).toBe(200)
    const feeWithoutTax = Number(
      stripePosts[0].params.get(
        'payment_intent_data[application_fee_amount]',
      ),
    )

    // Exactly Stripe's own cost on the extra $4.50 and nothing more — no
    // platform take on the state's money. Derived from the real pricing
    // function, so a rate change moves the expectation with it.
    expect(feeWithTax - feeWithoutTax).toBe(
      storefrontProcessingCostCents(7950) - storefrontProcessingCostCents(7500),
    )
    // NEGATIVE CONTROL: the pro plan takes a non-zero cut on a service, so a
    // fee computed on the TAX-INCLUSIVE base is a larger number. Were these
    // equal, the assertion above would be proving nothing.
    expect(feeWithTax).toBe(
      resolveTransactionFeeCents(
        { id: 'org-1', ownerUid: 'owner-1', plan: 'pro' } as never,
        'service',
        7500,
        7950,
      ),
    )
    expect(feeWithTax).toBeLessThan(
      resolveTransactionFeeCents(
        { id: 'org-1', ownerUid: 'owner-1', plan: 'pro' } as never,
        'service',
        7950,
        7950,
      ),
    )
  })
})

describe('a paid booking is created idempotently (AGL-2147)', () => {
  it('sends an Idempotency-Key keyed on the booking', async () => {
    const res = makeRes()
    await bookHandler(makeReq(), res)
    expect(stripePosts).toHaveLength(1)
    const key = stripePosts[0].headers['Idempotency-Key']
    // This was the one session-creating path in the repo without a key.
    // Without it, a retried POST after Stripe created the session but before
    // its response arrived opens a SECOND payable session against one held
    // slot, and a guest who pays both is charged twice for one appointment.
    expect(key).toBeTruthy()
    // Keyed on the booking the transaction just minted, so it names THIS
    // attempt. A constant, or a key derived only from the service and the
    // time, would collide across guests and replay somebody else's session.
    expect(key).toMatch(/^booking-.+/)
    // Uniqueness is structural, and this equality is what makes it so: the
    // transaction mints a fresh `bookingId` per attempt, so a key equal to
    // `booking-${bookingId}` cannot collide across guests. A constant, or a
    // key derived from the service and the start time, WOULD collide — and a
    // colliding key makes the second guest replay the first guest's session,
    // showing them somebody else's checkout. (Asserted as an equality rather
    // than by booking twice: a second booking of the same slot is refused by
    // the overlap check, and the handler rate-limits per IP, so a two-booking
    // test would go green or red for reasons unrelated to the key.)
    expect(String(res.body?.bookingId ?? '')).not.toBe('')
    expect(key).toBe(`booking-${res.body.bookingId}`)
  })

})

/**
 * THE LEAD CARRIES THE NAME THE BOOKER JUST TYPED (AGL-2303).
 *
 * `campaign-send` reads `leads.name` to personalize campaign mail. No lead
 * writer wrote one — here, with the name sitting in `req.body.name` and
 * already going onto the booking — so the leads audience was addressed by
 * nobody's name, and `{{name}}` resolved to an empty string in mail that
 * shipped.
 *
 * Asserted against the VALUE from the request, not against presence: a writer
 * that stored a constant, or the email, passes any "is there a name" check.
 */
describe('a booking records a usable lead (AGL-2303)', () => {
  /**
   * A booker of its own — `makeReq` pins one email and one IP, and the
   * handler's per-booker rate limit answers 429 to the second request from
   * either. A shared fixture here would make these assertions about a booking
   * that was refused.
   */
  const leadReq = (name: string, who: string) =>
    ({
      method: 'POST',
      body: {
        hostId: 'host-1',
        serviceId: 'service-1',
        startsAtMs: nextBookableStart(),
        name,
        email: `${who}@example.com`,
      },
      headers: { host: 'shop.example.com', 'x-forwarded-for': `198.51.100.${who.length}` },
      socket: { remoteAddress: `198.51.100.${who.length}` },
      query: {},
      cookies: {},
    }) as any

  it('writes the booker’s own name onto the lead', async () => {
    const res = makeRes()
    await bookHandler(leadReq('Rae Kowalski', 'rae'), res)
    expect(res.statusCode).toBe(200)
    const leads = mockAdmin.__state.written['leads'] ?? []
    expect(leads).toHaveLength(1)
    // The VALUE off the request. A writer storing a constant — or the email,
    // which is right there — passes any "is there a name" check.
    expect(leads[0]).toMatchObject({
      email: 'rae@example.com',
      name: 'Rae Kowalski',
      source: 'booking',
    })
  })

  it('NEGATIVE CONTROL: a nameless booking never reaches the lead at all', async () => {
    // The handler REQUIRES a name, so the defensive `...(name ? …)` spread at
    // the write is unreachable here — stated rather than left as an untested
    // branch someone later "simplifies" into an empty-string write.
    const res = makeRes()
    await bookHandler(leadReq('', 'anon'), res)
    expect(res.statusCode).toBe(400)
    expect(mockAdmin.__state.written['leads'] ?? []).toHaveLength(0)
  })
})
