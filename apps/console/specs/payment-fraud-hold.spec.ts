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
 * The payment-fraud hold, placed (AGL-3767), and an early fraud warning's
 * refund.
 *
 *  - the workspace and each site locked as `security` takedown, never
 *    `abuse`, the owners NOT emailed, the subscriptions canceled, every
 *    lock audited under `system:payment-fraud`;
 *  - one abuse row with the evidence and one operator alert;
 *  - a workspace 14+ days old, or that paid another invoice: alert only;
 *  - placed once, whatever redelivers;
 *  - the warning's refund: once, never on a refunded, disputed,
 *    non-actionable or connected-account charge.
 *
 * The lock cores are the same stand-ins the page-hold spec uses.
 */

let mockStore: Record<string, Record<string, any>> = {}
let mockAuditRows: Array<Record<string, any>> = []
const mockNotices: Array<Record<string, any>> = []
const mockAlerts: Array<{ type: string; options: Record<string, any> }> = []
const mockOrgLocks: Array<Record<string, any>> = []
const mockHostLocks: Array<Record<string, any>> = []
const mockCancels: Array<Record<string, any>> = []
const mockStaffUids = new Set<string>()

jest.mock('firebase-admin/firestore', () => ({
  __esModule: true,
  FieldValue: { serverTimestamp: () => 'SERVER_TIMESTAMP' },
}))

const mockSnapshot = (path: string) => {
  const data = mockStore[path] ? { ...mockStore[path] } : undefined
  return { id: path.split('/').pop(), exists: data !== undefined, data: () => data, get: (field: string) => data?.[field] }
}

const mockDoc = (path: string): any => ({
  path,
  get: async () => mockSnapshot(path),
  set: async (data: Record<string, any>, options?: { merge?: boolean }) => {
    mockStore[path] = options?.merge ? { ...(mockStore[path] ?? {}), ...data } : { ...data }
  },
  collection: (name: string) => mockCollection(`${path}/${name}`),
})

const mockCollection = (path: string): any => ({
  doc: (id: string) => mockDoc(`${path}/${id}`),
  add: async (data: Record<string, any>) => {
    if (path === 'adminAudit') mockAuditRows.push(data)
    return { id: `row-${mockAuditRows.length}` }
  },
  where: (field: string, _op: string, value: unknown) => ({
    limit: () => ({
      get: async () => ({
        docs: Object.keys(mockStore)
          .filter((key) => key.startsWith(`${path}/`) && key.split('/').length === 2 && mockStore[key][field] === value)
          .map(mockSnapshot),
      }),
    }),
  }),
})

const mockFirestore: any = {
  collection: (name: string) => mockCollection(name),
  runTransaction: async (work: (transaction: unknown) => Promise<unknown>) =>
    work({
      get: async (ref: { path: string }) => mockSnapshot(ref.path),
      set: (ref: { path: string }, data: Record<string, any>, options?: { merge?: boolean }) => {
        mockStore[ref.path] = options?.merge ? { ...(mockStore[ref.path] ?? {}), ...data } : { ...data }
      },
    }),
}

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  findUserByUidAcrossPools: async (uid: string) => ({
    tenantId: null,
    record: { uid, customClaims: mockStaffUids.has(uid) ? { staff: true } : {} },
  }),
  notifyRiskEvent: async () => ({ duplicate: false }),
  raiseOperatorAlert: async (type: string, options: Record<string, any>) => {
    mockAlerts.push({ type, options })
    return { outcome: 'delivered', type }
  },
}))

jest.mock('../utils/server/org-lockdown', () => ({
  __esModule: true,
  applyOrgLockdown: async (options: Record<string, any>) => {
    mockOrgLocks.push(options)
    mockStore[`orgs/${options['orgId']}`] = { ...mockStore[`orgs/${options['orgId']}`], suspendedAt: 1 }
    return { orgId: options['orgId'], action: 'lock', membersUpdated: 1, tokensRevoked: 1, downloadTokensRotated: [] }
  },
  applyHostLockdown: async (options: Record<string, any>) => {
    mockHostLocks.push(options)
    mockStore[`hosts/${options['hostId']}`] = { ...mockStore[`hosts/${options['hostId']}`], suspendedAt: 1 }
    return { hostId: options['hostId'], action: 'lock', revalidated: { ok: true }, downloadTokensRotated: [] }
  },
}))

jest.mock('../utils/server/lockdown-owner-notice', () => ({
  __esModule: true,
  lockdownNoticeReference: (scope: string, targetId: string) => `LK-${scope}-${targetId}`,
  sendLockdownOwnerNotice: async (input: Record<string, any>) => {
    mockNotices.push(input)
    return { attempted: true, confirmed: true }
  },
}))

