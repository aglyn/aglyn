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
 * The billing webhook places an automatic security hold when Stripe flags a
 * workspace's own payment as fraud (AGL-3767), through the real route, the
 * real ledger and the real hold state; only the lock cores and Stripe are
 * stand-ins.
 *
 * The replay is the 2026-10-13 card tester: workspace g6Keotsei4 ("Vinted")
 * put four US cards on one $56 Pro invoice in two minutes. Two charges
 * failed insufficient_funds with a postal-code failure, one Radar blocked at
 * highest risk, two more blocked with Stripe's own fraud report. What the
 * platform did that day was send five "[Should know] Payment failed" pings.
 *
 * And the early fraud warning on a workspace's own charge: refunded once
 * before it can be disputed, never on a connected account's sale.
 */

export {}

import { createHmac } from 'node:crypto'

const CLEAN_ENV = (() => {
  const clean = { ...process.env }
  for (const key of Object.keys(clean)) {
    if (key.startsWith('STRIPE_') || key.startsWith('NEXT_PUBLIC_STRIPE_')) delete clean[key]
  }
  return clean
})()
const ORIGINAL_ENV = process.env

let mockDocs = new Map<string, Record<string, unknown>>()
const mockStaffNotifications: Record<string, unknown>[] = []
const mockOrgLocks: Record<string, unknown>[] = []
const mockHostLocks: Record<string, unknown>[] = []
const mockCancels: Record<string, unknown>[] = []
const mockRaiseOperatorAlert = jest.fn(async (..._args: unknown[]) => ({ outcome: 'delivered' }))

function mockMakeFirestore() {
  const doc = (path: string): any => ({
    id: path.split('/').pop(),
    path,
    create: async (data: Record<string, unknown>) => {
      if (mockDocs.has(path)) throw new Error('ALREADY_EXISTS')
      mockDocs.set(path, { ...data })
    },
    get: async () => ({
      exists: mockDocs.has(path),
      id: path.split('/').pop(),
      data: () => mockDocs.get(path),
      get: (field: string) => (mockDocs.get(path) ?? {})[field],
    }),
    set: async (data: Record<string, unknown>, options?: { merge?: boolean }) => {
      mockDocs.set(path, options?.merge ? { ...mockDocs.get(path), ...data } : { ...data })
    },
    update: async (data: Record<string, unknown>) => {
      if (!mockDocs.has(path)) throw new Error(`5 NOT_FOUND: ${path}`)
      mockDocs.set(path, { ...mockDocs.get(path), ...data })
    },
    delete: async () => {
      mockDocs.delete(path)
    },
    collection: (name: string) => collection(`${path}/${name}`),
  })
  const query = (name: string, filters: [string, unknown][], max: number | null): any => ({
    where: (field: string, op: string, value: unknown) => {
      if (op !== '==') throw new Error(`unmodelled query operator: ${op}`)
      return query(name, [...filters, [field, value]], max)
    },
    limit: (count: number) => query(name, filters, count),
    get: async () => {
      const matches = [...mockDocs.keys()]
        .filter((path) => path.startsWith(`${name}/`) && path.split('/').length === name.split('/').length + 1)
        .filter((path) => filters.every(([field, value]) => (mockDocs.get(path) ?? {})[field] === value))
        .map((path) => ({
          id: path.split('/').pop(),
          exists: true,
          data: () => mockDocs.get(path),
          get: (field: string) => (mockDocs.get(path) ?? {})[field],
          ref: doc(path),
        }))
      return { docs: max == null ? matches : matches.slice(0, max), empty: matches.length === 0 }
    },
  })
  const collection = (name: string): any => ({
    doc: (id: string) => doc(`${name}/${id}`),
    add: async (data: Record<string, unknown>) => {
      const id = `auto-${mockDocs.size}`
      mockDocs.set(`${name}/${id}`, { ...data })
      return { id }
    },
    where: (field: string, op: string, value: unknown) => query(name, [], null).where(field, op, value),
  })
  return {
    runTransaction: async <T,>(work: (transaction: Record<string, unknown>) => Promise<T>): Promise<T> =>
      work({
        get: (ref: { get: () => Promise<unknown> }) => ref.get(),
        set: (ref: { set: (data: unknown, options?: unknown) => Promise<unknown> }, data: unknown, options?: unknown) =>
          ref.set(data, options),
      }),
    collection,
  }
}

