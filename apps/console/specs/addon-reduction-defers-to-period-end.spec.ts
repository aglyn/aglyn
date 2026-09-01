/**
 * @jest-environment node
 *
 * Pragma must stay in the FIRST block comment — behind the license header it is
 * silently ignored and the suite runs on jsdom.
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
 * Reducing an add-on takes effect at the PERIOD END, not today.
 *
 * The two directions of an add-on change are not symmetric, and treating them
 * alike was wrong in both. An INCREASE is capacity the customer is asking for
 * now, so it is applied and invoiced now. A DECREASE is capacity they have
 * already paid to hold until the period they paid for ends — so it moves at
 * the renewal, nothing is charged, and NOTHING IS CREDITED. Crediting unused
 * time for a dataset somebody can still read for three more weeks is paying
 * them back for something they have not stopped having; deferring the
 * reduction and crediting nothing are two halves of one decision, and either
 * one alone is incoherent.
 *
 * The mechanism is a subscription schedule whose TARGET phase carries the
 * smaller quantity. Three properties make that mechanism safe, and each is
 * asserted below rather than assumed:
 *
 *   - a phase is an ABSOLUTE item list, so anything not written back is
 *     DELETED at the flip — an item this route cannot classify included;
 *   - `proration_behavior: 'none'`, because the phase boundary is a clean
 *     period start and there is no partial period to price;
 *   - one future, not two. A schedule that already carries a pending phase is
 *     EDITED; appending a second would extend the subscription by a period.
 *
 * The QUOTE has to describe the same thing. `invoices/upcoming` under
 * `always_invoice` returns the credit a reduction would raise IF it applied
 * today, and it does not apply today — so pricing one at all produces a number
 * describing a refund nobody will receive. A reduction is therefore answered
 * without asking Stripe to price it, which is why the assertion below is that
 * the call never happens rather than that its answer was zero.
 *
 * And the response has to say so. `pendingAddonChange` is the only thing that
 * tells the console a change is in flight, and `quantities` deliberately
 * reports the CURRENT map — what the workspace may use until the period ends
 * is what it has now. `seatAddons` is not written at all: it mirrors what the
 * subscription is carrying, and the subscription is still carrying the old
 * quantity. Writing the smaller number today would tell every entitlement
 * check the capacity was already gone, which is the opposite of the promise
 * just made to the customer.
 *
 * NO STRIPE PATH IS EXERCISED. `fetch` is mocked and never calls out;
 * localhost carries the LIVE key.
 */

export {}

const ORG_ID = 'org-1'

/** The renewal a reduction lands on — 2026-01-01T00:00:00.000Z. */
const PERIOD_END = 1767225600
const PERIOD_START = PERIOD_END - 2592000

/** The org document — its `plan` decides which prices the route sells. */
let orgDoc: any
/** The base plan item on the subscription. */
let planItem: any
/** The dataset add-on item on the subscription. */
let datasetItem: any
/**
 * A price the route cannot classify — a legacy add-on whose env var was
 * rotated, or a line attached by hand in the Stripe dashboard. It is recurring
 * revenue that no phase builder recognises, which is exactly why it has to
 * survive being restated.
 */
let unknownItem: any
/** `subscription.schedule`: null means the route has to create one. */
let scheduleOnSubscription: string | null
/** What `GET subscription_schedules/{id}` answers, when there is one. */
let existingSchedule: any
/** What `POST subscription_schedules` answers on the create path. */
let createdSchedule: any

/** Every Stripe request the route made, in order. */
let stripeCalls: Array<{ href: string; method: string; body: string }> = []
/** Everything written to `org.seatAddons`. */
let orgMirrorWrites: any[] = []
/**
 * `subscription.current_period_end`. `null` omits the field, which is the
 * shape a quote has to survive rather than invent a date for.
 */
let periodEnd: number | null