jest.mock('../utils/server/org-subscription-cancel', () => ({
  __esModule: true,
  cancellationComment: (options: Record<string, any>) => `Aglyn ${options['via']}: ${options['reason']}`,
  cancelOrgSubscriptions: async (options: Record<string, any>) => {
    mockCancels.push(options)
    return { orgId: options['orgId'], when: 'now', confirmed: true, changed: 1, lookupErrors: [], subscriptions: [] }
  },
  auditOrgSubscriptionCancel: async () => undefined,
}))

jest.mock('../utils/server-plugin-loader', () => ({
  __esModule: true,
  serverPluginLoader: { ensureAll: async () => undefined },
}))

jest.mock('@aglyn/aglyn/plugin-manager/plugin-org-lockdown', () => ({
  __esModule: true,
  runOrgLockdownParticipants: async () => [],
}))

import {
  paymentFraudHoldReviewId,
  placePaymentFraudHold,
  refundEarlyFraudWarningCharge,
  workspaceFraudSignalResponder,
} from '../utils/server/payment-fraud-hold'

const NOW = Date.parse('2026-10-13T18:00:00Z')

const CHARGES = [
  {
    chargeId: 'ch_3UQBbYDYHP4psn7h2nvPTfSZ',
    paymentIntentId: 'pi_v',
    invoiceId: 'in_v',
    fingerprint: 'fp_1',
    cardCountry: 'US',
    cardBrand: 'visa',
    last4: '0001',
    outcomeType: 'blocked',
    outcomeReason: 'highest_risk_level',
    riskLevel: 'highest',
    riskScore: 95,
    stripeReport: null,
    failureCode: 'card_declined',
    declineCode: null,
    postalCheck: null,
    cvcCheck: null,
    amountCents: 5600,
    currency: 'usd',
    atMs: NOW,
  },
  {
    chargeId: 'ch_3UQBbYDYHP4psn7h25lPwOTp',
    paymentIntentId: 'pi_v',
    invoiceId: 'in_v',
    fingerprint: 'fp_2',
    cardCountry: 'US',
    cardBrand: 'mastercard',
    last4: '0002',
    outcomeType: 'blocked',
    outcomeReason: 'highest_risk_level',
    riskLevel: 'highest',
    riskScore: 97,
    stripeReport: 'fraudulent',
    failureCode: 'card_declined',
    declineCode: null,
    postalCheck: null,
    cvcCheck: null,
    amountCents: 5600,
    currency: 'usd',
    atMs: NOW,
  },
]

const hold = (overrides: Record<string, unknown> = {}) =>
  placePaymentFraudHold({
    firestore: mockFirestore,
    orgId: 'g6Keotsei4',
    trigger: 'stripe-reported-fraud',
    charges: CHARGES,
    livemode: true,
    nowMs: NOW,
    ...overrides,
  })

beforeEach(() => {
  mockAuditRows = []
  for (const list of [mockNotices, mockAlerts, mockOrgLocks, mockHostLocks, mockCancels]) list.length = 0
  mockStaffUids.clear()
  delete process.env['PLATFORM_MARKETING_HOST_ID']
  mockStore = {
    'orgs/g6Keotsei4': {
      name: 'Vinted',
      ownerUid: 'owner-1',
      createdAt: NOW - 2 * 60 * 60_000,
      hosts: { 'host-a': true, 'host-b': true },
    },
    'hosts/host-a': { name: 'Ebay' },
    'hosts/host-b': { name: 'Second' },
  }
  jest.spyOn(console, 'error').mockImplementation(() => undefined)
})

afterEach(() => jest.restoreAllMocks())

