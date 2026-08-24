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
 * The stored Stripe customer id is keyed by LIVEMODE (AGL-2486).
 *
 * `orgs/{orgId}/billing/stripe.stripeCustomerId` held one id and no notion of
 * mode. Measured on `test-org`, which holds the live customer
 * `cus_UuQjDdd1oxPMNH`: under `sk_test` every billing call answered
 *
 *   No such customer: 'cus_UuQjDdd1oxPMNH'; a similar object exists in live
 *   mode, but a test mode key was used to make this request.
 *
 * — 502ing `/api/billing/checkout`, `/api/billing/invoices` and
 * `/api/billing/addons`. Permanent, for any org that has been through checkout
 * in either mode, on a team running both against one Firestore.
 *
 * Two properties are asserted here, and the second is the one that made this a
 * stored-shape change rather than a better error message:
 *
 *  1. a test-mode deployment never READS the live id — no fallback, because
 *     the fallback IS the bug;
 *  2. a test-mode deployment never WRITES over it. Before this, the first
 *     completed test checkout replaced the live customer id in the single slot
 *     and the live linkage was gone, silently and for good.
 *
 * The live path is asserted to be byte-identical to what it always did — same
 * field name, test twin never visible — because that is the whole safety
 * argument for landing this nine days from the freeze.
 */

import {
  ORG_BILLING_DOC_ID,
  ORG_BILLING_SUBCOLLECTION,
  STRIPE_CUSTOMER_ID_TEST_FIELD,
  STRIPE_CUSTOMER_INDEX_COLLECTION,
} from '@aglyn/aglyn/server'

const LIVE_ID = 'cus_UuQjDdd1oxPMNH'
const TEST_ID = 'cus_TestModeTwin01'

/** The stored `orgs/org-1/billing/stripe` document, per case. */
let billingDoc: Record<string, unknown> | null
/** The org doc, for the un-backfilled legacy fallback path. */
let orgDoc: Record<string, unknown>
/** Every `set` the batch received, as `[path, data, options]`. */
let writes: Array<[string, Record<string, unknown>]>
let committed: number

const snapshotOf = (data: Record<string, unknown> | null) => ({
  exists: data !== null,
  data: () => data ?? undefined,
  get: (field: string) => (data ?? {})[field],
})

const docRef = (path: string) => ({
  path,
  get: async () =>
    snapshotOf(
      path === `orgs/org-1/${ORG_BILLING_SUBCOLLECTION}/${ORG_BILLING_DOC_ID}`
        ? billingDoc
        : path === 'orgs/org-1'
          ? orgDoc
          : null,
    ),
})

const firestore = {
  collection: (name: string) => ({
    doc: (id: string) => ({
      ...docRef(`${name}/${id}`),
      collection: (sub: string) => ({
        doc: (subId: string) => docRef(`${name}/${id}/${sub}/${subId}`),
      }),
    }),
  }),
  batch: () => ({
    set: (ref: { path: string }, data: Record<string, unknown>) => {
      writes.push([ref.path, data])
    },
    commit: async () => {
      committed += 1
    },
  }),
}

jest.mock('./firebase-admin', () => ({
  __esModule: true,
  firebaseAdmin: {
    app: () => ({ firestore: () => firestore }),
    firestore: {
      FieldValue: { serverTimestamp: () => '<<serverTimestamp>>' },
    },
  },
}))

// The REAL module under test, plus the REAL `deploymentLivemode` it composes —
// the `sk_live_` inference is the thing being relied on, so stubbing it would
// leave the mode decision untested.
import {
  readOrgBilling,
  readOrgBillingCustomerModes,
  writeOrgBilling,
} from './org-billing'

const ORIGINAL_ENV = process.env

/** Put the process in one Stripe world. Mode is read per call, not cached. */
function inMode(mode: 'live' | 'test') {
  process.env = {
    ...ORIGINAL_ENV,
    STRIPE_SECRET_KEY: mode === 'live' ? 'sk_live_fake' : 'sk_test_fake',
    STRIPE_LIVEMODE: undefined,
  } as NodeJS.ProcessEnv
}

const billingPath = `orgs/org-1/${ORG_BILLING_SUBCOLLECTION}/${ORG_BILLING_DOC_ID}`

beforeEach(() => {
  writes = []
  committed = 0
  orgDoc = { slug: 'test-org' }
  billingDoc = { stripeCustomerId: LIVE_ID }
})

afterEach(() => {
  process.env = ORIGINAL_ENV
})