const orgRef = {
  get: async () => ({
    data: () => orgDoc,
    ref: {
      set: async (value: unknown) => {
        orgMirrorWrites.push(value)
      },
    },
  }),
  // `orgs/{id}/datasets` — the aggregation the capacity gate reads. An org
  // holding nothing is never refused by it, so every case below reaches the
  // deferral rather than stopping at a 409 that would pass for the wrong
  // reason.
  collection: () => ({
    count: () => ({ get: async () => ({ data: () => ({ count: 0 }) }) }),
    where: () => ({ get: async () => ({ docs: [] }) }),
  }),
}

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  firebaseAdmin: {
    app: () => ({
      auth: () => ({
        verifyIdToken: async () => ({ uid: 'user-1', email_verified: true }),
      }),
      firestore: () => ({ collection: () => ({ doc: () => orgRef }) }),
    }),
  },
  emailUnverifiedResponse: () =>
    Response.json({ error: 'Email unverified' }, { status: 403 }),
  isImpersonationSession: () => false,
  memberHasOrgPermission: async () => true,
  readOrgBilling: async () => ({ stripeCustomerId: 'cus_test_1' }),
  resolveOrgMembership: async () => ({ member: { role: 'owner' } }),
  isServerReleaseFlagOnForOrg: async () => true,
  listOrgMembers: async () => [],
}))

jest.mock('@aglyn/aglyn/server', () => ({
  __esModule: true,
  isLiveSubscriptionStatus: jest.requireActual(
    '@aglyn/aglyn/app-utils/org-billing-doc',
  ).isLiveSubscriptionStatus,
  // The REAL plan model. A stubbed resolver answers zero for every ceiling, so
  // every reduction here would be refused at the purchase-ceiling check
  // instead and never reach the schedule at all. Starter includes 3 datasets
  // of a 10 maximum, so 0..7 is purchasable and 4 is a legal holding.
  ...jest.requireActual('../../../libs/aglyn/src/lib/app-utils/plan-entitlements'),
  pluginRequestFromWeb: async (request: Request) => ({
    method: request.method,
    query: {},
    body: await request.json().catch(() => ({})),
    headers: { authorization: request.headers.get('authorization') ?? undefined },
  }),
}))

/** Env without a trace of the developer's own Stripe config (`nx test` leaks the root env). */
const CLEAN_ENV = (() => {
  const clean = { ...process.env }
  for (const key of Object.keys(clean)) {
    if (key.startsWith('STRIPE_') || key.startsWith('NEXT_PUBLIC_STRIPE_')) {
      delete clean[key]
    }
  }
  return clean
})()

const ORIGINAL_ENV = process.env
const ORIGINAL_FETCH = global.fetch

const STRIPE_ENV = {
  STRIPE_SECRET_KEY: 'sk_test_fake',
  STRIPE_PRICE_STARTER: 'price_starter_monthly',
  STRIPE_PRICE_PRO: 'price_pro_monthly',
  STRIPE_PRICE_METERED: 'price_metered_usage',
  STRIPE_PRICE_STARTER_EXTRA_DATASET: 'price_starter_dataset',
  STRIPE_PRICE_PRO_EXTRA_DATASET: 'price_pro_dataset',
}

function loadAddons() {
  jest.resetModules()
  process.env = { ...CLEAN_ENV, ...STRIPE_ENV } as NodeJS.ProcessEnv
  return require('../app/api/billing/addons/route').POST as (
    request: Request,
  ) => Promise<Response>
}

function call(body: Record<string, unknown>) {
  return loadAddons()(
    new Request('https://app.aglyn.com/api/billing/addons', {
      method: 'POST',
      headers: {
        authorization: 'Bearer tok',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ orgId: ORG_ID, ...body }),
    }),
  )
}

/** Set the dataset add-on to `quantity`. */
function setDatasets(quantity: number) {
  return call({ action: 'set', kind: 'datasets', quantity })
}

/** The subscription's items, in the order Stripe reports them. */
function liveItems() {
  return [
    planItem,
    ...(datasetItem ? [datasetItem] : []),
    ...(unknownItem ? [unknownItem] : []),
    {
      id: 'si_metered',
      price: { id: 'price_metered_usage', recurring: { interval: 'month' } },
    },
  ]
}

