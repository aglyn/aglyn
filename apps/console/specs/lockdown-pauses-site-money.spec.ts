/**
 * @jest-environment node
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
 * A security lock stops a tenant's money, and the lift puts back exactly
 * what it stopped (AGL-3364).
 *
 * A locked storefront kept renewing its members' subscriptions and kept
 * paying out to the seller. An org or host lock can now pause both — the
 * membership renewals its sites sell (`pause_collection[behavior]=void`) and
 * the seller's connected account (manual payouts) — and the properties that
 * matter:
 *
 *  - it runs AFTER the lock, and a failed Stripe call never undoes the lock;
 *  - the subscriptions come from the selling plugin's own records, through
 *    the core `recurring-charge-sources` contract, never a Stripe search;
 *  - the lift resumes exactly the subscriptions this lock paused; one the
 *    merchant had paused before stays paused;
 *  - the lift restores exactly the saved payout schedule;
 *  - a Standard account is "not controllable", not a failure;
 *  - only an explicit flag pauses; the console defaults it for `security`.
 *
 * Stripe is the stateful double; nothing leaves the process. Firestore is an
 * in-memory map.
 */

import { lockdownPausesSiteMoneyByDefault } from '../constants/subscription-cancel'
import {
  registerRecurringChargeSource,
} from '@aglyn/aglyn/plugin-manager/plugin-recurring-charges'
import { resetPluginServicesForTests } from '@aglyn/aglyn/plugin-manager/plugin-services'
import {
  installStripeDouble,
  subscription,
  type StripeDouble,
} from './stripe-subscriptions-double'

let mockStore: Record<string, Record<string, any>> = {}
let mockAuditRows: Record<string, any>[] = []
const mockDecodedToken: Record<string, unknown> = {}

jest.mock('firebase-admin/firestore', () => ({
  __esModule: true,
  FieldValue: { serverTimestamp: () => 'SERVER_TIMESTAMP' },
}))

const mockDocRef = (path: string): any => ({
  id: path.split('/').pop(),
  path,
  get: async () => mockSnapshot(path),
  set: async (data: Record<string, unknown>, options?: { merge?: boolean }) => {
    mockStore[path] = options?.merge ? { ...(mockStore[path] ?? {}), ...data } : { ...data }
  },
  delete: async () => {
    delete mockStore[path]
  },
})

const mockSnapshot = (path: string) => {
  const data = mockStore[path] ? { ...mockStore[path] } : undefined
  return {
    id: path.split('/').pop(),
    exists: data !== undefined,
    ref: mockDocRef(path),
    data: () => data,
    get: (field: string) => data?.[field],
  }
}

const mockQuery = (collection: string, match: (data: any) => boolean) => {
  const get = async () => ({
    docs: Object.keys(mockStore)
      .filter(
        (path) =>
          path.startsWith(`${collection}/`) &&
          path.split('/').length === 2 &&
          match(mockStore[path]),
      )
      .map(mockSnapshot),
  })
  return { get, limit: () => ({ get }) }
}

const mockFirestore = {
  collection: (collection: string) => ({
    add: async (data: Record<string, unknown>) => {
      if (collection !== 'adminAudit') throw new Error(`unexpected add: ${collection}`)
      mockAuditRows.push(data)
      return { id: `audit-${mockAuditRows.length}` }
    },
    doc: (id: string) => mockDocRef(`${collection}/${id}`),
    where: (field: string, op: string, value: unknown) =>
      mockQuery(collection, (data) =>
        op === 'array-contains'
          ? Array.isArray(data?.[field]) && data[field].includes(value)
          : data?.[field] === value,
      ),
    limit: () => ({ get: async () => ({ docs: [] }) }),
  }),
}

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  invalidateTokenRevocationCache: () => undefined,
  firebaseAdmin: {
    app: () => ({
      auth: () => ({ verifyIdToken: async () => mockDecodedToken }),
      firestore: () => mockFirestore,
    }),
  },
  isImpersonationSession: () => false,
  emailUnverifiedResponse: () =>
    Response.json({ error: 'Verify your email' }, { status: 403 }),
  authForPool: () => ({
    updateUser: async () => undefined,
    revokeRefreshTokens: async () => undefined,
  }),
  findUserByUidAcrossPools: async (uid: string) => ({
    tenantId: null,
    record: { uid, customClaims: {} },
  }),
  invalidateDomainLockdownCache: () => undefined,
  invalidateFeatureLockdownCache: () => undefined,
  invalidatePlatformLockdownCache: () => undefined,
  invalidateUserLockdownCache: () => undefined,
  readSignupsCreationTriggerStatus: async () => ({
    status: 'unknown',
    reason: 'not probed in tests',
  }),
  readOrgBilling: async () => ({}),
}))