describe('reading is scoped to the deployment mode (AGL-2486)', () => {
  it('live reads the live id, exactly as it always did', async () => {
    inMode('live')
    expect((await readOrgBilling('org-1')).stripeCustomerId).toBe(LIVE_ID)
  })

  it('TEST does NOT read the live id — the 502 this issue is about', async () => {
    inMode('test')
    // Not "some other id": nothing at all. A test-mode checkout then mints a
    // fresh test customer rather than sending `cus_Uu…` to a `sk_test` key.
    expect((await readOrgBilling('org-1')).stripeCustomerId).toBeFalsy()
  })

  it('test reads its OWN id when the org has one', async () => {
    billingDoc = { stripeCustomerId: LIVE_ID, [STRIPE_CUSTOMER_ID_TEST_FIELD]: TEST_ID }
    inMode('test')
    expect((await readOrgBilling('org-1')).stripeCustomerId).toBe(TEST_ID)
  })

  it('live is unaffected by a test twin sitting beside it', async () => {
    billingDoc = { stripeCustomerId: LIVE_ID, [STRIPE_CUSTOMER_ID_TEST_FIELD]: TEST_ID }
    inMode('live')
    const billing = await readOrgBilling('org-1')
    expect(billing.stripeCustomerId).toBe(LIVE_ID)
    // The physical twin must never reach a caller — every reader treats
    // `stripeCustomerId` as "the" customer, so a leaked second field is a
    // second answer to the same question.
    expect(billing[STRIPE_CUSTOMER_ID_TEST_FIELD]).toBeUndefined()
  })

  it('the subscription rides through both modes untouched', async () => {
    // Only the customer id is mode-keyed. A test-mode read that also blanked
    // the subscription would render a paying workspace as Free.
    billingDoc = { stripeCustomerId: LIVE_ID, subscription: { status: 'active' } }
    inMode('test')
    expect((await readOrgBilling('org-1')).subscription).toEqual({ status: 'active' })
  })

  it('an un-backfilled org doc is treated as LIVE-only (AGL-1028 fallback)', async () => {
    // The inline fields predate mode-keying, so whatever is there was written
    // by a live deployment. Live still sees it; test must not.
    billingDoc = null
    orgDoc = { slug: 'test-org', stripeCustomerId: LIVE_ID }
    inMode('live')
    expect((await readOrgBilling('org-1')).stripeCustomerId).toBe(LIVE_ID)
    inMode('test')
    expect((await readOrgBilling('org-1')).stripeCustomerId).toBeFalsy()
  })
})

describe('writing is scoped to the deployment mode (AGL-2486)', () => {
  it('live writes the live field — no behaviour change at all', async () => {
    inMode('live')
    await writeOrgBilling('org-1', { stripeCustomerId: LIVE_ID })
    const billingWrite = writes.find(([path]) => path === billingPath)
    expect(billingWrite?.[1]).toEqual({ stripeCustomerId: LIVE_ID })
    expect(committed).toBe(1)
  })

  it('TEST cannot overwrite the live customer id — the data-loss path', async () => {
    inMode('test')
    await writeOrgBilling('org-1', { stripeCustomerId: TEST_ID })
    const written = writes.find(([path]) => path === billingPath)?.[1] ?? {}
    expect(written[STRIPE_CUSTOMER_ID_TEST_FIELD]).toBe(TEST_ID)
    // The load-bearing assertion. Before this fix the merge carried
    // `stripeCustomerId: TEST_ID` and the live linkage was destroyed.
    expect(written).not.toHaveProperty('stripeCustomerId')
  })

  it('the reverse index is written for the TEST customer too', async () => {
    // The index needs no mode-keying — it is keyed BY the customer id, and
    // Stripe ids are unique across modes — but it must still be WRITTEN, or
    // the test-mode webhook cannot resolve the org from the customer.
    inMode('test')
    await writeOrgBilling('org-1', { stripeCustomerId: TEST_ID })
    const index = writes.find(([path]) =>
      path.startsWith(`${STRIPE_CUSTOMER_INDEX_COLLECTION}/`),
    )
    expect(index?.[0]).toBe(`${STRIPE_CUSTOMER_INDEX_COLLECTION}/${TEST_ID}`)
    expect(index?.[1]).toMatchObject({ orgId: 'org-1' })
  })

  it('the live index entry is untouched by a test write, so both resolve', async () => {
    inMode('test')
    await writeOrgBilling('org-1', { stripeCustomerId: TEST_ID })
    expect(
      writes.some(
        ([path]) => path === `${STRIPE_CUSTOMER_INDEX_COLLECTION}/${LIVE_ID}`,
      ),
    ).toBe(false)
  })

  it('a subscription-only patch is mode-agnostic and still mirrors status', async () => {
    // CONTROL: the renaming must key off the customer id alone. A patch that
    // carries no customer must behave identically in both modes.
    for (const mode of ['live', 'test'] as const) {
      writes = []
      inMode(mode)
      await writeOrgBilling('org-1', { subscription: { status: 'past_due' } as never })
      expect(writes.find(([path]) => path === billingPath)?.[1]).toEqual({
        subscription: { status: 'past_due' },
      })
      expect(writes.find(([path]) => path === 'orgs/org-1')?.[1]).toEqual({
        billingStatus: 'past_due',
      })
    }
  })

  it('a round trip returns what this mode wrote, in BOTH modes', async () => {
    // The property that actually matters to a caller, asserted end to end
    // rather than field by field.
    for (const [mode, id] of [
      ['live', LIVE_ID],
      ['test', TEST_ID],
    ] as const) {
      writes = []
      billingDoc = {}
      inMode(mode)
      await writeOrgBilling('org-1', { stripeCustomerId: id })
      billingDoc = writes.find(([path]) => path === billingPath)?.[1] ?? {}
      expect((await readOrgBilling('org-1')).stripeCustomerId).toBe(id)
    }
  })
})