describe('the payment-fraud hold', () => {
  it('locks the workspace and every site as a security takedown, never abuse, and mails no owner', async () => {
    const result = await hold()
    expect(result).toMatchObject({ outcome: 'held', reason: null })
    const lock = { reason: 'security', mode: 'full', enforcement: 'takedown' }
    expect(mockOrgLocks).toEqual([
      expect.objectContaining({ orgId: 'g6Keotsei4', action: 'lock', lock, revokeMemberTokens: true }),
    ])
    expect(mockHostLocks.map((entry) => [entry['hostId'], entry['lock']])).toEqual([
      ['host-a', lock],
      ['host-b', lock],
    ])
    expect(mockNotices.map((notice) => [notice['scope'], notice['emailOwners']])).toEqual([
      ['org', false],
      ['host', false],
      ['host', false],
    ])
    expect(mockCancels).toEqual([expect.objectContaining({ orgId: 'g6Keotsei4', when: 'now' })])
    expect(mockStore['paymentFraudHolds/g6Keotsei4']).toMatchObject({ state: 'held', heldAtMs: NOW })
  })

  it('audits every lock under system:payment-fraud with the trigger, the charges and the row', async () => {
    await hold()
    expect(mockAuditRows.map((row) => row['target'])).toEqual(['orgs/g6Keotsei4', 'hosts/host-a', 'hosts/host-b'])
    for (const row of mockAuditRows) {
      expect(row).toMatchObject({
        actorUid: 'system:payment-fraud',
        action: 'lockdown.lock',
        after: { locked: true, reason: 'security', enforcement: 'takedown', automated: true, trigger: 'stripe-reported-fraud' },
      })
      expect(row['note']).toContain('ch_3UQBbYDYHP4psn7h25lPwOTp')
    }
  })

  it('files one abuse row with the evidence and raises one alert', async () => {
    await hold()
    const row = mockStore[`abuseReports/${paymentFraudHoldReviewId('g6Keotsei4')}`]
    expect(row).toMatchObject({
      category: 'phishing',
      severity: 'urgent',
      source: 'stripe-payment-fraud-hold',
      orgId: 'g6Keotsei4',
      status: 'open',
      paymentFraudHold: {
        trigger: 'stripe-reported-fraud',
        chargeIds: ['ch_3UQBbYDYHP4psn7h2nvPTfSZ', 'ch_3UQBbYDYHP4psn7h25lPwOTp'],
        riskLevels: ['highest'],
        cardCountries: ['US'],
        fingerprints: ['fp_1', 'fp_2'],
        outcome: 'held',
      },
    })
    expect(row['details']).toContain('fingerprint fp_2')
    expect(mockAlerts).toHaveLength(1)
    expect(mockAlerts[0]).toMatchObject({
      type: 'security.paymentFraudHold',
      options: { dedupeKey: 'g6Keotsei4', context: { orgName: 'Vinted', action: 'Security hold placed', cardCountries: 'US' } },
    })
  })

  it('is placed once: a redelivery or the next card locks, cancels and alerts nothing more', async () => {
    await hold()
    const again = await hold({ trigger: 'card-cycling' })
    expect(again).toMatchObject({ outcome: 'already', reason: 'held' })
    expect(mockOrgLocks).toHaveLength(1)
    expect(mockCancels).toHaveLength(1)
    expect(mockAlerts).toHaveLength(1)
  })

  it('a workspace 14 or more days old is alerted about and never locked', async () => {
    mockStore['orgs/g6Keotsei4']['createdAt'] = NOW - 14 * 24 * 60 * 60_000
    const result = await hold()
    expect(result.outcome).toBe('alert-only')
    expect(mockOrgLocks).toEqual([])
    expect(mockHostLocks).toEqual([])
    expect(mockCancels).toEqual([])
    expect(mockAlerts).toHaveLength(1)
    expect(mockAlerts[0].options['context']['action']).toBe('Not locked — needs a decision')
    expect(mockStore['paymentFraudHolds/g6Keotsei4']).toMatchObject({ state: 'alerted' })
    // …and once per window.
    await hold({ trigger: 'card-cycling' })
    expect(mockAlerts).toHaveLength(1)
  })

  it('a workspace that has paid an invoice before is alerted about and never locked', async () => {
    mockStore['platformRevenue/in_old'] = { orgId: 'g6Keotsei4', grossCents: 5600, chargeId: 'ch_old' }
    const result = await hold()
    expect(result.outcome).toBe('alert-only')
    expect(mockOrgLocks).toEqual([])
    expect(mockCancels).toEqual([])
  })

  it('leaves a lock staff already placed exactly as it was set', async () => {
    mockStore['orgs/g6Keotsei4'] = { ...mockStore['orgs/g6Keotsei4'], suspendedAt: 5, suspendedReasonCode: 'abuse' }
    const result = await hold()
    expect(mockOrgLocks).toEqual([])
    expect(result.steps.find((step) => step.scope === 'org')?.outcome).toBe('already-locked')
    expect(mockStore['orgs/g6Keotsei4']['suspendedReasonCode']).toBe('abuse')
  })

  it('never holds the house workspace or one a staff account owns', async () => {
    mockStaffUids.add('owner-1')
    expect((await hold()).outcome).toBe('skipped')
    expect(mockOrgLocks).toEqual([])
    expect(mockAlerts).toEqual([])
  })

  it('releases its claim when it throws, so Stripe’s retry places it', async () => {
    const broken = {
      ...mockFirestore,
      collection: (name: string) =>
        name === 'platformRevenue'
          ? { where: () => ({ limit: () => ({ get: async () => Promise.reject(new Error('UNAVAILABLE')) }) }) }
          : mockFirestore.collection(name),
    }
    await expect(hold({ firestore: broken })).rejects.toThrow('UNAVAILABLE')
    expect(mockStore['paymentFraudHolds/g6Keotsei4']).toMatchObject({ state: 'watching' })
    expect((await hold()).outcome).toBe('held')
  })
})

