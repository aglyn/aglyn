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
 * Staff subscription cancellation (AGL-3359).
 *
 * NOTHING HERE REACHES STRIPE. Every call goes to the stateful double in
 * `stripe-subscriptions-double.ts`, which moves a subscription only when a
 * write would have, so the route's read-back is tested against a store that
 * can disagree with it.
 *
 * Pinned: the super-only bar (and the staff-wide read), `now` versus
 * `period_end` as Stripe is asked for them, both lookup routes, the
 * idempotent second run, the audit row, the reason gate, and that no refund
 * endpoint is ever called.
 */

import {
  installStripeDouble,
  subscription,
  type StripeDouble,
} from './stripe-subscriptions-double'

const mockVerifyIdToken = jest.fn()
const mockAuditRows: Record<string, unknown>[] = []
const mockReadOrgBilling = jest.fn()
let mockOrgExists = true

jest.mock('firebase-admin/firestore', () => ({
  __esModule: true,
  FieldValue: { serverTimestamp: () => 'SERVER_TIMESTAMP' },
}))

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  firebaseAdmin: {
    app: () => ({
      auth: () => ({
        verifyIdToken: (...args: unknown[]) => mockVerifyIdToken(...args),
      }),
      firestore: () => ({
        collection: (name: string) => ({
          add: async (row: Record<string, unknown>) => {
            if (name !== 'adminAudit') throw new Error(`unexpected add: ${name}`)
            mockAuditRows.push(row)
            return { id: `audit-${mockAuditRows.length}` }
          },
          doc: (id: string) => ({
            get: async () => ({
              id,
              exists: name === 'orgs' ? mockOrgExists : false,
              get: (field: string) => (field === 'slug' ? 'acme' : undefined),
            }),
          }),
        }),
      }),
    }),
  },
  emailUnverifiedResponse: () =>
    Response.json({ error: 'Verify your email' }, { status: 403 }),
  isImpersonationSession: () => false,
  readOrgBilling: (...args: unknown[]) => mockReadOrgBilling(...args),
}))

const route = require('../app/api/admin/billing/cancel-subscription/route') as {
  GET: (request: Request) => Promise<Response>
  POST: (request: Request) => Promise<Response>
}

let stripe: StripeDouble