/** Those same items in the shape a schedule phase reports them. */
function livePhaseItems() {
  return liveItems().map((item) => ({
    price: item.price.id,
    ...(item.quantity == null ? {} : { quantity: item.quantity }),
  }))
}

function stripeCall(method: string, fragment: string) {
  return stripeCalls.find(
    (entry) => entry.method === method && entry.href.includes(fragment),
  )
}

/** The captured body of the one `POST subscriptions/{id}`, if any. */
function subscriptionUpdate(): URLSearchParams | null {
  const entry = stripeCall('POST', '/subscriptions/sub_1')
  return entry ? new URLSearchParams(entry.body) : null
}

/** The captured body of the one `POST subscription_schedules/{id}`. */
function scheduleUpdate(): URLSearchParams | null {
  const entry = stripeCall('POST', '/subscription_schedules/')
  return entry ? new URLSearchParams(entry.body) : null
}

/** The price ids a phase was written with, in order; empty when unwritten. */
function phasePrices(index: number): string[] {
  const body = scheduleUpdate()
  const prices: string[] = []
  for (let i = 0; ; i += 1) {
    const price = body?.get(`phases[${index}][items][${i}][price]`)
    if (!price) return prices
    prices.push(price)
  }
}

/** A phase's quantity for one price; null when the phase has no such line. */
function phaseQuantity(index: number, price: string): string | null {
  const at = phasePrices(index).indexOf(price)
  if (at < 0) return null
  return scheduleUpdate()?.get(`phases[${index}][items][${at}][quantity]`) ?? null
}

/** How many phases the update wrote — the count that must stay at two. */
function writtenPhaseCount(): number {
  let count = 0
  while (phasePrices(count).length > 0) count += 1
  return count
}

beforeEach(() => {
  stripeCalls = []
  orgMirrorWrites = []
  orgDoc = { plan: 'starter', seatAddons: { datasets: 4 } }
  periodEnd = PERIOD_END
  planItem = {
    id: 'si_plan',
    quantity: 1,
    price: { id: 'price_starter_monthly', recurring: { interval: 'month' } },
  }
  datasetItem = {
    id: 'si_dataset',
    quantity: 4,
    price: { id: 'price_starter_dataset', recurring: { interval: 'month' } },
  }
  unknownItem = {
    id: 'si_legacy',
    quantity: 2,
    price: { id: 'price_legacy_negotiated', recurring: { interval: 'month' } },
  }
  scheduleOnSubscription = null
  createdSchedule = {
    id: 'sub_sched_1',
    status: 'not_started',
    end_behavior: 'release',
    // `from_subscription` produces exactly ONE phase: the present.
    phases: [
      {
        start_date: PERIOD_START,
        end_date: PERIOD_END,
        items: livePhaseItems(),
        automatic_tax: { enabled: true },
      },
    ],
  }
  // A schedule that already carries a pending plan change. Its future phase is
  // the one a reduction has to edit.
  existingSchedule = {
    id: 'sub_sched_9',
    status: 'active',
    end_behavior: 'release',
    phases: [
      {
        start_date: PERIOD_START,
        end_date: PERIOD_END,
        items: livePhaseItems(),
        discounts: [{ coupon: { id: 'coupon_winback_1' } }],
        automatic_tax: { enabled: true },
      },
      {
        start_date: PERIOD_END,
        items: livePhaseItems(),
        metadata: { plan: 'starter', orgId: ORG_ID },
        automatic_tax: { enabled: true },
      },
    ],
  }
  global.fetch = jest.fn(async (url: unknown, init: any) => {
    const href = String(url)
    const method = String(init?.method ?? 'GET')
    stripeCalls.push({ href, method, body: String(init?.body ?? '') })
    let payload: unknown
    if (href.includes('/subscriptions?customer=')) {
      payload = {
        data: [
          {
            id: 'sub_1',
            status: 'active',
            currency: 'usd',
            ...(periodEnd ? { current_period_end: periodEnd } : {}),
            metadata: { plan: orgDoc.plan, orgId: ORG_ID },
            ...(scheduleOnSubscription
              ? { schedule: scheduleOnSubscription }
              : {}),
            items: { data: liveItems() },
          },
        ],
      }
    } else if (href.includes('/subscription_schedules/')) {
      // GET reads the schedule; POST updates it. Both answer with the doc —
      // only the update's request body is under test.
      payload = scheduleOnSubscription ? existingSchedule : createdSchedule
    } else if (href.includes('/subscription_schedules')) {
      payload = createdSchedule
    } else if (href.includes('/invoices/upcoming')) {
      // A real proration for two more datasets: $6.00 of remaining time plus
      // $0.46 of tax. Non-zero on purpose — a quote that answered zero here
      // could not tell "priced at zero" from "never priced".
      payload = {
        amount_due: 646,
        tax: 46,
        currency: 'usd',
        automatic_tax: { status: 'complete' },
        lines: { data: [{ proration: true, amount: 600 }] },
      }
    } else if (href.includes('/subscriptions/sub_1')) {
      payload = { id: 'sub_1', status: 'active', items: { data: liveItems() } }
    } else {
      throw new Error(`unexpected fetch: ${href}`)
    }
    return { ok: true, json: async () => payload }
  }) as never
})