const suspend = (path: string, action: string) => {
  const doc = { ...(mockStore[path] ?? {}) }
  if (action === 'lock') doc['suspendedAt'] = Date.now()
  else delete doc['suspendedAt']
  mockStore[path] = doc
}

jest.mock('../utils/server/org-lockdown', () => ({
  __esModule: true,
  applyOrgLockdown: async (options: { orgId: string; action: string }) => {
    suspend(`orgs/${options.orgId}`, options.action)
    return {
      orgId: options.orgId,
      action: options.action,
      membersUpdated: 1,
      tokensRevoked: 0,
      revokeTruncated: false,
      revalidated: [],
      downloadTokensRotated: [],
    }
  },
  applyHostLockdown: async (options: { hostId: string; action: string }) => {
    suspend(`hosts/${options.hostId}`, options.action)
    return { revalidated: { ok: true }, downloadTokensRotated: [] }
  },
}))

jest.mock('../utils/server-plugin-loader', () => ({
  __esModule: true,
  serverPluginLoader: { ensureAll: async () => undefined },
}))

const route = require('../app/api/admin/lockdown/route') as {
  POST: (request: Request) => Promise<Response>
}

async function post(body: Record<string, unknown>) {
  const response = await route.POST(
    new Request('https://app.aglyn.com/api/admin/lockdown', {
      method: 'POST',
      headers: {
        authorization: 'Bearer staff-token',
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    }),
  )
  return { status: response.status, body: (await response.json()) as any }
}

let stripe: StripeDouble
/** Every host the registered source was asked about. */
let sourceAsked: string[][]

const LIVE = ['active', 'trialing', 'past_due', 'unpaid', 'incomplete']

beforeEach(() => {
  mockAuditRows = []
  sourceAsked = []
  mockStore = {
    'orgs/org-shop': { slug: 'shop-co', ownerUid: 'user-seller' },
    'hosts/host-a': { orgId: 'org-shop' },
    'hosts/host-b': { orgId: 'org-shop' },
    'profiles/user-seller': { stripeAccountId: 'acct_seller' },
    // The plugin's own records: the ONLY source of what gets paused.
    'hosts/host-a/subscriptions/sub_member_1': { status: 'active' },
    'hosts/host-a/subscriptions/sub_merchant_paused': { status: 'active' },
    'hosts/host-b/subscriptions/sub_member_2': { status: 'trialing' },
    'hosts/host-b/subscriptions/sub_gone': { status: 'canceled' },
  }
  Object.assign(mockDecodedToken, {
    uid: 'staff-super-1',
    email: 'ops@aglyn.com',
    email_verified: true,
    staff: true,
    staffRole: 'super',
  })
  process.env.STRIPE_SECRET_KEY = 'sk_test_not_a_real_key'
  // A stand-in for the commerce source, reading the same record shape, so
  // this spec does not import a plugin.
  resetPluginServicesForTests()
  registerRecurringChargeSource(
    {
      listLiveSubscriptions: async ({ hostIds }) => {
        sourceAsked.push([...hostIds])
        return Object.keys(mockStore)
          .map((path) => path.split('/'))
          .filter(
            (parts) =>
              parts.length === 4 &&
              parts[0] === 'hosts' &&
              hostIds.includes(parts[1]) &&
              parts[2] === 'subscriptions' &&
              LIVE.includes(mockStore[parts.join('/')]['status']),
          )
          .map((parts) => ({ subscriptionId: parts[3], hostId: parts[1] }))
      },
    },
    { pluginId: 'commerce' },
  )
  stripe = installStripeDouble(
    [
      subscription({ id: 'sub_member_1', customer: 'cus_a' }),
      subscription({
        id: 'sub_merchant_paused',
        customer: 'cus_b',
        pause_collection: { behavior: 'keep_as_draft' },
      }),
      subscription({ id: 'sub_member_2', customer: 'cus_c', status: 'trialing' }),
      subscription({ id: 'sub_gone', customer: 'cus_d', status: 'canceled' }),
      // Sold by nobody on this workspace: must never be touched.
      subscription({ id: 'sub_elsewhere', customer: 'cus_e' }),
    ],
    [
      {
        id: 'acct_seller',
        type: 'express',
        settings: {
          payouts: {
            schedule: { interval: 'weekly', weekly_anchor: 'friday', delay_days: 7 },
          },
        },
      },
    ],
  )
})

const lock = (extra: Record<string, unknown> = {}) =>
  post({
    action: 'lock',
    scope: 'org',
    targetId: 'org-shop',
    reason: 'security',
    pauseRenewals: true,
    pausePayouts: true,
    ...extra,
  })
const unlock = (scope = 'org', targetId = 'org-shop') =>
  post({ action: 'unlock', scope, targetId })

const pauseOf = (id: string) => stripe.subscriptions.get(id)!.pause_collection ?? null

describe('the console default matrix', () => {
  it.each([
    ['security', true],
    ['billing', false],
    ['maintenance', false],
    ['manual', false],
  ])('a %s lock defaults both pause boxes to %s', (reason, expected) => {
    expect(lockdownPausesSiteMoneyByDefault(reason)).toBe(expected)
  })
})

describe('an org lock that pauses its sites’ money', () => {
  it('pauses the live renewals its plugin recorded, and records exactly those', async () => {
    const { status, body } = await lock()
    expect(status).toBe(200)
    expect(body.confirmed).toBe(true)
    expect(body.verified.locked).toBe(true)
    expect(sourceAsked).toEqual([['host-a', 'host-b']])

    expect(body.renewalsPause).toMatchObject({ confirmed: true, changed: 2 })
    const outcomes = Object.fromEntries(
      body.renewalsPause.subscriptions.map((step: any) => [step.id, step.outcome]),
    )
    expect(outcomes).toEqual({
      sub_member_1: 'paused',
      sub_merchant_paused: 'already-paused',
      sub_member_2: 'paused',
    })
    expect(pauseOf('sub_member_1')).toEqual({ behavior: 'void' })
    expect(pauseOf('sub_member_2')).toEqual({ behavior: 'void' })
    // Untouched: the merchant's own pause, a canceled one, and anything the
    // workspace does not sell.
    expect(pauseOf('sub_merchant_paused')).toEqual({ behavior: 'keep_as_draft' })
    expect(stripe.writes().map((call) => call.path).sort()).toEqual([
      'accounts/acct_seller',
      'subscriptions/sub_member_1',
      'subscriptions/sub_member_2',
    ])
    // Nothing is canceled or refunded, and no search of Stripe ran.
    expect(stripe.calls.some((call) => call.method === 'DELETE')).toBe(false)
    expect(stripe.calls.some((call) => call.path.includes('search'))).toBe(false)

    // The server-only record names exactly what this lock paused.
    expect(mockStore['lockdownBillingPauses/sub_sub_member_1']).toMatchObject({
      kind: 'subscription',
      holders: ['org:org-shop'],
      behavior: 'void',
    })
    expect(mockStore['lockdownBillingPauses/sub_sub_merchant_paused']).toBeUndefined()
  })

  it('switches the seller to manual payouts and saves the old schedule', async () => {
    const { body } = await lock()
    expect(body.payoutsPause).toMatchObject({
      accountId: 'acct_seller',
      outcome: 'paused',
      confirmed: true,
      schedule: { interval: 'weekly', weekly_anchor: 'friday', delay_days: 7 },
    })
    expect(stripe.accounts.get('acct_seller')!.settings.payouts.schedule.interval).toBe(
      'manual',
    )
    expect(mockStore['lockdownBillingPauses/payout_acct_seller']).toMatchObject({
      kind: 'payouts',
      holders: ['org:org-shop'],
      previousSchedule: { interval: 'weekly', weekly_anchor: 'friday', delay_days: 7 },
    })
  })

  it('audits each step as its own row', async () => {
    await lock()
    const actions = mockAuditRows.map((row) => row['action'])
    expect(actions).toEqual(
      expect.arrayContaining([
        'lockdown.lock',
        'lockdown.renewals-pause',
        'lockdown.payouts-pause',
      ]),
    )
    const pauseRow = mockAuditRows.find((row) => row['action'] === 'lockdown.renewals-pause')
    expect(pauseRow).toMatchObject({ refunded: false, canceled: false, via: 'lockdown' })
  })
})

describe('the lift', () => {
  it('resumes only what the lock paused and restores the exact schedule', async () => {
    await lock()
    const { body } = await unlock()
    expect(body.renewalsResume).toMatchObject({ confirmed: true, changed: 2 })
    expect(pauseOf('sub_member_1')).toBeNull()
    expect(pauseOf('sub_member_2')).toBeNull()
    // The merchant's own pause survives the lift.
    expect(pauseOf('sub_merchant_paused')).toEqual({ behavior: 'keep_as_draft' })
    expect(body.payoutsRestore).toMatchObject({ outcome: 'restored', confirmed: true })
    expect(stripe.accounts.get('acct_seller')!.settings.payouts.schedule).toEqual({
      interval: 'weekly',
      weekly_anchor: 'friday',
      delay_days: 7,
    })
    expect(
      Object.keys(mockStore).filter((path) => path.startsWith('lockdownBillingPauses/')),
    ).toEqual([])
    expect(mockAuditRows.map((row) => row['action'])).toEqual(
      expect.arrayContaining(['lockdown.renewals-resume', 'lockdown.payouts-restore']),
    )
  })

  it('leaves the money stopped while another lock still holds it', async () => {
    await lock()
    await post({
      action: 'lock',
      scope: 'host',
      targetId: 'host-a',
      reason: 'security',
      pauseRenewals: true,
      pausePayouts: true,
    })
    const { body } = await unlock('host', 'host-a')
    expect(body.renewalsResume.subscriptions).toEqual([
      expect.objectContaining({ id: 'sub_member_1', outcome: 'still-held' }),
    ])
    expect(pauseOf('sub_member_1')).toEqual({ behavior: 'void' })
    expect(body.payoutsRestore).toMatchObject({ outcome: 'still-held' })
    expect(stripe.accounts.get('acct_seller')!.settings.payouts.schedule.interval).toBe(
      'manual',
    )
    // The org's lift is the last holder, and puts it all back.
    await unlock()
    expect(pauseOf('sub_member_1')).toBeNull()
    expect(stripe.accounts.get('acct_seller')!.settings.payouts.schedule.interval).toBe(
      'weekly',
    )
  })

  it('a lock that paused nothing reports nothing on its lift', async () => {
    await lock({ pauseRenewals: false, pausePayouts: false })
    const { body } = await unlock()
    expect(body.renewalsResume).toBeUndefined()
    expect(body.payoutsRestore).toBeUndefined()
    expect(stripe.writes()).toEqual([])
  })
})

describe('what a pause must not do', () => {
  it('a Standard account is reported not controllable, and the lock stands', async () => {
    stripe.accounts.get('acct_seller')!.type = 'standard'
    const { body } = await lock()
    expect(body.confirmed).toBe(true)
    expect(body.payoutsPause).toMatchObject({
      outcome: 'not-controllable',
      confirmed: false,
    })
    expect(body.payoutsPause.error).toMatch(/pause them in the Stripe Dashboard/i)
    expect(stripe.writes().some((call) => call.path.startsWith('accounts/'))).toBe(false)
    expect(mockStore['lockdownBillingPauses/payout_acct_seller']).toBeUndefined()
  })

  it('a failed Stripe call leaves the lock in place and records nothing it did not pause', async () => {
    stripe.failWrites = true
    const { status, body } = await lock()
    expect(status).toBe(200)
    expect(body.confirmed).toBe(true)
    expect(body.verified.locked).toBe(true)
    expect(mockStore['orgs/org-shop']['suspendedAt']).toBeDefined()
    expect(body.renewalsPause.confirmed).toBe(false)
    expect(body.payoutsPause).toMatchObject({ outcome: 'failed', confirmed: false })
    expect(
      Object.keys(mockStore).filter((path) => path.startsWith('lockdownBillingPauses/')),
    ).toEqual([])
  })

  it('a non-security lock without the flags pauses nothing', async () => {
    const { body } = await post({
      action: 'lock',
      scope: 'org',
      targetId: 'org-shop',
      reason: 'billing',
    })
    expect(body.confirmed).toBe(true)
    expect(body.renewalsPause).toBeUndefined()
    expect(body.payoutsPause).toBeUndefined()
    expect(sourceAsked).toEqual([])
    expect(stripe.calls).toEqual([])
  })
})