jest.mock('next/server', () => ({ after: (work: () => unknown) => work() }))

jest.mock('@aglyn/aglyn/server', () => ({
  __esModule: true,
  formatOperatorAlertAmount: jest.requireActual('../../../libs/aglyn/src/lib/app-utils/operator-alerts')
    .formatOperatorAlertAmount,
  runPluginEventHandlers: async () => ({ handled: 0, failed: [] }),
  classifyDeliveryLag: jest.requireActual('@aglyn/aglyn/app-utils/webhook-delivery').classifyDeliveryLag,
  classifyWebhookDelivery: jest.requireActual('@aglyn/aglyn/app-utils/webhook-delivery').classifyWebhookDelivery,
  createWebhookEffectLedger: jest.requireActual('@aglyn/aglyn/app-utils/webhook-delivery').createWebhookEffectLedger,
  observeWrites: jest.requireActual('@aglyn/aglyn/app-utils/webhook-delivery').observeWrites,
  NOTIFICATION_TYPE_LABELS: { 'staff.paymentFailed': 'Payment failed' },
  buildRoute: (_route: string, params?: Record<string, string>) => `/admin/orgs/${params?.['orgId'] ?? ''}`,
  Route: { ADMIN_ORG_DETAIL: 'ADMIN_ORG_DETAIL', ADMIN_OVERVIEW: 'ADMIN_OVERVIEW', MANAGE_BILLING: 'MANAGE_BILLING' },
  runBillingWebhookHandlers: async () => ({ claimed: false, hostIds: [] }),
  SELF_SERVE_PLANS: ['free', 'starter', 'pro', 'business', 'scale', 'advanced', 'agency'],
  PLAN_PRICING: {},
  POS_REGISTER_ADDON_MONTHLY_USD: 89,
  EVENT_CALENDAR_ADDON_MONTHLY_USD: 9,
}))

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  raiseOperatorAlert: (...args: unknown[]) => mockRaiseOperatorAlert(...args),
  firebaseAdmin: {
    app: () => ({ firestore: () => mockMakeFirestore() }),
    firestore: { FieldValue: { delete: () => '__delete__', serverTimestamp: () => '__now__' } },
  },
  findOrgIdByStripeCustomer: async (customerId: string) =>
    customerId === 'cus_vinted' ? 'g6Keotsei4' : customerId === 'cus_old' ? 'org-old' : null,
  findUserByUidAcrossPools: async (uid: string) => ({ tenantId: null, record: { uid, customClaims: {} } }),
  notifyOrgAdmins: async () => undefined,
  notifyStaff: async (payload: Record<string, unknown>) => {
    mockStaffNotifications.push(payload)
  },
  notifyRiskEvent: async () => ({ duplicate: false }),
  sendGa4Purchase: async () => ({ sent: true, synthesizedClientId: true }),
  sendGa4Refund: async () => ({ sent: true, synthesizedClientId: true }),
  sendGa4SubscriptionCancelled: async () => ({ sent: true, synthesizedClientId: true }),
  writeOrgBilling: async () => undefined,
  updateExisting: async () => true,
}))

jest.mock('../utils/server-plugin-loader', () => ({
  __esModule: true,
  serverPluginLoader: { ensureAll: async () => undefined },
}))

jest.mock('@aglyn/aglyn/plugin-manager/plugin-org-lockdown', () => ({
  __esModule: true,
  runOrgLockdownParticipants: async () => [],
}))

jest.mock('../utils/server/org-lockdown', () => ({
  __esModule: true,
  applyOrgLockdown: async (options: Record<string, any>) => {
    mockOrgLocks.push(options)
    mockDocs.set(`orgs/${options['orgId']}`, { ...mockDocs.get(`orgs/${options['orgId']}`), suspendedAt: 1 })
    return { orgId: options['orgId'], action: 'lock', membersUpdated: 1, tokensRevoked: 1, downloadTokensRotated: [] }
  },
  applyHostLockdown: async (options: Record<string, any>) => {
    mockHostLocks.push(options)
    mockDocs.set(`hosts/${options['hostId']}`, { ...mockDocs.get(`hosts/${options['hostId']}`), suspendedAt: 1 })
    return { hostId: options['hostId'], action: 'lock', revalidated: { ok: true }, downloadTokensRotated: [] }
  },
}))

