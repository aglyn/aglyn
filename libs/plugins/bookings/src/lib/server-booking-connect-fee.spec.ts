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
 * WHO GETS THE MONEY FOR A PAID BOOKING (AGL-2315).
 *
 * The defect this pins was the largest single money defect in the launch
 * audit, and its shape is why an assertion here has to be about the
 * DESTINATION and not merely about a fee existing: the session was opened
 * against a perfectly valid Stripe key, returned a perfectly valid checkout
 * URL, took the guest's card and confirmed the appointment — and settled 100%
 * of the money in Aglyn's own platform balance, because it carried no
 * `transfer_data`, no `application_fee_amount` and no connected account at
 * all. The money went to a right-LOOKING place for the wrong account. Nothing
 * in the product could see it; the booking read `confirmed` either way.
 *
 * So the tests below are written against the two halves separately, because
 * they fail separately:
 *
 *  - **The destination** must be the MERCHANT's connected account, on every
 *    paid booking, at every tier including the tiers whose take rate is zero.
 *    A merchant on Advanced pays Aglyn nothing per booking and must still be
 *    paid — the branch with no fee is exactly the branch where a "the fee is
 *    N%" test proves nothing.
 *  - **The fee**, when there is one, must be the storefront ladder's own
 *    `'service'` rate resolved from the org, in cents, on the items base.
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
  // The REAL resolver, and that is the whole point of this suite (AGL-2315).
  // the decision was that bookings mirror the STOREFRONT ladder rather than
  // take a new rate, so the thing under test is that this handler consults
  // that ladder — a stubbed `() => 3` would assert only that some number
  // reaches Stripe, which is true of a hard-coded rate too and is precisely
  // the outcome the decision rejected.
  //
  // Required from the source module rather than through `requireActual` on the
  // whole `/server` barrel, which drags in the realm server and the API
  // adapter (the `apply-publish-schedule.spec.ts` pattern).
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
  // Every server door captures through `captureHostContact` (AGL-2605), which
  // is `upsertHostContact` plus the contactCreated announcement. The stub
  // hands the call to whichever double this spec keeps for the writer — the
  // runtime mock's own, or the data-admin mock's when the spec doubles the
  // data layer instead — so assertions on its options read the same calls.
  captureHostContact: (...args: unknown[]) => {
    const runtime = jest.requireMock('@aglyn/tenant-runtime') as {
      upsertHostContact?: (...a: unknown[]) => unknown
    }
    const dataAdmin = jest.requireMock('@aglyn/tenant-data-admin') as {
      upsertHostContact?: (...a: unknown[]) => unknown
    }
    return (runtime.upsertHostContact ?? dataAdmin.upsertHostContact)?.(...args)
  },
  // Returns `{ alerts }`, which the FREE-booking branch destructures. A double
  // answering `undefined` throws there, and the resulting 500 reads as a money
  // bug in a test about a $0 service — an unfaithful fake fabricating a false
  // red exactly as readily as a false green.
  emitHostEvent: async () => ({ alerts: [] }),
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
  // REAL `computeOpenSlots` still picks the instant used below — stubbing the
  // slot logic would let a money assertion pass against a booking that never
  // happened.
  const serviceDoc: Record<string, unknown> = {
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
  const state = {
    service: serviceDoc,
    bookings,
    /**
     * The MERCHANT's connected account, deliberately not resembling the
     * platform's. Every destination assertion below names this value, so a
     * handler that shipped the platform account — the actual defect — cannot
     * satisfy it by shipping something merely account-shaped.
     */
    ownerProfile: {
      stripeAccountId: 'acct_merchant_1',
      stripeChargesEnabled: true,
    } as Record<string, unknown>,
    org: { id: 'org-1', ownerUid: 'owner-1', plan: 'starter' } as Record<
      string,
      unknown
    >,
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
    // A `pendingPayment` hold that the handler rolls back names its own doc,
    // so the double has to accept the write rather than discard it — the
    // stranded-slot assertion reads it back.
    set: async () => undefined,
  }
  const hostRef = {
    get: async () => ({ exists: true, get: () => undefined }),
    collection: (name: string) =>
      name === 'bookings' || name === 'events' || name === 'notifications'
        ? bookingsCollection
        : {
            add: async (data: Record<string, unknown>) => {
              const written = state.written[name] ?? (state.written[name] = [])
              written.push(data)
              return { id: `${name}-${++autoId}` }
            },
            doc: () => ({
              get: async () => ({
                exists: true,
                data: () => state.service,
                get: (field: string) => state.service[field],
              }),
            }),
          },
  }
  // Top-level collections resolve BY NAME. `profiles` is where the merchant's
  // connected account lives, and a double that answered the same object for
  // every collection could not tell a handler reading the right document from
  // one reading the wrong one.
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
    // The attribution seam the handler resolves once per booking. Recorded
    // as nothing — `campaign-conversion-attribution.spec.ts` owns the write —
    // and defined here at all because a mocked module answers `undefined` for
    // a name it does not list, which would make the handler throw rather than
    // fail an assertion.
    resolveCampaignTouch: async () => null,
    attributeCampaignConversion: async () => null,
    getPluginConfig: async () => ({}),
    renderHostEmailWithTokens: (value: string) => value,
    // Both booking paths now write their lead through the ONE bounded writer
    // (AGL-1529) instead of `hostRef.collection('leads').add(…)`. Recorded
    // into the same `written['leads']` the direct write landed in, so the
    // AGL-2303 payload assertions keep reading the thing that was stored —
    // a double that answered `true` and forgot the payload could not fail on
    // a lead with no name on it, which is the bug those assertions exist for.
    addHostLead: async (options: { lead: Record<string, unknown> }) => {
      const written = state.written['leads'] ?? (state.written['leads'] = [])
      written.push({ ...options.lead, createdAt: 'NOW' })
      return true
    },
  }
})