describe('an early fraud warning on a workspace’s own charge is refunded before it is a dispute', () => {
  const calls: Array<{ url: string; method: string; headers: Record<string, string>; body: string }> = []
  const chargeState: Record<string, any> = {}
  const fetchImpl = (async (url: string, init: any = {}) => {
    calls.push({ url, method: init.method ?? 'GET', headers: init.headers ?? {}, body: String(init.body ?? '') })
    if (url.includes('/v1/charges/')) return { ok: true, status: 200, json: async () => ({ ...chargeState }) }
    return { ok: true, status: 200, json: async () => ({ id: 're_1', amount: 5600 }) }
  }) as unknown as typeof fetch

  beforeEach(() => {
    calls.length = 0
    for (const key of Object.keys(chargeState)) delete chargeState[key]
    Object.assign(chargeState, { id: 'ch_efw', amount: 5600, amount_refunded: 0, refunded: false, disputed: false })
  })

  const refund = (overrides: Record<string, unknown> = {}) =>
    refundEarlyFraudWarningCharge({
      efwId: 'issfr_1',
      chargeId: 'ch_efw',
      actionable: true,
      connectAccount: null,
      secretKey: 'sk_test_x',
      fetchImpl,
      ...overrides,
    })

  it('refunds in full as fraudulent under the warning’s idempotency key', async () => {
    expect(await refund()).toMatchObject({ outcome: 'refunded', refundId: 're_1', amountCents: 5600 })
    const post = calls.find((call) => call.method === 'POST')!
    expect(post.url).toBe('https://api.stripe.com/v1/refunds')
    expect(post.headers['Idempotency-Key']).toBe('efw-refund-issfr_1')
    const body = new URLSearchParams(post.body)
    expect(body.get('charge')).toBe('ch_efw')
    expect(body.get('reason')).toBe('fraudulent')
    expect(body.has('amount')).toBe(false)
  })

  it('skips a charge already refunded, or already disputed', async () => {
    chargeState['refunded'] = true
    expect((await refund()).outcome).toBe('already-refunded')
    chargeState['refunded'] = false
    chargeState['disputed'] = true
    expect((await refund()).outcome).toBe('disputed')
    expect(calls.filter((call) => call.method === 'POST')).toEqual([])
  })

  it('skips a warning Stripe marks not actionable, without a call', async () => {
    expect((await refund({ actionable: false })).outcome).toBe('not-actionable')
    expect(calls).toEqual([])
  })

  it('never touches a connected-account charge', async () => {
    expect((await refund({ connectAccount: 'acct_seller' })).outcome).toBe('connected-account')
    expect(calls).toEqual([])
    chargeState['transfer_data'] = { destination: 'acct_seller' }
    expect((await refund()).outcome).toBe('connected-account')
    expect(calls.filter((call) => call.method === 'POST')).toEqual([])
  })
})

describe('the responder a new warning or review on a workspace charge gets', () => {
  const signal = {
    kind: 'radar-review' as const,
    stripeObjectId: 'prv_1',
    chargeId: 'ch_r',
    paymentIntentId: 'pi_r',
    orgId: 'g6Keotsei4',
    amountCents: 5600,
    currency: 'usd',
    detail: 'rule',
    checks: { cvcCheck: 'pass', addressPostalCodeCheck: 'fail', cardCountry: 'US', riskLevel: 'elevated', threeDSecure: null },
    livemode: true,
  }

  it('a review places the hold on the signal’s own row, refunding nothing', async () => {
    const respond = workspaceFraudSignalResponder({
      firestore: mockFirestore,
      actionable: false,
      connectAccount: null,
      sellerAccountId: null,
      nowMs: NOW,
    })
    const answer = await respond({ signal, reviewId: 'row-1', reference: 'PF-ROW1' })
    expect(answer?.summary).toContain('Automatic security hold placed')
    expect(answer?.record['refund']).toBeUndefined()
    expect(mockStore['abuseReports/row-1']).toMatchObject({
      paymentFraudHold: { trigger: 'radar-review', chargeIds: ['ch_r'], cardCountries: ['US'], riskLevels: ['elevated'] },
      securityHold: { orgId: 'g6Keotsei4' },
    })
    expect(mockStore[`abuseReports/${paymentFraudHoldReviewId('g6Keotsei4')}`]).toBeUndefined()
  })
})