jest.mock('../utils/server/lockdown-owner-notice', () => ({
  __esModule: true,
  lockdownNoticeReference: (scope: string, targetId: string) => `LK-${scope}-${targetId}`,
  sendLockdownOwnerNotice: async () => ({ attempted: true, confirmed: true }),
}))

jest.mock('../utils/server/org-subscription-cancel', () => ({
  __esModule: true,
  cancellationComment: () => 'Aglyn lockdown: security',
  cancelOrgSubscriptions: async (options: Record<string, any>) => {
    mockCancels.push(options)
    return { orgId: options['orgId'], when: 'now', confirmed: true, changed: 1, lookupErrors: [], subscriptions: [] }
  },
  auditOrgSubscriptionCancel: async () => undefined,
}))

function signed(body: unknown) {
  const payload = JSON.stringify(body)
  const timestamp = Math.floor(Date.now() / 1000)
  const signature = createHmac('sha256', 'whsec_fake').update(`${timestamp}.${payload}`).digest('hex')
  return new Request('https://app.aglyn.com/api/billing/webhook', {
    method: 'POST',
    headers: { 'stripe-signature': `t=${timestamp},v1=${signature}`, 'content-type': 'application/json' },
    body: payload,
  })
}

let eventCounter = 0
const event = (type: string, object: Record<string, unknown>, id?: string) => ({
  id: id ?? `evt_${(eventCounter += 1)}`,
  type,
  livemode: false,
  created: Math.floor(Date.now() / 1000),
  data: { object },
})

function loadWebhook(env: Record<string, string> = {}) {
  jest.resetModules()
  process.env = { ...CLEAN_ENV, STRIPE_WEBHOOK_SECRET: 'whsec_fake', ...env } as NodeJS.ProcessEnv
  return require('../app/api/billing/webhook/route').POST as (request: Request) => Promise<Response>
}

/** A failed charge as `charge.failed` delivers it. */
function failedCharge(id: string, fingerprint: string, outcome: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  return {
    id,
    object: 'charge',
    amount: 5600,
    currency: 'usd',
    customer: 'cus_vinted',
    payment_intent: 'pi_3UQBbYDYHP4psn7h2',
    status: 'failed',
    outcome,
    fraud_details: {},
    payment_method_details: {
      card: { fingerprint, country: 'US', brand: 'visa', last4: fingerprint.slice(-4), checks: { address_postal_code_check: 'fail' } },
    },
    ...extra,
  }
}

const INSUFFICIENT = { type: 'issuer_declined', risk_level: 'normal', reason: null }
const BLOCKED = { type: 'blocked', risk_level: 'highest', reason: 'highest_risk_level' }

const VINTED = [
  failedCharge('ch_3UQBbYDYHP4psn7h2Lgg4cEL', 'fp_card_0001', INSUFFICIENT, { failure_code: 'card_declined' }),
  failedCharge('ch_3UQBbYDYHP4psn7h2DdPXmoe', 'fp_card_0002', INSUFFICIENT, { failure_code: 'card_declined' }),
  failedCharge('ch_3UQBbYDYHP4psn7h2nvPTfSZ', 'fp_card_0003', BLOCKED),
  failedCharge('ch_3UQBbYDYHP4psn7h25lPwOTp', 'fp_card_0004', BLOCKED, { fraud_details: { stripe_report: 'fraudulent' } }),
  failedCharge('ch_3UQBbYDYHP4psn7h29norWo8', 'fp_card_0004', BLOCKED, { fraud_details: { stripe_report: 'fraudulent' } }),
]

const INVOICE_FAILED = {
  id: 'in_vinted',
  object: 'invoice',
  customer: 'cus_vinted',
  amount_due: 5600,
  currency: 'usd',
  lines: { data: [] },
}

const holdAlerts = () =>
  mockRaiseOperatorAlert.mock.calls.filter(([type]) => type === 'security.paymentFraudHold')
const staffPaymentFailed = () => mockStaffNotifications.filter((entry) => entry['type'] === 'staff.paymentFailed')
const inertAlerts = () => mockRaiseOperatorAlert.mock.calls.filter(([type]) => type === 'billing.webhookInert')

let stripeWrites: string[] = []
let chargeReplies: Record<string, Record<string, unknown>> = {}

