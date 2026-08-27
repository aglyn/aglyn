/**
 * @jest-environment node
 *
 * Pragma must stay in the FIRST block comment — behind the license header it is
 * silently ignored, and this suite needs `Request`/`Response`.
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
 * Staff subscription refunds (AGL-2486).
 *
 * NO LIVE REFUND WAS EVER ISSUED WRITING THIS. This repo has recorded that
 * localhost runs against the LIVE Stripe secret key, so the Stripe REST call
 * is driven entirely through the mocked `fetch` below and the handler never
 * reaches api.stripe.com in this suite — every assertion about what Stripe
 * was asked reads the recorded request, not a response from Stripe.
 *
 * What is pinned here is everything that stands between a staff click and
 * money leaving the account: the super-role bar, the reason that makes the
 * audit row worth having, the customer/charge binding, the disputed refusal,
 * the over-refund cap, and the idempotency replay. Each is asserted in BOTH
 * directions where it has one — refused when it should refuse, and Stripe
 * genuinely untouched when refused, because a guard that returns an error
 * after the POST has already gone out is not a guard.
 */

const mockVerifyIdToken = jest.fn()
const mockAuditAdd = jest.fn()
const mockClaimCreate = jest.fn(async () => undefined)
const mockClaimGet: jest.Mock<Promise<any>, any[]> = jest.fn(async () => ({
  get: (_field: string) => undefined as any,
}))
const mockClaimSet = jest.fn(async () => undefined)
const mockClaimDelete = jest.fn(async () => undefined)
const mockReadOrgBilling = jest.fn(async () => ({ stripeCustomerId: 'cus_1' }))

/**
 * The rolling 24-hour refund ledger, in memory (AGL-2486).
 *
 * A real double, not a stub that always says "room left": the entries array
 * it holds is the same shape the route writes and prunes, so a test that
 * pre-loads it exercises the actual sum-and-compare rather than a mock's
 * opinion of one. A double that modelled "allowed" as a boolean would have
 * made the splitting case — four refunds each under the per-refund cap —
 * impossible to write, which is the case the daily ceiling exists for.
 */
let mockLedgerDoc: Record<string, any>
/** Set to make the ledger transaction throw, i.e. simulate Firestore down. */
let mockLedgerFailure: Error | null

const mockRunTransaction = jest.fn(async (updateFunction: any) => {
  if (mockLedgerFailure) throw mockLedgerFailure
  return updateFunction({
    get: async () => ({ get: (field: string) => mockLedgerDoc[field] }),
    set: (_ref: unknown, data: Record<string, unknown>) => {
      Object.assign(mockLedgerDoc, data)
    },
  })
})

/** What the ledger currently holds, summed the way the route sums it. */
const ledgerCents = () =>
  (mockLedgerDoc['entries'] ?? []).reduce(
    (total: number, entry: any) => total + Number(entry.cents ?? 0),
    0,
  )

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  firebaseAdmin: {
    app: () => ({
      auth: () => ({
        verifyIdToken: (...args: unknown[]) => mockVerifyIdToken(...args),
      }),
      firestore: () => ({
        collection: (name: string) => ({
          add: async (row: unknown) => mockAuditAdd(name, row),
          doc: () => ({
            get: (...args: unknown[]) =>
              name === 'rateLimits'
                ? Promise.resolve({
                    get: (field: string) => mockLedgerDoc[field],
                  })
                : mockClaimGet(...(args as [])),
            create: (...args: unknown[]) => mockClaimCreate(...(args as [])),
            set: (...args: unknown[]) => mockClaimSet(...(args as [])),
            delete: (...args: unknown[]) => mockClaimDelete(...(args as [])),
          }),
        }),
        runTransaction: (...args: unknown[]) =>
          mockRunTransaction(...(args as [any])),
      }),
    }),
    firestore: { FieldValue: { serverTimestamp: () => 'SERVER_TIMESTAMP' } },
  },
  emailUnverifiedResponse: () =>
    Response.json({ error: 'Verify your email' }, { status: 403 }),
  isImpersonationSession: () => false,
  readOrgBilling: (...args: unknown[]) => mockReadOrgBilling(...(args as [])),
}))