import { bookHandler } from './server'
import { computeOpenSlots } from './model'
import {
  resolveTransactionFeePct,
  storefrontProcessingCostCents,
} from '@aglyn/aglyn/server'

const mockAdmin = jest.requireMock('@aglyn/tenant-data-admin') as {
  __state: {
    service: Record<string, unknown>
    org: Record<string, unknown>
    ownerProfile: Record<string, unknown>
    bookings: Map<string, Record<string, unknown>>
  }
}

/**
 * A real bookable instant, from the real slot generator — never a hand-picked
 * timestamp that happens to line up today and stops lining up tomorrow. A new
 * one per request, so consecutive bookings in one test do not collide.
 */
function nextBookableStart(offsetDays = 3): number {
  const from = Date.now() + offsetDays * 24 * 60 * 60_000
  const slots = computeOpenSlots(
    mockAdmin.__state.service as never,
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

let ipCounter = 0
const makeReq = (overrides: Record<string, unknown> = {}) => {
  // A fresh IP per request: the handler rate-limits 5 bookings per minute per
  // IP, and a suite that walked the whole plan ladder from one address would
  // start getting 429s partway down and read as a fee bug.
  const ip = `203.0.113.${(ipCounter++ % 200) + 1}`
  return {
    method: 'POST',
    body: {
      hostId: 'host-1',
      serviceId: 'service-1',
      startsAtMs: nextBookableStart(),
      ...overrides,
      name: 'Dana',
      email: 'dana@example.com',
    },
    headers: { host: 'shop.example.com', 'x-forwarded-for': ip },
    socket: { remoteAddress: ip },
    query: {},
    cookies: {},
  } as any
}

const originalFetch = global.fetch
const ORIGINAL_KEY = process.env.STRIPE_SECRET_KEY

beforeAll(() => {
  global.fetch = jest.fn(async (url: any, init?: any) => {
    const address = String(url)
    if (address === 'https://api.stripe.com/v1/checkout/sessions') {
      stripePosts.push({
        url: address,
        params: new URLSearchParams(String(init?.body ?? '')),
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
  mockAdmin.__state.bookings.clear()
  mockAdmin.__state.service['priceUsd'] = 75
  mockAdmin.__state.org = {
    id: 'org-1',
    ownerUid: 'owner-1',
    plan: 'starter',
  }
  mockAdmin.__state.ownerProfile = {
    stripeAccountId: 'acct_merchant_1',
    stripeChargesEnabled: true,
  }
})

/** Books once and returns the single Stripe session POST's params. */
async function book(): Promise<URLSearchParams> {
  const res = makeRes()
  await bookHandler(makeReq(), res)
  expect(res.statusCode).toBe(200)
  expect(stripePosts).toHaveLength(1)
  return stripePosts[0].params
}

describe('a paid booking pays the MERCHANT (AGL-2315)', () => {
  it('sends a destination charge to the merchant’s connected account', async () => {
    const params = await book()
    // The defect: this key was absent entirely, so the charge settled on the
    // platform. Asserting the exact account matters as much as asserting the
    // key — `reserve.ts` reads the same `profiles/{ownerUid}.stripeAccountId`,
    // and a handler that read the wrong document would still send SOME
    // account-shaped string.
    expect(
      params.get('payment_intent_data[transfer_data][destination]'),
    ).toBe('acct_merchant_1')
  })

  it('never charges to the platform account by omission', async () => {
    const params = await book()
    // The negative half, stated so a future refactor that drops the wiring
    // fails HERE rather than in production. An absent destination is not a
    // neutral default: it means Aglyn keeps the money.
    expect(
      params.has('payment_intent_data[transfer_data][destination]'),
    ).toBe(true)
    expect(
      params.get('payment_intent_data[transfer_data][destination]'),
    ).not.toBe('')
  })

  it('refuses before holding the slot when the merchant is not connected', async () => {
    mockAdmin.__state.ownerProfile = {}
    const res = makeRes()
    await bookHandler(makeReq(), res)
    expect(res.statusCode).toBe(409)
    // No session, because there is nowhere for the money to go...
    expect(stripePosts).toHaveLength(0)
    // ...and no HOLD either. Discovering this after the transaction would
    // strand a real appointment slot as `pendingPayment` for fifteen minutes
    // on a booking that could never be paid.
    expect(mockAdmin.__state.bookings.size).toBe(0)
  })

  it('refuses when the account exists but charges are not enabled', async () => {
    // A merchant mid-onboarding has an `acct_` id and cannot yet be paid.
    // Reading only the id would open a session whose transfer Stripe refuses
    // at capture, after the guest's card is charged.
    mockAdmin.__state.ownerProfile = {
      stripeAccountId: 'acct_merchant_1',
      stripeChargesEnabled: false,
    }
    const res = makeRes()
    await bookHandler(makeReq(), res)
    expect(res.statusCode).toBe(409)
    expect(stripePosts).toHaveLength(0)
  })

  it('leaves a FREE booking on its own path, needing no connected account', async () => {
    // A $0 service takes no card, so it must not be gated on Stripe onboarding
    // — a guard written above the `paid` branch would break every free site.
    mockAdmin.__state.service['priceUsd'] = 0
    mockAdmin.__state.ownerProfile = {}
    const res = makeRes()
    await bookHandler(makeReq(), res)
    expect(res.statusCode).toBe(200)
    expect(stripePosts).toHaveLength(0)
  })
})

describe('the take rate is the storefront ladder’s (AGL-2315)', () => {
  /**
   * the decision, 2026-08-19: bookings mirror the storefront ladder — the
   * same 5%→0%-by-tier rate a storefront sale already takes. The table below
   * is the ladder's `'service'` axis read off `PLAN_ENTITLEMENTS`, written out
   * as MONEY on a $75 massage so the suite fails on a rate change rather than
   * merely re-deriving whatever the code does.
   *
   * Both halves are asserted per tier, and they are different failures:
   * `feeCents` pins the arithmetic, and the second expectation pins it to the
   * RESOLVER, so neither a drifted table nor a hard-coded 5% can pass.
   */
  const LADDER: Array<[string, number | null]> = [
    ['starter', 375], // 5% of $75.00
    ['pro', 225], // 3%
    ['business', 150], // 2%
    ['scale', 75], // 1%
    ['advanced', null], // 0% — no fee at all
    ['agency', null], // 0%
    ['enterprise', null], // 0%
  ]

  it.each(LADDER)(
    'charges the %s tier’s service rate and still pays the merchant',
    async (plan, expectedFeeCents) => {
      mockAdmin.__state.org = {
        id: 'org-1',
        ownerUid: 'owner-1',
        plan,
      }
      const params = await book()

      // THE MERCHANT IS PAID AT EVERY TIER. This is the assertion the
      // fee-shaped tests cannot make: on Advanced, Agency and Enterprise the
      // take rate is zero, and a wiring that only attached `transfer_data`
      // when there was a fee to take would pay nobody on exactly the tiers
      // that pay Aglyn the most in subscription. Two payment paths have
      // already shipped that bug here.
      expect(
        params.get('payment_intent_data[transfer_data][destination]'),
      ).toBe('acct_merchant_1')

      // THE TAKE, isolated from the card cost. Since AGL-2152 the fee is the
      // ladder's take PLUS Stripe's processing on the same charge, because a
      // destination charge debits that processing from the PLATFORM's balance
      // and a take-only fee made every paid booking on a 0% tier a loss. The
      // table below is still about the TAKE, so the cost is subtracted back
      // out rather than folded into the expected figures.
      const sent = Number(
        params.get('payment_intent_data[application_fee_amount]'),
      )
      const takeSent = sent - storefrontProcessingCostCents(7500)
      // Always emitted now: even a 0% tier owes Stripe for the charge, so
      // there is always a real amount to send.
      expect(params.has('payment_intent_data[application_fee_amount]')).toBe(
        true,
      )
      expect(takeSent).toBe(expectedFeeCents ?? 0)
      // Recorded on the session too — the figure a refund reverses.
      expect(params.get('metadata[feeCents]')).toBe(String(sent))

      // Tied to the resolver itself, so the table above cannot silently drift
      // away from the ladder the storefront charges.
      const pct = resolveTransactionFeePct(
        { plan } as never,
        'service',
      )
      expect(pct > 0 ? Math.round((7500 * pct) / 100) : null).toBe(
        expectedFeeCents,
      )
    },
  )

  it('reuses the storefront resolver rather than a bookings rate', async () => {
    // The decision was explicitly "route through the existing resolution", so
    // a booking's fee must equal a storefront SERVICE sale's fee for the same
    // org, tier for tier. If someone later introduces a bookings-specific
    // constant, this is where the two stop agreeing.
    for (const plan of ['starter', 'pro', 'business', 'scale']) {
      mockAdmin.__state.org = { id: 'org-1', ownerUid: 'owner-1', plan }
      const params = await book()
      const storefrontPct = resolveTransactionFeePct({ plan } as never, 'service')
      expect(params.get('payment_intent_data[application_fee_amount]')).toBe(
        String(
          Math.max(1, Math.round((7500 * storefrontPct) / 100)) +
            storefrontProcessingCostCents(7500),
        ),
      )
      stripePosts.length = 0
    }
  })

  it('floors a sub-cent fee at one cent instead of dropping it', async () => {
    // 1% of a 60¢ service is 0.6¢. `Math.round` alone on the old per-line
    // arithmetic yielded 0 at these sizes, which the `feeCents > 0` guard then
    // read as "this tier takes nothing" — the fee silently skipped on a tier
    // that advertises one. Two payment paths in this repo have dropped a fee
    // exactly this way. 60¢ rather than 10¢ because Stripe will not process a
    // charge under 50¢, and the clamp asserted below owns that case.
    mockAdmin.__state.service['priceUsd'] = 0.6
    mockAdmin.__state.org = { id: 'org-1', ownerUid: 'owner-1', plan: 'scale' }
    const params = await book()
    expect(params.get('payment_intent_data[application_fee_amount]')).toBe(
      String(1 + storefrontProcessingCostCents(60)),
    )
    expect(
      params.get('payment_intent_data[transfer_data][destination]'),
    ).toBe('acct_merchant_1')
  })

  /**
   * THE CLAMP (AGL-2152). Stripe rejects an application fee larger than the
   * charge, and on a charge small enough the recovered card cost alone exceeds
   * it — so the fee is capped at the charge. That can only happen below
   * Stripe's own 50¢ charge minimum, i.e. on a charge Stripe would refuse
   * anyway; asserted so the cap is a known boundary rather than a 400 in
   * production.
   */
  it('never asks Stripe for a fee larger than the charge', async () => {
    mockAdmin.__state.service['priceUsd'] = 0.1
    mockAdmin.__state.org = { id: 'org-1', ownerUid: 'owner-1', plan: 'scale' }
    const params = await book()
    expect(params.get('payment_intent_data[application_fee_amount]')).toBe('10')
    expect(params.get('line_items[0][price_data][unit_amount]')).toBe('10')
  })

  it('prices a MALFORMED fee override from the plan, never at zero', async () => {
    // AGL-2114's floor, inherited for free by routing through the shared
    // resolver — and asserted here because "inherited for free" is a claim
    // about a call site, not about this handler. A hand-written or
    // partially-written org doc must not zero the platform's cut.
    mockAdmin.__state.org = {
      id: 'org-1',
      ownerUid: 'owner-1',
      plan: 'starter',
      entitlements: { transactionFeeDigitalPct: Number.NaN },
    }
    const params = await book()
    expect(params.get('payment_intent_data[application_fee_amount]')).toBe(
      String(375 + storefrontProcessingCostCents(7500)),
    )
  })

  it('honours a negotiated per-org override', async () => {
    mockAdmin.__state.org = {
      id: 'org-1',
      ownerUid: 'owner-1',
      plan: 'starter',
      entitlements: { transactionFeeDigitalPct: 1 },
    }
    const params = await book()
    expect(params.get('payment_intent_data[application_fee_amount]')).toBe(
      String(75 + storefrontProcessingCostCents(7500)),
    )
  })
})

describe('the fee BASIS is items-only (AGL-2317)', () => {
  it('sends a cents amount, never application_fee_percent', async () => {
    const params = await book()
    // AGL-2317: `application_fee_percent` is a percentage of the WHOLE
    // invoice, so it takes a cut of sales tax and shipping — money that is the
    // state's or the carrier's. The one-time storefront paths all send a
    // computed cents amount on post-discount items, and this path joins that
    // side deliberately.
    //
    // Today the two bases coincide, because a booking session carries one line
    // item and, by AGL-2000's stated decision, no tax line and no shipping.
    // That coincidence is not what makes this right — sending CENTS derived
    // from the service price is what keeps the basis correct on the day this
    // path does compute service tax. A percent would start taxing the state's
    // money the moment a tax line appeared, with no code change and no test
    // going red.
    expect(params.has('subscription_data[application_fee_percent]')).toBe(false)
    expect(params.has('application_fee_percent')).toBe(false)
    expect(params.get('payment_intent_data[application_fee_amount]')).toBe(
      String(375 + storefrontProcessingCostCents(7500)),
    )
  })

  it('computes the fee on the line item, matching the charged amount', async () => {
    const params = await book()
    const unitAmount = Number(
      params.get('line_items[0][price_data][unit_amount]'),
    )
    const fee = Number(params.get('payment_intent_data[application_fee_amount]'))
    expect(unitAmount).toBe(7500)
    // 5% of the item base and nothing else in the base, plus Stripe's cost on
    // the same charge (AGL-2152). Written as a relationship rather than a
    // literal so that a change to the fixture price cannot make this pass
    // vacuously — and the TAKE half is isolated, which is the basis claim.
    expect(fee - storefrontProcessingCostCents(unitAmount)).toBe(
      Math.round(unitAmount * 0.05),
    )
  })

  it('still carries no tax line, so the basis question stays honest', async () => {
    const params = await book()
    // AGL-2000's decision, re-asserted from the fee's side: if a tax line ever
    // appears here, the items-only claim above needs re-deriving rather than
    // re-reading, and this test is what forces that.
    expect(params.has('automatic_tax[enabled]')).toBe(false)
    expect(params.has('line_items[0][tax_rates][0]')).toBe(false)
    expect(params.has('line_items[1][price_data][unit_amount]')).toBe(false)
  })
})

/**
 * The guest's return URL has to name the transaction (AGL-2481).
 *
 * `success_url` was `/?booking=paid` — the word "paid" and nothing else — so
 * the merchant-side GA4 `purchase` had no id to look the booking up by and
 * could not have stated what was actually charged. That is the same reason
 * Aglyn's own revenue is reported server-side rather than from a return page
 * (docs/ANALYTICS.md decision 1), and the fix here is to make the URL carry
 * the id rather than to give up on the client event.
 *
 * Asserted in this file because the checkout POST is already captured here and
 * nothing else in the suite looked at `success_url` at all.
 */
describe('the return URL names the checkout session (AGL-2481)', () => {
  it('carries Stripe’s session-id template token', async () => {
    const params = await book()

    // Stripe substitutes `{CHECKOUT_SESSION_ID}` on the redirect. A literal
    // session id cannot be used: it does not exist until this POST returns.
    expect(params.get('success_url')).toContain(
      'session_id={CHECKOUT_SESSION_ID}',
    )
  })

  it('keeps the `booking=paid` flag the widget already switches on', async () => {
    const params = await book()

    // The success panel and `useBookingPurchaseEvent` both gate on this, so
    // replacing it rather than extending it would silently blank the
    // confirmation the guest sees.
    expect(params.get('success_url')).toContain('booking=paid')
  })

  it('leaves the cancel URL alone — nothing was bought to report', async () => {
    const params = await book()

    expect(params.get('cancel_url')).not.toContain('session_id')
  })
})