beforeEach(() => {
  mockDocs = new Map()
  mockDocs.set('orgs/g6Keotsei4', {
    name: 'Vinted',
    slug: 'vinted',
    plan: 'free',
    ownerUid: 'owner-v',
    createdAt: Date.now() - 60 * 60_000,
    hosts: { 'host-ebay': true },
  })
  mockDocs.set('hosts/host-ebay', { name: 'Ebay', orgId: 'g6Keotsei4' })
  mockDocs.set('orgs/org-old', {
    name: 'Old Co',
    slug: 'old',
    plan: 'pro',
    ownerUid: 'owner-o',
    createdAt: Date.now() - 90 * 24 * 60 * 60_000,
    hosts: { 'host-old': true },
  })
  for (const list of [mockStaffNotifications, mockOrgLocks, mockHostLocks, mockCancels]) list.length = 0
  mockRaiseOperatorAlert.mockClear()
  stripeWrites = []
  chargeReplies = {}
  global.fetch = jest.fn(async (input: unknown, init?: { method?: string; headers?: Record<string, string>; body?: string }) => {
    const url = String(input)
    const method = String(init?.method ?? 'GET').toUpperCase()
    if (url.includes('api.stripe.com/v1/charges/')) {
      const id = decodeURIComponent(url.split('/v1/charges/')[1] ?? '')
      const reply = chargeReplies[id]
      return { ok: Boolean(reply), status: reply ? 200 : 404, json: async () => reply ?? {} }
    }
    if (url.includes('api.stripe.com/v1/refunds') && method === 'POST') {
      stripeWrites.push(`POST refunds ${init?.headers?.['Idempotency-Key']} ${init?.body}`)
      return { ok: true, status: 200, json: async () => ({ id: `re_${stripeWrites.length}`, amount: 5600 }) }
    }
    if (url.includes('api.stripe.com')) stripeWrites.push(`${method} ${url}`)
    return { ok: true, status: 200, json: async () => ({}) }
  }) as never
  jest.spyOn(console, 'warn').mockImplementation(() => undefined)
  jest.spyOn(console, 'error').mockImplementation(() => undefined)
})

afterEach(() => {
  process.env = ORIGINAL_ENV
  jest.restoreAllMocks()
})