afterEach(() => {
  process.env = ORIGINAL_ENV
  global.fetch = ORIGINAL_FETCH
  jest.restoreAllMocks()
})

describe('a reduction charges nothing and credits nothing today', () => {
  it('never updates the subscription, so no proration is ever raised', async () => {
    // `subscriptions/{id}` is the only call on this route that can move money.
    // Not calling it is the whole guarantee — under `always_invoice` a
    // reduction would raise a credit note for time the customer has not
    // finished using.
    const response = await setDatasets(1)
    expect(response.status).toBe(200)
    expect(subscriptionUpdate()).toBeNull()
  })

  it('writes the schedule with proration_behavior none', async () => {
    // The phase boundary is a clean period start, so there is no partial
    // period on either side of it for Stripe to price.
    await setDatasets(1)
    expect(scheduleUpdate()?.get('proration_behavior')).toBe('none')
  })

  it('reports no charge, because there is no charge to report', async () => {
    // An increase answers with `chargedNowCents`/`chargePaid` and the card is
    // debited. A reduction that carried those fields would be describing a
    // payment that did not happen.
    const payload = await (await setDatasets(1)).json()
    expect(payload.ok).toBe(true)
    expect(payload.chargePaid).toBeUndefined()
    expect(payload.chargedNowCents).toBeUndefined()
    expect(payload.chargeRequiresAction).toBeUndefined()
  })
})

describe('what the response tells the console', () => {
  it('names the pending change: kind, quantity, when, and which schedule', async () => {
    const payload = await (await setDatasets(1)).json()
    expect(payload.pendingAddonChange).toEqual({
      kind: 'datasets',
      quantity: 1,
      effectiveAt: '2026-01-01T00:00:00.000Z',
      scheduleId: 'sub_sched_1',
    })
  })

  it('answers with the CURRENT quantities, not the reduced ones', async () => {
    // The map is what the workspace may USE, and it may use four datasets
    // until the period ends. Answering 1 here would have the card show the
    // capacity as already gone while the subscription still bills for it.
    const payload = await (await setDatasets(1)).json()
    expect(payload.quantities.datasets).toBe(4)
  })

  it('a removal answers with the item still present at its old quantity', async () => {
    const payload = await (await setDatasets(0)).json()
    expect(payload.pendingAddonChange).toMatchObject({ quantity: 0 })
    expect(payload.quantities.datasets).toBe(4)
  })

  it('writes no seatAddons mirror', async () => {
    // `seatAddons` is an ENTITLEMENT INPUT — `resolveOrgEntitlements` reads it
    // to raise the dataset ceiling. Mirroring the smaller number today would
    // revoke the capacity at the moment the customer was told it would run to
    // the period end. The webhook rewrites it when the phase flips.
    await setDatasets(1)
    expect(orgMirrorWrites).toEqual([])
  })
})