/**
 * The census that lets a caller EXPLAIN an empty read (AGL-2486, follow-up).
 *
 * `readOrgBilling` answering nothing has two meanings — never billed, or
 * billed in the mode this deployment cannot see — and the billing cards
 * rendered both as "No invoices yet." over `test-org`'s intact history. The
 * fallback stays deleted; the caller gets a way to say which silence it is.
 *
 * Asserted against the same Firestore double the projection above uses, so the
 * census and the read it explains provably see the same bytes.
 */
describe('which MODES an org has a customer for (AGL-2486)', () => {
  it('reports the live customer that a test-mode read must not return', async () => {
    // The exact `test-org` state: live id stored, test slot empty.
    inMode('test')
    expect((await readOrgBilling('org-1')).stripeCustomerId).toBeFalsy()
    expect(await readOrgBillingCustomerModes('org-1')).toEqual({
      live: true,
      test: false,
    })
  })

  it('never returns an id — a test-mode surface must not hold a live `cus_…`', async () => {
    inMode('test')
    const modes = await readOrgBillingCustomerModes('org-1')
    // Booleans, and only booleans: this value is spread into a JSON response
    // served to every browser on a test deployment.
    expect(JSON.stringify(modes)).not.toContain(LIVE_ID)
    expect(Object.values(modes).every((value) => typeof value === 'boolean')).toBe(
      true,
    )
  })

  it('sees BOTH slots when both are filled, in either mode', async () => {
    billingDoc = { stripeCustomerId: LIVE_ID, [STRIPE_CUSTOMER_ID_TEST_FIELD]: TEST_ID }
    for (const mode of ['live', 'test'] as const) {
      inMode(mode)
      // The census is a fact about the STORED document, not about the reader.
      expect(await readOrgBillingCustomerModes('org-1')).toEqual({
        live: true,
        test: true,
      })
    }
  })

  it('reports neither for an org that has genuinely never been billed', async () => {
    billingDoc = {}
    inMode('test')
    expect(await readOrgBillingCustomerModes('org-1')).toEqual({
      live: false,
      test: false,
    })
  })

  it('a stored null is an absence, not a customer', async () => {
    // The webhook writes `null` to mean "Stripe says this is gone", and
    // `'stripeCustomerId' in doc` would have called that a customer — turning
    // a genuinely unbilled org into a bogus other-mode notice.
    billingDoc = { stripeCustomerId: null, [STRIPE_CUSTOMER_ID_TEST_FIELD]: '' }
    inMode('test')
    expect(await readOrgBillingCustomerModes('org-1')).toEqual({
      live: false,
      test: false,
    })
  })

  it('follows the SAME org-doc fallback `readOrgBilling` follows', async () => {
    // An org the AGL-1028 backfill never reached. If the census skipped the
    // fallback it would answer "never billed" for the very orgs whose billing
    // doc does not exist yet — the population most likely to hit this.
    billingDoc = null
    orgDoc = { slug: 'test-org', stripeCustomerId: LIVE_ID }
    inMode('test')
    expect((await readOrgBilling('org-1')).stripeCustomerId).toBeFalsy()
    expect(await readOrgBillingCustomerModes('org-1')).toEqual({
      live: true,
      test: false,
    })
  })

  it('does not disturb the projection it explains', async () => {
    // Reading the census must not leave the physical test field visible to a
    // later `readOrgBilling` — the two now share one stored-document read.
    billingDoc = { stripeCustomerId: LIVE_ID, [STRIPE_CUSTOMER_ID_TEST_FIELD]: TEST_ID }
    inMode('live')
    await readOrgBillingCustomerModes('org-1')
    const billing = await readOrgBilling('org-1')
    expect(billing.stripeCustomerId).toBe(LIVE_ID)
    expect(billing[STRIPE_CUSTOMER_ID_TEST_FIELD]).toBeUndefined()
  })

  it('an empty org id is not a lookup', async () => {
    expect(await readOrgBillingCustomerModes('')).toEqual({
      live: false,
      test: false,
    })
  })
})