describe('a workspace’s own failed charge flagged as fraud places a security hold (AGL-3767)', () => {
  it('replays 2026-10-13: one hold at the first highest-risk block, one alert, and the pings collapse', async () => {
    const post = loadWebhook()
    // The first attempt fails before anything is flagged: staff hear it once.
    expect((await post(signed(event('charge.failed', VINTED[0])))).status).toBe(200)
    expect((await post(signed(event('invoice.payment_failed', INVOICE_FAILED)))).status).toBe(200)
    expect(staffPaymentFailed()).toHaveLength(1)
    await post(signed(event('charge.failed', VINTED[1])))
    expect(mockOrgLocks).toEqual([])
    // Radar blocks the third card at highest risk: the hold.
    await post(signed(event('charge.failed', VINTED[2])))
    expect(mockOrgLocks).toEqual([
      expect.objectContaining({
        orgId: 'g6Keotsei4',
        lock: { reason: 'security', mode: 'full', enforcement: 'takedown' },
      }),
    ])
    expect(mockHostLocks).toEqual([expect.objectContaining({ hostId: 'host-ebay' })])
    expect(mockCancels).toEqual([expect.objectContaining({ orgId: 'g6Keotsei4', when: 'now' })])
    // Every further card and every further failed invoice is the same event.
    for (const charge of VINTED.slice(3)) {
      await post(signed(event('charge.failed', charge)))
      await post(signed(event('invoice.payment_failed', INVOICE_FAILED)))
    }
    expect(mockOrgLocks).toHaveLength(1)
    expect(holdAlerts()).toHaveLength(1)
    expect(staffPaymentFailed()).toHaveLength(1)
    expect(holdAlerts()[0][1]).toMatchObject({
      dedupeKey: 'g6Keotsei4',
      context: { orgName: 'Vinted', action: 'Security hold placed', cardCountries: 'US', cards: '3' },
    })
    const row = [...mockDocs.entries()].find(([path, value]) => path.startsWith('abuseReports/') && value['source'] === 'stripe-payment-fraud-hold')?.[1]
    expect(row).toMatchObject({
      orgId: 'g6Keotsei4',
      severity: 'urgent',
      paymentFraudHold: {
        trigger: 'radar-blocked',
        chargeIds: ['ch_3UQBbYDYHP4psn7h2Lgg4cEL', 'ch_3UQBbYDYHP4psn7h2DdPXmoe', 'ch_3UQBbYDYHP4psn7h2nvPTfSZ'],
        riskLevels: ['normal', 'highest'],
        fingerprints: ['fp_card_0001', 'fp_card_0002', 'fp_card_0003'],
      },
    })
    expect(mockDocs.get('paymentFraudHolds/g6Keotsei4')).toMatchObject({ state: 'held' })
    // Every delivery accounted for: none of them read as inert.
    expect(inertAlerts()).toEqual([])
  })

  it('a charge Stripe reported fraudulent places the hold on its own', async () => {
    const post = loadWebhook()
    await post(signed(event('charge.failed', VINTED[3])))
    expect(mockOrgLocks).toHaveLength(1)
    expect(mockDocs.get('paymentFraudHolds/g6Keotsei4')).toMatchObject({ trigger: 'stripe-reported-fraud', state: 'held' })
  })

  it('card cycling: three different cards declined within 30 minutes, none of them flagged', async () => {
    const post = loadWebhook()
    await post(signed(event('charge.failed', failedCharge('ch_a', 'fp_a', INSUFFICIENT))))
    await post(signed(event('charge.failed', failedCharge('ch_b', 'fp_a', INSUFFICIENT))))
    await post(signed(event('charge.failed', failedCharge('ch_c', 'fp_b', INSUFFICIENT))))
    // One card retried, and a second card: a customer, not a tester.
    expect(mockOrgLocks).toEqual([])
    await post(signed(event('charge.failed', failedCharge('ch_d', 'fp_c', INSUFFICIENT))))
    expect(mockOrgLocks).toHaveLength(1)
    expect(mockDocs.get('paymentFraudHolds/g6Keotsei4')).toMatchObject({ trigger: 'card-cycling', state: 'held' })
  })

  it('an ordinary declined charge is recorded, holds nothing, and is not inert', async () => {
    const post = loadWebhook()
    await post(signed(event('charge.failed', failedCharge('ch_once', 'fp_once', INSUFFICIENT))))
    expect(mockOrgLocks).toEqual([])
    expect(holdAlerts()).toEqual([])
    expect(inertAlerts()).toEqual([])
  })

  it('a failed charge that is no workspace’s — a shopper’s — is skipped by name, never held', async () => {
    const post = loadWebhook()
    const response = await post(
      signed(event('charge.failed', failedCharge('ch_shop', 'fp_shop', BLOCKED, { customer: 'cus_shopper' }))),
    )
    expect(response.status).toBe(200)
    expect(mockOrgLocks).toEqual([])
    expect([...mockDocs.keys()].some((path) => path.startsWith('paymentFraudHolds/'))).toBe(false)
    expect(inertAlerts()).toEqual([])
  })

  it('a redelivered charge, under the same or a new event id, adds and holds nothing more', async () => {
    const post = loadWebhook()
    const first = event('charge.failed', VINTED[2], 'evt_same')
    await post(signed(first))
    await post(signed(first))
    await post(signed(event('charge.failed', VINTED[2])))
    expect(mockOrgLocks).toHaveLength(1)
    expect(holdAlerts()).toHaveLength(1)
    expect((mockDocs.get('paymentFraudHolds/g6Keotsei4')?.['failures'] as unknown[]).length).toBe(1)
  })

  it('a workspace 14+ days old is alerted about once and never locked, and its pings are not collapsed', async () => {
    const post = loadWebhook()
    const old = (id: string) => failedCharge(id, `fp_${id}`, BLOCKED, { customer: 'cus_old' })
    await post(signed(event('charge.failed', old('ch_o1'))))
    await post(signed(event('charge.failed', old('ch_o2'))))
    expect(mockOrgLocks).toEqual([])
    expect(mockCancels).toEqual([])
    expect(holdAlerts()).toHaveLength(1)
    expect(holdAlerts()[0][1]).toMatchObject({ context: { action: 'Not locked — needs a decision' } })
    await post(signed(event('invoice.payment_failed', { ...INVOICE_FAILED, customer: 'cus_old' })))
    expect(staffPaymentFailed()).toHaveLength(1)
  })
})