describe('a reduction is QUOTED as deferred, not priced', () => {
  const previewDatasets = (quantity: number) =>
    call({ action: 'preview', kind: 'datasets', quantity })

  it('never asks Stripe to price it at all', async () => {
    // THE CONTRACT. `invoices/upcoming` under `always_invoice` answers with
    // the credit a reduction WOULD raise if it still applied today — a refund
    // for time the customer has not finished using and will not be given
    // back. Asserting only that the quote reads zero would pass on a route
    // that priced the change and threw the answer away, which leaves the
    // wrong figure one refactor from the screen again.
    await previewDatasets(1)
    expect(
      stripeCalls.some((entry) => entry.href.includes('/invoices/upcoming')),
    ).toBe(false)
  })

  it('quotes zero on every money field, and says why', async () => {
    // Every field a priced quote carries, so the caller reads one shape
    // whichever branch answered — and `defersToPeriodEnd` is the one thing
    // that distinguishes "costs nothing" from "costs nothing YET".
    const payload = await (await previewDatasets(1)).json()
    expect(payload).toMatchObject({
      amountDueCents: 0,
      prorationCents: 0,
      taxCents: 0,
      chargedNowCents: 0,
      currency: 'usd',
      defersToPeriodEnd: true,
    })
    // Nothing is being taxed, so tax resolution is not pending on anything.
    // `false` would put the card into its "we could not work out tax yet"
    // caveat about an amount that is zero.
    expect(payload.taxComplete).toBe(true)
  })

  it('names the date the change lands', async () => {
    // The confirm says the capacity ends on this date; it is the only part of
    // the quote that carries information at all.
    const payload = await (await previewDatasets(1)).json()
    expect(payload.effectiveAt).toBe('2026-01-01T00:00:00.000Z')
  })

  it('and answers null when the subscription has no period end', async () => {
    // A missing period end is a date nobody can state. Null says so; a
    // fabricated or epoch-zero date would have the card promise a day.
    periodEnd = null
    const payload = await (await previewDatasets(1)).json()
    expect(payload.effectiveAt).toBeNull()
    expect(payload.defersToPeriodEnd).toBe(true)
  })

  it('a removal is quoted the same way', async () => {
    const payload = await (await previewDatasets(0)).json()
    expect(payload.defersToPeriodEnd).toBe(true)
    expect(payload.chargedNowCents).toBe(0)
    expect(
      stripeCalls.some((entry) => entry.href.includes('/invoices/upcoming')),
    ).toBe(false)
  })
})

/**
 * The rule is "a REDUCTION is not priced", not "a preview is not priced".
 * Without these, a route that answered every quote with zeros — and so quoted
 * nothing for a purchase that charges a card — would pass every assertion
 * above.
 */
describe('CONTROL — an INCREASE preview is still priced', () => {
  it('prices it through invoices/upcoming under always_invoice', async () => {
    await call({ action: 'preview', kind: 'datasets', quantity: 6 })
    const priced = stripeCalls.filter((entry) =>
      entry.href.includes('/invoices/upcoming'),
    )
    expect(priced).toHaveLength(1)
    // The same behavior the set-action applies, so the quote and the charge
    // are computed the same way.
    expect(priced[0].href).toContain(
      'subscription_proration_behavior=always_invoice',
    )
  })

  it('and quotes a real, tax-inclusive amount', async () => {
    const payload = await (
      await call({ action: 'preview', kind: 'datasets', quantity: 6 })
    ).json()
    expect(payload.chargedNowCents).toBe(646)
    expect(payload.taxCents).toBe(46)
    expect(payload.prorationCents).toBe(600)
    // Nothing defers, so the card must not tell the customer the charge waits.
    expect(payload.defersToPeriodEnd).toBeUndefined()
  })
})