jest.mock('@aglyn/aglyn/server', () => ({
  __esModule: true,
  pluginRequestFromWeb: async (request: Request) => {
    const url = new URL(request.url)
    return {
      method: request.method,
      body:
        request.method === 'GET' ? undefined : await request.json().catch(() => ({})),
      query: Object.fromEntries(url.searchParams.entries()),
      headers: Object.fromEntries(
        [...request.headers.entries()].map(([key, value]) => [
          key.toLowerCase(),
          value,
        ]),
      ),
    }
  },
}))

const { GET, POST } = require('../app/api/admin/org-refund/route')

/** Every Stripe call the handler made, in order. */
let stripeCalls: Array<{ url: string; method: string; body: string | null; idempotencyKey: string | null }>
/** `path prefix` → the JSON Stripe answers with. */
let stripeReplies: Record<string, { ok?: boolean; status?: number; body: any }>

const CHARGE = {
  id: 'ch_1',
  customer: 'cus_1',
  amount: 5000,
  amount_refunded: 0,
  currency: 'usd',
  paid: true,
  status: 'succeeded',
  disputed: false,
  invoice: { id: 'in_1', number: 'AGL-0001' },
  balance_transaction: { fee: 175 },
}

beforeEach(() => {
  jest.clearAllMocks()
  stripeCalls = []
  stripeReplies = {
    'charges/ch_1': { body: CHARGE },
    // Modelled on the real endpoint, which ECHOES the amount it was asked
    // for. A stub that always answered the full charge would have made the
    // audit row look right for a partial refund it recorded wrong — an
    // unfaithful double manufactures false greens as readily as false reds.
    refunds: { body: null },
    charges: { body: { data: [CHARGE] } },
  }
  mockVerifyIdToken.mockResolvedValue({
    uid: 'staff-1',
    email_verified: true,
    staff: true,
    staffRole: 'super',
  })
  mockReadOrgBilling.mockResolvedValue({ stripeCustomerId: 'cus_1' })
  mockClaimGet.mockResolvedValue({ get: () => undefined })
  mockClaimCreate.mockResolvedValue(undefined)
  mockLedgerDoc = {}
  mockLedgerFailure = null
  process.env.STRIPE_SECRET_KEY = 'sk_test_not_a_real_key'
  ;(globalThis as any).fetch = jest.fn(async (url: string, init: any = {}) => {
    const path = String(url).replace('https://api.stripe.com/v1/', '')
    stripeCalls.push({
      url: path,
      method: init.method ?? 'GET',
      body: init.body ?? null,
      idempotencyKey: init.headers?.['Idempotency-Key'] ?? null,
    })
    const key = Object.keys(stripeReplies)
      .sort((a, b) => b.length - a.length)
      .find((candidate) => path.startsWith(candidate))
    const reply = key ? stripeReplies[key] : { body: {} }
    const sent = new URLSearchParams(String(init.body ?? ''))
    return {
      ok: reply.ok !== false,
      status: reply.status ?? (reply.ok === false ? 400 : 200),
      json: async () =>
        // `body: null` on a successful refund means "answer the way Stripe
        // does" — the created refund, carrying back the amount that was
        // actually asked for.
        reply.body ??
        {
          id: 're_1',
          amount: Number(sent.get('amount') ?? 0),
          currency: 'usd',
        },
    }
  })
})