describe('an early fraud warning on a workspace’s own charge is refunded before it is a dispute', () => {
  const EFW = (id: string, charge: string, actionable = true) => ({
    id,
    object: 'radar.early_fraud_warning',
    charge,
    fraud_type: 'unauthorized_use_of_card',
    actionable,
  })
  const OWN_CHARGE = {
    id: 'ch_paid_stolen',
    amount: 5600,
    amount_refunded: 0,
    refunded: false,
    disputed: false,
    currency: 'usd',
    customer: 'cus_vinted',
    payment_method_details: { card: { country: 'US', checks: {} } },
    outcome: { risk_level: 'elevated' },
  }
  const refunds = () => stripeWrites.filter((call) => call.startsWith('POST refunds'))

  beforeEach(() => {
    chargeReplies = { ch_paid_stolen: { ...OWN_CHARGE } }
    // The stolen card DID pay its invoice: the guard must not count that.
    mockDocs.set('platformRevenue/in_stolen', {
      grossCents: 5600,
      orgId: 'g6Keotsei4',
      chargeId: 'ch_paid_stolen',
      paymentIntentId: 'pi_paid_stolen',
    })
  })

  it('refunds in full as fraudulent once, cancels the subscriptions, and places the hold', async () => {
    const post = loadWebhook({ STRIPE_SECRET_KEY: 'sk_test_fake' })
    await post(signed(event('radar.early_fraud_warning.created', EFW('issfr_1', 'ch_paid_stolen'))))
    expect(refunds()).toHaveLength(1)
    expect(refunds()[0]).toContain('efw-refund-issfr_1')
    expect(refunds()[0]).toContain('reason=fraudulent')
    expect(refunds()[0]).toContain('charge=ch_paid_stolen')
    // Canceled once by the refund step; the hold does not cancel again.
    expect(mockCancels).toHaveLength(1)
    expect(mockOrgLocks).toHaveLength(1)
    const row = [...mockDocs.values()].find((value) => value['source'] === 'stripe-fraud-signal')
    expect(row?.['automatedResponse']).toMatchObject({ refund: { outcome: 'refunded' }, hold: { outcome: 'held' } })
    expect(String(row?.['details'])).toContain('Refunded in full as fraudulent')
    // A redelivery, under a new event id: the signal is already on the row.
    await post(signed(event('radar.early_fraud_warning.created', EFW('issfr_1', 'ch_paid_stolen'))))
    expect(refunds()).toHaveLength(1)
    expect(mockCancels).toHaveLength(1)
    expect(holdAlerts()).toHaveLength(1)
  })

  it('skips a charge already refunded, or already disputed', async () => {
    chargeReplies['ch_paid_stolen'] = { ...OWN_CHARGE, refunded: true, amount_refunded: 5600 }
    const post = loadWebhook({ STRIPE_SECRET_KEY: 'sk_test_fake' })
    await post(signed(event('radar.early_fraud_warning.created', EFW('issfr_2', 'ch_paid_stolen'))))
    chargeReplies['ch_paid_stolen'] = { ...OWN_CHARGE, disputed: true }
    await post(signed(event('radar.early_fraud_warning.created', EFW('issfr_3', 'ch_paid_stolen'))))
    expect(refunds()).toEqual([])
  })

  it('skips a warning Stripe marks not actionable', async () => {
    const post = loadWebhook({ STRIPE_SECRET_KEY: 'sk_test_fake' })
    await post(signed(event('radar.early_fraud_warning.created', EFW('issfr_4', 'ch_paid_stolen', false))))
    expect(refunds()).toEqual([])
    const row = [...mockDocs.values()].find((value) => value['source'] === 'stripe-fraud-signal')
    expect(String(row?.['details'])).toContain('not actionable')
  })

  it('never touches a connected-account charge — a seller’s sale keeps alert-only', async () => {
    chargeReplies['ch_shop_sale'] = {
      id: 'ch_shop_sale',
      amount: 9900,
      currency: 'usd',
      customer: 'cus_vinted',
      transfer_data: { destination: 'acct_seller' },
      payment_method_details: { card: { country: 'US', checks: {} } },
      outcome: { risk_level: 'elevated' },
    }
    const post = loadWebhook({ STRIPE_SECRET_KEY: 'sk_test_fake' })
    await post(signed(event('radar.early_fraud_warning.created', EFW('issfr_5', 'ch_shop_sale'))))
    expect(refunds()).toEqual([])
    expect(stripeWrites).toEqual([])
    expect(mockCancels).toEqual([])
    expect(mockOrgLocks).toEqual([])
  })
})