describe('the schedule a reduction writes', () => {
  it('creates one from the subscription when there is none', async () => {
    await setDatasets(1)
    const created = stripeCall('POST', '/subscription_schedules')
    expect(created).toBeDefined()
    expect(new URLSearchParams(created?.body ?? '').get('from_subscription')).toBe(
      'sub_1',
    )
  })

  it('leaves today alone and puts the smaller quantity in the future', async () => {
    await setDatasets(1)
    // Phase 0 is the period being billed right now — four datasets, its own
    // window intact.
    expect(phaseQuantity(0, 'price_starter_dataset')).toBe('4')
    expect(scheduleUpdate()?.get('phases[0][start_date]')).toBe(
      String(PERIOD_START),
    )
    expect(scheduleUpdate()?.get('phases[0][end_date]')).toBe(String(PERIOD_END))
    // Phase 1 starts where phase 0 ends and carries one.
    expect(phaseQuantity(1, 'price_starter_dataset')).toBe('1')
    expect(scheduleUpdate()?.get('phases[1][iterations]')).toBe('1')
    expect(scheduleUpdate()?.get('phases[1][automatic_tax][enabled]')).toBe('true')
  })

  it('carries the plan metadata the webhook mirror reads at the flip', async () => {
    // A phase replaces the subscription's metadata with its own. Without
    // these the flip would leave the org doc's plan mirror reading nothing.
    await setDatasets(1)
    expect(scheduleUpdate()?.get('phases[1][metadata][plan]')).toBe('starter')
    expect(scheduleUpdate()?.get('phases[1][metadata][orgId]')).toBe(ORG_ID)
  })

  it('carries every OTHER item through, including one it cannot classify', async () => {
    // A phase is an ABSOLUTE list: whatever is not written back is deleted at
    // the flip. Building the target from the recognised add-on kinds alone
    // would silently cancel a legacy price, a hand-attached dashboard line or
    // a negotiated one — recurring revenue, gone on a timer.
    await setDatasets(1)
    expect(phasePrices(1)).toEqual([
      'price_starter_monthly',
      'price_starter_dataset',
      'price_legacy_negotiated',
      'price_metered_usage',
    ])
    expect(phaseQuantity(1, 'price_legacy_negotiated')).toBe('2')
  })

  it('a removal drops the line from the future and keeps it in the present', async () => {
    // Removal is the same reduction at its limit: quantity 0 means the item
    // is absent from the target phase, not written there as a zero nobody can
    // read. It is still on the live subscription, so the datasets stay
    // readable until the renewal.
    await setDatasets(0)
    expect(phasePrices(0)).toContain('price_starter_dataset')
    expect(phasePrices(1)).not.toContain('price_starter_dataset')
    expect(phasePrices(1)).toContain('price_starter_monthly')
    expect(subscriptionUpdate()).toBeNull()
  })
})

describe('a schedule that already has a future phase is EDITED', () => {
  beforeEach(() => {
    scheduleOnSubscription = 'sub_sched_9'
  })

  it('reuses the schedule instead of creating a second one', async () => {
    await setDatasets(1)
    // The create endpoint is `POST subscription_schedules` with no id; the
    // update is `POST subscription_schedules/{id}`. Only the second may run.
    expect(
      stripeCalls.some(
        (entry) =>
          entry.method === 'POST' &&
          entry.href.endsWith('/v1/subscription_schedules'),
      ),
    ).toBe(false)
    expect(stripeCall('POST', '/subscription_schedules/sub_sched_9')).toBeDefined()
  })

  it('edits the LAST phase rather than appending a third', async () => {
    // Two futures cannot both be the future. Appending would leave the
    // subscription running an extra period before the reduction ever applied.
    await setDatasets(1)
    expect(writtenPhaseCount()).toBe(2)
    expect(phaseQuantity(1, 'price_starter_dataset')).toBe('1')
  })

  it('and the current phase keeps the terms a phase rewrite would drop', async () => {
    // The update REPLACES the whole phase list, so a coupon not restated is a
    // coupon ended — as a side effect of reducing a dataset.
    await setDatasets(1)
    expect(scheduleUpdate()?.get('phases[0][discounts][0][coupon]')).toBe(
      'coupon_winback_1',
    )
    expect(scheduleUpdate()?.get('phases[0][end_date]')).toBe(String(PERIOD_END))
  })

  it('answers with the schedule it reused', async () => {
    const payload = await (await setDatasets(1)).json()
    expect(payload.pendingAddonChange.scheduleId).toBe('sub_sched_9')
  })
})