const postRefund = (body: Record<string, unknown>) =>
  POST(
    new Request('https://console.aglyn.com/api/admin/org-refund', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer tok',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    }),
  )

const good = (over: Record<string, unknown> = {}) => ({
  orgId: 'org-1',
  chargeId: 'ch_1',
  amountCents: 5000,
  reason: 'billing-error',
  idempotencyKey: 'attempt-1',
  ...over,
})

/**
 * A charge large enough that the WINDOW is what refuses, not the charge.
 *
 * Without this the ceiling tests pass for the wrong reason — the default
 * fixture captures $50, so a $150 attempt is refused by "only $50 is left on
 * this charge" and never reaches the ceiling at all. A green there would have
 * proved nothing about the cap.
 */
const bigCharge = () => {
  stripeReplies['charges/ch_1'] = {
    body: { ...CHARGE, amount: 1_000_00, amount_refunded: 0 },
  }
}

/** Re-authenticate the next call as a CAPPED role. */
const asSupport = () =>
  mockVerifyIdToken.mockResolvedValue({
    uid: 'staff-2',
    email_verified: true,
    staff: true,
    staffRole: 'support',
  })

/** Did the handler ask Stripe to move money? */
const refundCalls = () => stripeCalls.filter((call) => call.url === 'refunds')

const auditRows = () =>
  mockAuditAdd.mock.calls
    .filter(([collection]) => collection === 'adminAudit')
    .map(([, row]) => row)

describe('POST /api/admin/org-refund (AGL-2486)', () => {
  describe('who may refund', () => {
    it('refuses a non-staff caller', async () => {
      mockVerifyIdToken.mockResolvedValue({ uid: 'u1', email_verified: true })
      const response = await postRefund(good())
      expect(response.status).toBe(403)
      expect(refundCalls()).toHaveLength(0)
    })

    it('lets support refund UNDER the cap — the whole point of the change', async () => {
      asSupport()
      // $50, well under $150. Nine days from launch the person the customer
      // reaches is support; making them escalate this is what the cap
      // replaced.
      const response = await postRefund(good({ amountCents: 5000 }))
      expect(response.status).toBe(200)
      expect(refundCalls()).toHaveLength(1)
      expect(auditRows()[0]).toMatchObject({
        actorRole: 'support',
        authority: 'capped',
        overCap: false,
      })
    })

    it('refuses support ABOVE the cap, before Stripe is touched', async () => {
      asSupport()
      stripeReplies['charges/ch_1'] = {
        body: { ...CHARGE, amount: 60000, amount_refunded: 0 },
      }
      const response = await postRefund(good({ amountCents: 20000 }))
      expect(response.status).toBe(403)
      await expect(response.json()).resolves.toEqual({
        error: expect.stringContaining('needs the super staff role'),
      })
      // BOTH directions. A guard that answered 403 after the POST had gone
      // out would not be a guard, and the charge lookup is the only Stripe
      // call that may have happened.
      expect(refundCalls()).toHaveLength(0)
      // Nothing claimed, nothing reserved: a mistyped amount must stay
      // retryable with the same key.
      expect(mockClaimCreate).not.toHaveBeenCalled()
      expect(ledgerCents()).toBe(0)
    })

    it('still lets SUPER refund above the cap, and records that it did', async () => {
      stripeReplies['charges/ch_1'] = {
        body: { ...CHARGE, amount: 60000, amount_refunded: 0 },
      }
      const response = await postRefund(good({ amountCents: 20000 }))
      expect(response.status).toBe(200)
      expect(auditRows()[0]).toMatchObject({
        actorRole: 'super',
        authority: 'super',
        // The field that separates an escalated refund from a routine one.
        overCap: true,
      })
    })

    it('records a SUPER refund under the cap as routine, not escalated', async () => {
      // `authority` alone cannot answer "which refunds needed the
      // escalation" — a super issuing $50 is an ordinary refund.
      const response = await postRefund(good({ amountCents: 5000 }))
      expect(response.status).toBe(200)
      expect(auditRows()[0]).toMatchObject({
        authority: 'super',
        overCap: false,
      })
    })

    it('501s rather than 500s when Stripe is not configured', async () => {
      delete process.env.STRIPE_SECRET_KEY
      const response = await postRefund(good())
      expect(response.status).toBe(501)
    })
  })

  /**
   * The cap that stops the cap being defeated by arithmetic.
   *
   * There is no second approver, so the per-refund cap is the whole
   * control — and on its own it is evaded by splitting: a $600 annual charge
   * refunded as four $150 partials passes a $150 per-refund cap four times
   * and lands exactly where the cap existed to stop it.
   */
  describe('the rolling 24-hour ceiling', () => {
    it('refuses the refund that would take the actor past it', async () => {
      asSupport()
      bigCharge()
      // $400 already spent today, all of it in legal sub-cap refunds.
      mockLedgerDoc = {
        entries: [
          { atMs: Date.now() - 60_000, cents: 15000, entryId: 'a' },
          { atMs: Date.now() - 50_000, cents: 15000, entryId: 'b' },
          { atMs: Date.now() - 40_000, cents: 10000, entryId: 'c' },
        ],
      }
      const response = await postRefund(good({ amountCents: 15000 }))
      expect(response.status).toBe(403)
      await expect(response.json()).resolves.toEqual({
        // Names what is left, not just that there was a limit.
        error: expect.stringContaining('$100.00 is left'),
      })
      expect(refundCalls()).toHaveLength(0)
    })

    it('allows exactly the remainder — the boundary is not off by one', async () => {
      asSupport()
      bigCharge()
      mockLedgerDoc = {
        entries: [{ atMs: Date.now(), cents: 40000, entryId: 'a' }],
      }
      const response = await postRefund(good({ amountCents: 10000 }))
      expect(response.status).toBe(200)
      expect(refundCalls()).toHaveLength(1)
    })

    it('SPLITTING a large refund into legal-sized ones still hits the wall', async () => {
      asSupport()
      bigCharge()
      // Four $150 refunds are each under the per-refund cap. The fourth is
      // the one the per-refund cap alone would have let through.
      const outcomes: number[] = []
      for (let attempt = 0; attempt < 4; attempt += 1) {
        const response = await postRefund(
          good({ amountCents: 15000, idempotencyKey: `attempt-${attempt}` }),
        )
        outcomes.push(response.status)
      }
      expect(outcomes).toEqual([200, 200, 200, 403])
      expect(refundCalls()).toHaveLength(3)
      expect(ledgerCents()).toBe(45000)
    })

    it('ages entries out — yesterday does not spend today', async () => {
      asSupport()
      bigCharge()
      mockLedgerDoc = {
        entries: [
          // 25 hours ago: outside the window, so it neither counts nor is
          // carried forward into the document that gets written back.
          { atMs: Date.now() - 25 * 60 * 60 * 1000, cents: 50000, entryId: 'old' },
        ],
      }
      const response = await postRefund(good({ amountCents: 15000 }))
      expect(response.status).toBe(200)
      expect(ledgerCents()).toBe(15000)
    })

    it('does not reserve against a SUPER actor at all', async () => {
      const response = await postRefund(good({ amountCents: 5000 }))
      expect(response.status).toBe(200)
      // Uncapped: a ledger entry would be enforcement state enforcing
      // nothing, at the cost of a transaction on every super refund.
      expect(mockRunTransaction).not.toHaveBeenCalled()
    })

    it('FAILS CLOSED when the ledger cannot be read', async () => {
      asSupport()
      mockLedgerFailure = new Error('firestore unavailable')
      const response = await postRefund(good({ amountCents: 5000 }))
      // A store outage that silently lifted the only control on the largest
      // staff action would be an unbounded window nobody could see.
      expect(response.status).toBe(503)
      expect(refundCalls()).toHaveLength(0)
      // And the attempt stays retryable once the store is back.
      expect(mockClaimDelete).toHaveBeenCalled()
    })

    it('gives the reservation back when STRIPE refuses', async () => {
      asSupport()
      bigCharge()
      stripeReplies['refunds'] = {
        ok: false,
        status: 400,
        body: { error: { code: 'charge_already_refunded', message: 'nope' } },
      }
      const response = await postRefund(good({ amountCents: 15000 }))
      expect(response.status).toBeGreaterThanOrEqual(400)
      // No money moved, so the day's ceiling must not have been spent.
      expect(ledgerCents()).toBe(0)
    })

  })

  describe('the reason is a boundary, not a suggestion', () => {
    it('refuses a refund with no reason, before Stripe is touched', async () => {
      const response = await postRefund(good({ reason: undefined }))
      expect(response.status).toBe(400)
      // The whole point: an audit row written after the money moved cannot be
      // back-filled, so the refusal has to come first.
      expect(stripeCalls).toHaveLength(0)
      expect(auditRows()).toHaveLength(0)
    })

    it('refuses an unknown reason code', async () => {
      const response = await postRefund(good({ reason: 'because' }))
      expect(response.status).toBe(400)
      expect(stripeCalls).toHaveLength(0)
    })

    it('refuses "other" with no note', async () => {
      const response = await postRefund(good({ reason: 'other', note: '   ' }))
      expect(response.status).toBe(400)
      expect(stripeCalls).toHaveLength(0)
    })

    it('accepts "other" once the note says what', async () => {
      const response = await postRefund(
        good({ reason: 'other', note: 'Duplicate of the Jan invoice' }),
      )
      expect(response.status).toBe(200)
      expect(auditRows()[0]).toMatchObject({
        reason: 'other',
        note: 'Duplicate of the Jan invoice',
      })
    })
  })

  describe('the charge has to be this org’s', () => {
    it('refuses a charge belonging to another customer', async () => {
      // The org page names the org and the request names a charge; nothing
      // else ties them together. Without this, a stale or pasted charge id
      // refunds someone else's money and audits it against this org.
      stripeReplies['charges/ch_1'] = {
        body: { ...CHARGE, customer: 'cus_someone_else' },
      }
      const response = await postRefund(good())
      expect(response.status).toBe(409)
      expect(refundCalls()).toHaveLength(0)
    })

    it('refuses when the org has no Stripe customer at all', async () => {
      mockReadOrgBilling.mockResolvedValue({ stripeCustomerId: undefined })
      const response = await postRefund(good())
      expect(response.status).toBe(409)
      expect(refundCalls()).toHaveLength(0)
    })
  })

  describe('disputes', () => {
    it('refuses a disputed charge before anything is claimed', async () => {
      // AGL-1809's reasoning, unchanged: the bank has already pulled the
      // funds, so a refund that landed would pay the customer twice. Refused
      // ahead of the claim so no idempotency key is burned.
      stripeReplies['charges/ch_1'] = { body: { ...CHARGE, disputed: true } }
      const response = await postRefund(good())
      expect(response.status).toBe(409)
      expect(refundCalls()).toHaveLength(0)
      expect(mockClaimCreate).not.toHaveBeenCalled()
    })

    it('maps Stripe’s own dispute refusal to a 409 an operator can act on', async () => {
      stripeReplies['refunds'] = {
        ok: false,
        status: 400,
        body: { error: { code: 'charge_disputed', message: 'charged back' } },
      }
      const response = await postRefund(good())
      expect(response.status).toBe(409)
      await expect(response.json()).resolves.toEqual({
        error: expect.stringContaining('disputed'),
      })
    })

    it('releases the claim when Stripe refuses, so the attempt can be retried', async () => {
      stripeReplies['refunds'] = {
        ok: false,
        status: 402,
        body: { error: { message: 'card issue' } },
      }
      const response = await postRefund(good())
      expect(response.status).toBe(502)
      // Stripe said no, so we KNOW no money moved. Burning the key would
      // leave the operator unable to retry the same attempt.
      expect(mockClaimDelete).toHaveBeenCalled()
      expect(auditRows()).toHaveLength(0)
    })
  })

  describe('the amount', () => {
    it('defaults to everything still refundable', async () => {
      stripeReplies['charges/ch_1'] = {
        body: { ...CHARGE, amount_refunded: 2000 },
      }
      const response = await postRefund(good({ amountCents: undefined }))
      expect(response.status).toBe(200)
      expect(refundCalls()[0].body).toContain('amount=3000')
    })

    it('refuses more than is left, without asking Stripe', async () => {
      stripeReplies['charges/ch_1'] = {
        body: { ...CHARGE, amount_refunded: 4000 },
      }
      const response = await postRefund(good({ amountCents: 2000 }))
      expect(response.status).toBe(409)
      expect(refundCalls()).toHaveLength(0)
    })

    it('refuses a zero amount rather than reading it as "everything"', async () => {
      // `strictNullChecks` is off and `0` is falsy, so the difference between
      // "no amount given" and "an amount of zero" is exactly the kind of thing
      // a `??`/`||` slip erases — in the direction of refunding the lot.
      const response = await postRefund(good({ amountCents: 0 }))
      expect(response.status).toBe(400)
      expect(refundCalls()).toHaveLength(0)
    })

    it('refuses a fully-refunded charge', async () => {
      stripeReplies['charges/ch_1'] = {
        body: { ...CHARGE, amount_refunded: 5000 },
      }
      const response = await postRefund(good({ amountCents: undefined }))
      expect(response.status).toBe(409)
      expect(refundCalls()).toHaveLength(0)
    })
  })

  describe('the Stripe call itself', () => {
    it('refunds the CHARGE and sends no connected-account parameters', async () => {
      await postRefund(good())
      const call = refundCalls()[0]
      expect(call.method).toBe('POST')
      expect(call.body).toContain('charge=ch_1')
      expect(call.body).toContain('amount=5000')
      // A subscription charge is a platform charge, not a destination charge:
      // there is no transfer to reverse and no application fee to return, and
      // Stripe errors on both. This is the one place the marketplace refund's
      // parameters must NOT be copied.
      expect(call.body).not.toContain('reverse_transfer')
      expect(call.body).not.toContain('refund_application_fee')
    })

    it('sends the attempt key as Stripe’s idempotency header', async () => {
      await postRefund(good({ idempotencyKey: 'attempt-xyz' }))
      expect(refundCalls()[0].idempotencyKey).toBe('attempt-xyz')
    })
  })

  describe('idempotency', () => {
    it('replays a settled attempt instead of refunding again', async () => {
      const settled = { ok: true, refundId: 're_1', amountCents: 5000 }
      mockClaimGet.mockResolvedValue({
        get: (field: string) =>
          field === 'response' ? settled : field === 'responseStatus' ? 200 : undefined,
      })
      const response = await postRefund(good())
      expect(response.status).toBe(200)
      await expect(response.json()).resolves.toEqual(settled)
      // The money outcome is right and reported as a success. Answering
      // "nothing left to refund" here is what makes an operator refund by hand.
      expect(refundCalls()).toHaveLength(0)
    })

    it('refuses a concurrent second attempt on the same key', async () => {
      mockClaimCreate.mockRejectedValue(new Error('already exists'))
      const response = await postRefund(good())
      expect(response.status).toBe(409)
      expect(refundCalls()).toHaveLength(0)
    })
  })

  describe('the audit row', () => {
    it('records the actor, the reason, the money and the fee Stripe kept', async () => {
      const response = await postRefund(
        good({ amountCents: 2500, reason: 'goodwill', note: 'outage credit' }),
      )
      expect(response.status).toBe(200)
      const row = auditRows()[0]
      expect(row).toMatchObject({
        actorUid: 'staff-1',
        action: 'org.refund',
        target: 'orgs/org-1',
        reason: 'goodwill',
        note: 'outage credit',
      })
      expect(row.before).toMatchObject({ chargeId: 'ch_1', capturedCents: 5000 })
      expect(row.after).toMatchObject({
        chargeId: 'ch_1',
        amountCents: 2500,
        currency: 'usd',
        invoiceId: 'in_1',
        // The real cost of the refund, recorded at the moment it is known.
        // Re-deriving it from Stripe months later during a margin review is
        // the work this field exists to make unnecessary.
        feeRetainedCents: 175,
      })
    })

    it('still reports success when the audit write fails', async () => {
      // The money has already moved. Reporting a failure would send the
      // operator to refund again — the audit gap is the lesser harm, and it
      // is logged.
      mockAuditAdd.mockRejectedValue(new Error('firestore down'))
      const response = await postRefund(good())
      expect(response.status).toBe(200)
    })
  })
})

describe('GET /api/admin/org-refund (AGL-2486)', () => {
  const get = (orgId: string) =>
    GET(
      new Request(
        `https://console.aglyn.com/api/admin/org-refund?orgId=${orgId}`,
        { headers: { Authorization: 'Bearer tok' } },
      ),
    )

  it('lists charges with the fee Stripe keeps', async () => {
    const response = await get('org-1')
    expect(response.status).toBe(200)
    const payload = await response.json()
    expect(payload.charges).toEqual([
      expect.objectContaining({
        id: 'ch_1',
        amountCents: 5000,
        refundedCents: 0,
        feeCents: 175,
        invoiceNumber: 'AGL-0001',
        disputed: false,
        paid: true,
      }),
    ])
  })

  it('is readable by support staff — only the POST is super-only', async () => {
    mockVerifyIdToken.mockResolvedValue({
      uid: 'staff-2',
      email_verified: true,
      staff: true,
      staffRole: 'support',
    })
    const response = await get('org-1')
    expect(response.status).toBe(200)
  })

  it('reports a Stripe failure as an ERROR, never as an empty list', async () => {
    // AGL-940's lesson, and it bites harder here: "no refundable charges"
    // sends an operator away believing there was nothing to refund.
    stripeReplies['charges'] = {
      ok: false,
      status: 401,
      body: { error: { message: 'Invalid API key' } },
    }
    const payload = await (await get('org-1')).json()
    expect(payload.charges).toEqual([])
    expect(payload.stripeError).toBe('Invalid API key')
    expect(payload.hasCustomer).toBe(true)
  })

  it('tells "never subscribed" apart from "lookup failed"', async () => {
    mockReadOrgBilling.mockResolvedValue({ stripeCustomerId: undefined })
    const payload = await (await get('org-1')).json()
    expect(payload).toEqual({
      charges: [],
      hasCustomer: false,
      // The allowance travels with EVERY GET, including this one: a card
      // that cannot list charges must still be able to state the boundary.
      authority: {
        role: 'super',
        authority: 'super',
        perRefundCapCents: null,
        windowCapCents: null,
        windowCents: 0,
        windowCount: 0,
      },
    })
  })
})