async function post(body: Record<string, unknown>, token = 'staff-token') {
  const response = await route.POST(
    new Request('https://app.aglyn.com/api/admin/billing/cancel-subscription', {
      method: 'POST',
      headers: {
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    }),
  )
  return { status: response.status, body: (await response.json()) as any }
}

async function get(orgId: string) {
  const response = await route.GET(
    new Request(
      `https://app.aglyn.com/api/admin/billing/cancel-subscription?orgId=${orgId}`,
      { headers: { authorization: 'Bearer staff-token' } },
    ),
  )
  return { status: response.status, body: (await response.json()) as any }
}

const asRole = (staffRole: string | undefined, extra: object = {}) =>
  mockVerifyIdToken.mockResolvedValue({
    uid: 'staff-1',
    email: 'ops@aglyn.com',
    email_verified: true,
    staff: true,
    ...(staffRole ? { staffRole } : {}),
    ...extra,
  })

beforeEach(() => {
  jest.clearAllMocks()
  mockAuditRows.length = 0
  mockOrgExists = true
  mockReadOrgBilling.mockResolvedValue({ stripeCustomerId: 'cus_org1' })
  process.env.STRIPE_SECRET_KEY = 'sk_test_not_a_real_key'
  asRole('super')
  stripe = installStripeDouble([
    subscription({ id: 'sub_live' }),
    subscription({ id: 'sub_old', status: 'canceled', created: 1_700_000_000 }),
  ])
})

describe('the gate', () => {
  it('refuses an unauthenticated caller before anything else', async () => {
    const { status } = await post({ orgId: 'org1', when: 'now', reason: 'fraud' }, '')
    expect(status).toBe(401)
    expect(stripe.calls).toEqual([])
  })

  it('refuses a non-staff caller', async () => {
    mockVerifyIdToken.mockResolvedValue({ uid: 'u1', email_verified: true })
    const { status } = await post({ orgId: 'org1', when: 'now', reason: 'fraud' })
    expect(status).toBe(403)
    expect(stripe.calls).toEqual([])
  })

  it.each([['support'], ['billing'], [undefined]])(
    'refuses a %s staff caller — and a token with no role fails closed',
    async (role) => {
      asRole(role)
      const { status, body } = await post({
        orgId: 'org1',
        when: 'now',
        reason: 'fraud',
      })
      expect(status).toBe(403)
      expect(body.error).toMatch(/super staff role/)
      // Refused BEFORE Stripe: a guard that answers after the DELETE went
      // out is not a guard.
      expect(stripe.calls).toEqual([])
      expect(mockAuditRows).toEqual([])
    },
  )

  it('lets every staff role READ the subscriptions', async () => {
    asRole('support')
    const { status, body } = await get('org1')
    expect(status).toBe(200)
    expect(body.subscriptions.map((row: any) => row.id)).toEqual([
      'sub_live',
      'sub_old',
    ])
    expect(body.subscriptions[0]).toMatchObject({
      status: 'active',
      terminal: false,
      cancelAtPeriodEnd: false,
      interval: 'month',
    })
    expect(stripe.writes()).toEqual([])
  })

  it('refuses a malformed org id rather than searching with it', async () => {
    const { status } = await post({
      orgId: "org1' OR metadata['x']:'",
      when: 'now',
      reason: 'fraud',
    })
    expect(status).toBe(400)
    expect(stripe.calls).toEqual([])
  })

  it('404s a workspace that does not exist', async () => {
    mockOrgExists = false
    const { status } = await post({ orgId: 'nope', when: 'now', reason: 'fraud' })
    expect(status).toBe(404)
    expect(stripe.calls).toEqual([])
  })

  it('501s without Stripe configured, touching nothing', async () => {
    delete process.env.STRIPE_SECRET_KEY
    const { status } = await post({ orgId: 'org1', when: 'now', reason: 'fraud' })
    expect(status).toBe(501)
    expect(stripe.calls).toEqual([])
  })

  it('refuses without a reason, and refuses "other" without a note', async () => {
    expect((await post({ orgId: 'org1', when: 'now' })).status).toBe(400)
    expect(
      (await post({ orgId: 'org1', when: 'now', reason: 'other' })).status,
    ).toBe(400)
    expect(
      (await post({ orgId: 'org1', when: 'later', reason: 'fraud' })).status,
    ).toBe(400)
    expect(stripe.calls).toEqual([])
  })
})

describe('now versus period end', () => {
  it('now: deletes with invoice_now=false and prorate=false, reason in the comment', async () => {
    const { status, body } = await post({
      orgId: 'org1',
      when: 'now',
      reason: 'fraud',
      note: 'phishing kit on the site',
    })
    expect(status).toBe(200)
    const writes = stripe.writes()
    expect(writes).toHaveLength(1)
    expect(writes[0]).toMatchObject({
      method: 'DELETE',
      path: 'subscriptions/sub_live',
    })
    expect(writes[0].params).toMatchObject({
      invoice_now: 'false',
      prorate: 'false',
    })
    expect(writes[0].params['cancellation_details[comment]']).toMatch(
      /fraud — phishing kit on the site/,
    )
    // The READ-BACK, from the store the write moved.
    expect(body.confirmed).toBe(true)
    expect(body.changed).toBe(1)
    const live = body.subscriptions.find((step: any) => step.id === 'sub_live')
    expect(live).toMatchObject({ outcome: 'canceled', confirmed: true })
    expect(live.verified.status).toBe('canceled')
    // The already-cancelled one is reported, not written.
    expect(
      body.subscriptions.find((step: any) => step.id === 'sub_old').outcome,
    ).toBe('already-canceled')
  })

  it('period_end: sets cancel_at_period_end and leaves the subscription live', async () => {
    const { body } = await post({
      orgId: 'org1',
      when: 'period_end',
      reason: 'customer-request',
    })
    const writes = stripe.writes()
    expect(writes).toHaveLength(1)
    expect(writes[0]).toMatchObject({
      method: 'POST',
      path: 'subscriptions/sub_live',
    })
    expect(writes[0].params['cancel_at_period_end']).toBe('true')
    expect(writes.some((call) => call.method === 'DELETE')).toBe(false)
    expect(body.confirmed).toBe(true)
    const live = body.subscriptions.find((step: any) => step.id === 'sub_live')
    expect(live.outcome).toBe('scheduled')
    expect(live.verified).toMatchObject({
      status: 'active',
      cancelAtPeriodEnd: true,
    })
  })

  it('period_end releases a pending-downgrade schedule first, as the customer cancel does', async () => {
    stripe.subscriptions.get('sub_live')!.schedule = 'sub_sched_1'
    const { body } = await post({
      orgId: 'org1',
      when: 'period_end',
      reason: 'customer-request',
    })
    expect(stripe.writes().map((call) => call.path)).toEqual([
      'subscription_schedules/sub_sched_1/release',
      'subscriptions/sub_live',
    ])
    expect(body.confirmed).toBe(true)
  })

  it('never calls a refund endpoint, whichever it is', async () => {
    await post({ orgId: 'org1', when: 'now', reason: 'fraud' })
    await post({ orgId: 'org1', when: 'period_end', reason: 'fraud' })
    expect(
      stripe.calls.filter((call) => /refund|credit_note/.test(call.path)),
    ).toEqual([])
  })
})

describe('finding every subscription', () => {
  it('cancels one reachable only by the metadata.orgId search', async () => {
    // Created against another customer — the stored id would never list it.
    stripe.subscriptions.set(
      'sub_stray',
      subscription({ id: 'sub_stray', customer: 'cus_other' }),
    )
    const { body } = await post({ orgId: 'org1', when: 'now', reason: 'fraud' })
    expect(
      stripe
        .writes()
        .map((call) => call.path)
        .sort(),
    ).toEqual(['subscriptions/sub_live', 'subscriptions/sub_stray'])
    expect(body.confirmed).toBe(true)
  })

  it('does not cancel another workspace’s subscription on the same search', async () => {
    stripe.subscriptions.set(
      'sub_neighbor',
      subscription({
        id: 'sub_neighbor',
        customer: 'cus_other',
        metadata: { orgId: 'org2' },
      }),
    )
    await post({ orgId: 'org1', when: 'now', reason: 'fraud' })
    expect(stripe.subscriptions.get('sub_neighbor')!.status).toBe('active')
  })

  it('still searches by metadata when the org has no stored customer', async () => {
    mockReadOrgBilling.mockResolvedValue({})
    const { body } = await post({ orgId: 'org1', when: 'now', reason: 'fraud' })
    expect(stripe.calls.some((call) => call.path === 'subscriptions')).toBe(false)
    expect(stripe.subscriptions.get('sub_live')!.status).toBe('canceled')
    expect(body.customerId).toBeNull()
    expect(body.confirmed).toBe(true)
  })

  it('a failed lookup is never reported as confirmed, even when the rest landed', async () => {
    stripe.failSearch = true
    const { body } = await post({ orgId: 'org1', when: 'now', reason: 'fraud' })
    // What the customer list found was still cancelled…
    expect(stripe.subscriptions.get('sub_live')!.status).toBe('canceled')
    // …but "we cancelled what we found" is not "nothing is left billing".
    expect(body.confirmed).toBe(false)
    expect(body.lookupErrors.join(' ')).toMatch(/metadata\.orgId/)
  })

  it('a refused write reads back as NOT confirmed, with Stripe’s message', async () => {
    stripe.failWrites = true
    const { status, body } = await post({
      orgId: 'org1',
      when: 'now',
      reason: 'fraud',
    })
    expect(status).toBe(200)
    expect(body.confirmed).toBe(false)
    expect(body.changed).toBe(0)
    const live = body.subscriptions.find((step: any) => step.id === 'sub_live')
    expect(live).toMatchObject({ outcome: 'failed', confirmed: false })
    expect(live.error).toMatch(/Stripe is having a moment/)
    expect(live.verified.status).toBe('active')
  })
})

describe('idempotency', () => {
  it('a second cancel-now writes nothing to Stripe and still confirms', async () => {
    await post({ orgId: 'org1', when: 'now', reason: 'fraud' })
    const writesAfterFirst = stripe.writes().length
    const { body } = await post({ orgId: 'org1', when: 'now', reason: 'fraud' })
    expect(stripe.writes()).toHaveLength(writesAfterFirst)
    expect(body.changed).toBe(0)
    expect(body.confirmed).toBe(true)
    expect(body.subscriptions.every((step: any) => step.outcome === 'already-canceled')).toBe(true)
  })

  it('a second period-end cancel does not re-post the schedule', async () => {
    await post({ orgId: 'org1', when: 'period_end', reason: 'customer-request' })
    const { body } = await post({
      orgId: 'org1',
      when: 'period_end',
      reason: 'customer-request',
    })
    expect(stripe.writes()).toHaveLength(1)
    expect(
      body.subscriptions.find((step: any) => step.id === 'sub_live').outcome,
    ).toBe('already-scheduled')
  })

  it('cancel-now still ends a subscription that was only set to end later', async () => {
    await post({ orgId: 'org1', when: 'period_end', reason: 'customer-request' })
    const { body } = await post({ orgId: 'org1', when: 'now', reason: 'fraud' })
    expect(stripe.subscriptions.get('sub_live')!.status).toBe('canceled')
    expect(body.confirmed).toBe(true)
  })
})

describe('the audit row', () => {
  it('records actor, reason, note, when, the outcome — and that nothing was refunded', async () => {
    await post({
      orgId: 'org1',
      when: 'now',
      reason: 'fraud',
      note: 'stolen card',
    })
    expect(mockAuditRows).toHaveLength(1)
    const row = mockAuditRows[0] as any
    expect(row).toMatchObject({
      actorUid: 'staff-1',
      actorEmail: 'ops@aglyn.com',
      action: 'org.subscription-cancel',
      scope: 'org',
      target: 'orgs/org1',
      reason: 'fraud',
      note: 'stolen card',
      via: 'staff-console',
      when: 'now',
      refunded: false,
    })
    expect(row.after).toMatchObject({ changed: 1, confirmed: true })
    expect(row.after.subscriptions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'sub_live',
          outcome: 'canceled',
          status: 'canceled',
        }),
      ]),
    )
    // Stamped through the one audit door, so the audit page can find it.
    expect(row.actionGroup).toBe('org')
    expect(row.searchTokens).toEqual(expect.arrayContaining(['fraud']))
  })

  it('a failed cancel is audited too — the attempt is the row a reviewer needs', async () => {
    stripe.failWrites = true
    await post({ orgId: 'org1', when: 'now', reason: 'fraud' })
    expect(mockAuditRows).toHaveLength(1)
    expect((mockAuditRows[0] as any).after).toMatchObject({
      changed: 0,
      confirmed: false,
    })
  })
})