/**
 * A pending PLAN DOWNGRADE is the case where the two item lists disagree.
 *
 * The subscription carries Pro's prices; the schedule's target phase carries
 * Starter's, because that is the plan it flips to. Rebuilding that phase from
 * the LIVE items — which is what a reduction used to do — replaced Starter's
 * prices with Pro's and left `metadata[plan]` still naming Starter: a phase
 * billing the plan the customer is leaving while telling the webhook mirror to
 * write the plan they are moving to. Nothing on any screen would disagree, and
 * the downgrade the customer asked for would simply not have happened.
 *
 * A same-plan future phase cannot catch that — the two lists are identical
 * there, so both readings produce the same bytes. This fixture is the one that
 * tells them apart.
 */
describe('a reduction on top of a pending plan DOWNGRADE', () => {
  beforeEach(() => {
    // Live today: Pro, with four extra datasets and the unclassifiable line.
    orgDoc = { plan: 'pro', seatAddons: { datasets: 4 } }
    planItem = {
      id: 'si_plan',
      quantity: 1,
      price: { id: 'price_pro_monthly', recurring: { interval: 'month' } },
    }
    datasetItem = {
      id: 'si_dataset',
      quantity: 4,
      price: { id: 'price_pro_dataset', recurring: { interval: 'month' } },
    }
    scheduleOnSubscription = 'sub_sched_9'
    existingSchedule = {
      id: 'sub_sched_9',
      status: 'active',
      end_behavior: 'release',
      phases: [
        {
          start_date: PERIOD_START,
          end_date: PERIOD_END,
          items: livePhaseItems(),
          discounts: [{ coupon: { id: 'coupon_winback_1' } }],
          automatic_tax: { enabled: true },
        },
        // The downgrade as its own path left it: STARTER prices, and the
        // metadata the webhook mirror reads at the flip.
        {
          start_date: PERIOD_END,
          items: [
            { price: 'price_starter_monthly', quantity: 1 },
            { price: 'price_starter_dataset', quantity: 4 },
            { price: 'price_legacy_negotiated', quantity: 2 },
            { price: 'price_metered_usage' },
          ],
          metadata: { plan: 'starter', orgId: ORG_ID },
          automatic_tax: { enabled: true },
        },
      ],
    }
  })

  it('the target phase keeps the TARGET plan price, not the live one', async () => {
    // The whole defect in one assertion: Pro's price appearing here means the
    // customer keeps being billed for the plan they scheduled themselves off.
    await setDatasets(1)
    expect(phaseQuantity(1, 'price_starter_monthly')).toBe('1')
    expect(phasePrices(1)).not.toContain('price_pro_monthly')
  })

  it('and its metadata still names the plan it flips to', async () => {
    // The metadata is what the webhook writes to the org doc at the flip. Left
    // beside Pro prices it becomes the active lie: billed Pro, mirrored
    // Starter, with the entitlement resolver reading the mirror.
    await setDatasets(1)
    expect(scheduleUpdate()?.get('phases[1][metadata][plan]')).toBe('starter')
    expect(scheduleUpdate()?.get('phases[1][metadata][orgId]')).toBe(ORG_ID)
  })

  it('every other line on that phase is untouched', async () => {
    // Including the one the route cannot classify. A phase is an absolute
    // list, so a rebuild that misses it deletes it at the flip.
    await setDatasets(1)
    expect(phaseQuantity(1, 'price_legacy_negotiated')).toBe('2')
    expect(phasePrices(1)).toContain('price_metered_usage')
    expect(phasePrices(1)).not.toContain('price_pro_dataset')
  })

  it('phase 0 still describes what is billed today', async () => {
    // The present is Pro, and stays Pro. A reduction must not move the plan in
    // either direction or either phase.
    await setDatasets(1)
    expect(phaseQuantity(0, 'price_pro_monthly')).toBe('1')
    expect(phaseQuantity(0, 'price_pro_dataset')).toBe('4')
    expect(scheduleUpdate()?.get('phases[0][discounts][0][coupon]')).toBe(
      'coupon_winback_1',
    )
  })

  it('still edits in place — no third phase, and the same schedule', async () => {
    const payload = await (await setDatasets(1)).json()
    expect(writtenPhaseCount()).toBe(2)
    expect(payload.pendingAddonChange).toMatchObject({
      kind: 'datasets',
      quantity: 1,
      scheduleId: 'sub_sched_9',
    })
  })

  /**
   * The reduction is matched on the target phase by the price THAT PHASE
   * carries, not the one the org holds today.
   *
   * A price id names "datasets ON PRO", not "datasets". A pending downgrade's
   * phase is already priced at the plan it flips to, so its dataset line is
   * `price_starter_dataset` while the live subscription's is
   * `price_pro_dataset`. Matching on the live id finds nothing there, and
   * finding nothing is silent: the phase is restated verbatim, still carrying
   * four datasets, while the route answers `pendingAddonChange: {quantity: 1}`
   * and the console tells the customer the reduction lands at the renewal. At
   * the renewal they would be delivered, and billed for, four.
   *
   * `addonPriceOnPhase` resolves the id from the phase's own plan for exactly
   * this reason. Same-plan schedules never exercised it — there both ids are
   * the same string — which is why only a cross-plan fixture can hold this.
   */
  it('moves the add-on line on that phase to the new quantity', async () => {
    await setDatasets(1)
    expect(phaseQuantity(1, 'price_starter_dataset')).toBe('1')
  })
})

describe('a schedule that cannot be had is a failure, not a success', () => {
  it('a create that answers without an id is a 502', async () => {
    // Silence here is the expensive shape: `ok: true` with no schedule written
    // tells the customer their reduction is booked for the renewal, and
    // nothing anywhere would ever apply it.
    createdSchedule = {}
    const response = await setDatasets(1)
    expect(response.status).toBe(502)
    const payload = await response.json()
    // Named apart from the route's catch-all 502 ("Add-on operation failed"),
    // so this assertion cannot be satisfied by an unrelated throw.
    expect(payload.error).toContain('could not schedule that change')
    expect(payload.ok).toBeUndefined()
  })

  it('a schedule with no phases is a 502 too', async () => {
    // Nothing to restate means nothing to append a target phase to; a write
    // built on it would replace the phase list with only the future.
    createdSchedule = { id: 'sub_sched_1', phases: [] }
    const response = await setDatasets(1)
    expect(response.status).toBe(502)
    expect((await response.json()).error).toContain('could not schedule that change')
  })

  it('and neither one charges anything or moves the mirror', async () => {
    createdSchedule = {}
    await setDatasets(1)
    expect(subscriptionUpdate()).toBeNull()
    expect(orgMirrorWrites).toEqual([])
  })
})

/**
 * The rule is "a reduction defers", not "every change defers". Without these,
 * a route that scheduled everything — and so charged for nothing — would pass
 * every assertion above.
 */
describe('CONTROL — an increase is still immediate', () => {
  it('updates the subscription under always_invoice and touches no schedule', async () => {
    const response = await setDatasets(6)
    expect(response.status).toBe(200)
    expect(subscriptionUpdate()?.get('items[0][quantity]')).toBe('6')
    expect(subscriptionUpdate()?.get('proration_behavior')).toBe('always_invoice')
    expect(
      stripeCalls.some((entry) => entry.href.includes('subscription_schedules')),
    ).toBe(false)
  })

  it('a first purchase is an increase, not a reduction from nothing', async () => {
    // No item means a current quantity of 0, which every requested quantity is
    // above. A comparison that read "no item" as unknown would defer the first
    // purchase a month and bill for it never.
    datasetItem = null
    const response = await setDatasets(2)
    expect(response.status).toBe(200)
    expect(subscriptionUpdate()?.get('items[0][price]')).toBe(
      'price_starter_dataset',
    )
    expect(subscriptionUpdate()?.get('proration_behavior')).toBe('always_invoice')
  })

  it('and an increase answers with a charge, not a pending change', async () => {
    const payload = await (await setDatasets(6)).json()
    expect(payload.pendingAddonChange).toBeUndefined()
    expect(payload.chargePaid).toBe(true)
  })
})
