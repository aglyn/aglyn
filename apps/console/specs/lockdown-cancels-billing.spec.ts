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
 * A lock that also stops billing (AGL-3359).
 *
 * Staff locked a phishing actor's workspace and the lock did nothing to
 * billing: the subscription stayed live and would have renewed on a card that
 * was probably stolen. The panic button now cancels it when asked — and the
 * properties that matter are about what it must NOT do as much as what it
 * does:
 *
 *  - it runs AFTER the lock, and a failed cancel never undoes or hides the
 *    lock (the lock's own `confirmed` stays true; the cancel reports alone);
 *  - the route never infers it from a reason — only an explicit flag cancels,
 *    and the console defaults that flag on for `security` alone;
 *  - a lift never touches billing;
 *  - a user lock's "and their workspaces" reaches workspaces the account OWNS,
 *    never ones it merely belongs to.
 *
 * Stripe is the stateful double in `stripe-subscriptions-double.ts`; nothing
 * leaves the process. Firestore is an in-memory map; the org lock helper is
 * the same stand-in the other lockdown route specs use, which moves the
 * carrier doc so the route's read-back is real.
 */

import { lockdownCancelsBillingByDefault } from '../constants/subscription-cancel'
import {
  installStripeDouble,
  subscription,
  type StripeDouble,
} from './stripe-subscriptions-double'

let mockStore: Record<string, Record<string, unknown>> = {}
let mockAuditRows: Record<string, any>[] = []
const mockDecodedToken: Record<string, unknown> = {}
const mockApplyOrgLockdown = jest.fn()
const mockOwnerQueries: string[] = []

jest.mock('firebase-admin/firestore', () => ({
  __esModule: true,
  FieldValue: { serverTimestamp: () => 'SERVER_TIMESTAMP' },
}))

const mockSnapshot = (path: string) => {
  const data = mockStore[path] ? { ...mockStore[path] } : undefined
  return {
    id: path.split('/').pop(),
    exists: data !== undefined,
    data: () => data,
    get: (field: string) => data?.[field],
  }
}

const mockFirestore = {
  collection: (collection: string) => ({
    add: async (data: Record<string, unknown>) => {
      if (collection !== 'adminAudit') throw new Error(`unexpected add: ${collection}`)
      mockAuditRows.push(data)
      return { id: `audit-${mockAuditRows.length}` }
    },
    doc: (id: string) => ({
      get: async () => mockSnapshot(`${collection}/${id}`),
      set: async (data: Record<string, unknown>) => {
        mockStore[`${collection}/${id}`] = data
      },
      delete: async () => {
        delete mockStore[`${collection}/${id}`]
      },
    }),
    where: (field: string, _op: string, value: unknown) => ({
      limit: () => ({
        get: async () => {
          mockOwnerQueries.push(`${collection}.${field}==${String(value)}`)
          return {
            docs: Object.keys(mockStore)
              .filter(
                (path) =>
                  path.startsWith(`${collection}/`) &&
                  path.split('/').length === 2 &&
                  mockStore[path][field] === value,
              )
              .map(mockSnapshot),
          }
        },
      }),
    }),
    limit: () => ({ get: async () => ({ docs: [] }) }),
  }),
}

const mockReadOrgBilling = jest.fn(async (orgId: string) =>
  orgId === 'org-fraud'
    ? { stripeCustomerId: 'cus_fraud' }
    : orgId === 'org-second'
      ? { stripeCustomerId: 'cus_second' }
      : orgId === 'org-joined'
        ? { stripeCustomerId: 'cus_joined' }
        : {},
)

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
  readOrgBilling: (orgId: string) => mockReadOrgBilling(orgId),
}))

jest.mock('../utils/server/org-lockdown', () => ({
  __esModule: true,
  applyOrgLockdown: async (options: { orgId: string; action: string }) => {
    mockApplyOrgLockdown(options)
    const path = `orgs/${options.orgId}`
    const doc = { ...(mockStore[path] ?? {}) }
    if (options.action === 'lock') doc['suspendedAt'] = Date.now()
    else delete doc['suspendedAt']
    mockStore[path] = doc
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
  applyHostLockdown: async () => ({ revalidated: { ok: true } }),
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
/** Whether the org was already suspended when Stripe was first written to. */
let lockedBeforeFirstStripeWrite: boolean | null

beforeEach(() => {
  jest.clearAllMocks()
  mockAuditRows = []
  mockOwnerQueries.length = 0
  lockedBeforeFirstStripeWrite = null
  mockStore = {
    'orgs/org-fraud': { slug: 'fraud-co', ownerUid: 'user-fraud' },
    'orgs/org-second': { slug: 'second-co', ownerUid: 'user-fraud' },
    // The fraudster is only a MEMBER here; someone else owns it.
    'orgs/org-joined': { slug: 'victim-co', ownerUid: 'user-victim' },
  }
  Object.assign(mockDecodedToken, {
    uid: 'staff-super-1',
    email: 'ops@aglyn.com',
    email_verified: true,
    staff: true,
    staffRole: 'super',
  })
  process.env.STRIPE_SECRET_KEY = 'sk_test_not_a_real_key'
  stripe = installStripeDouble([
    subscription({
      id: 'sub_fraud',
      customer: 'cus_fraud',
      metadata: { orgId: 'org-fraud' },
    }),
    subscription({
      id: 'sub_second',
      customer: 'cus_second',
      metadata: { orgId: 'org-second' },
    }),
    subscription({
      id: 'sub_joined',
      customer: 'cus_joined',
      metadata: { orgId: 'org-joined' },
    }),
  ])
  const stripeFetch = globalThis.fetch as jest.Mock
  ;(globalThis as any).fetch = jest.fn(async (url: string, init: any = {}) => {
    if (lockedBeforeFirstStripeWrite === null && (init.method ?? 'GET') !== 'GET') {
      lockedBeforeFirstStripeWrite =
        mockStore['orgs/org-fraud']?.['suspendedAt'] != null
    }
    return stripeFetch(url, init)
  })
})

const orgLock = (extra: Record<string, unknown> = {}) =>
  post({
    action: 'lock',
    scope: 'org',
    targetId: 'org-fraud',
    reason: 'security',
    ...extra,
  })

describe('the console default matrix', () => {
  it.each([
    ['security', true],
    ['billing', false],
    ['maintenance', false],
    ['manual', false],
  ])('a %s lock defaults the cancel box to %s', (reason, expected) => {
    expect(lockdownCancelsBillingByDefault(reason)).toBe(expected)
  })
})

describe('org lock with cancelSubscription', () => {
  it('locks, THEN cancels now with no refund, and reports both', async () => {
    const { status, body } = await orgLock({ cancelSubscription: true })
    expect(status).toBe(200)
    // The lock's own verdict is untouched by the billing step.
    expect(body.confirmed).toBe(true)
    expect(body.verified.locked).toBe(true)
    expect(body.subscriptionCancel).toMatchObject({
      attempted: true,
      orgId: 'org-fraud',
      when: 'now',
      confirmed: true,
      changed: 1,
    })
    expect(lockedBeforeFirstStripeWrite).toBe(true)
    const writes = stripe.writes()
    expect(writes).toHaveLength(1)
    expect(writes[0]).toMatchObject({
      method: 'DELETE',
      path: 'subscriptions/sub_fraud',
    })
    expect(writes[0].params).toMatchObject({
      invoice_now: 'false',
      prorate: 'false',
    })
    expect(writes[0].params['cancellation_details[comment]']).toMatch(
      /via lockdown: security/,
    )
    expect(stripe.subscriptions.get('sub_fraud')!.status).toBe('canceled')
  })

  it('audits the lock first and the cancel as its own row', async () => {
    await orgLock({ cancelSubscription: true })
    expect(mockAuditRows.map((row) => row.action)).toEqual([
      'lockdown.lock',
      'org.subscription-cancel',
    ])
    expect(mockAuditRows[1]).toMatchObject({
      target: 'orgs/org-fraud',
      via: 'lockdown',
      reason: 'security',
      when: 'now',
      refunded: false,
    })
  })

  it('a FAILED cancel does not undo or hide the lock', async () => {
    stripe.failWrites = true
    const { status, body } = await orgLock({ cancelSubscription: true })
    expect(status).toBe(200)
    expect(body.confirmed).toBe(true)
    expect(body.verified.locked).toBe(true)
    expect(mockStore['orgs/org-fraud']['suspendedAt']).toBeTruthy()
    // Exactly one org write, and it was the lock — nothing lifted it.
    expect(mockApplyOrgLockdown).toHaveBeenCalledTimes(1)
    expect(mockApplyOrgLockdown.mock.calls[0][0].action).toBe('lock')
    // Reported as its own unconfirmed step, with Stripe's message.
    expect(body.subscriptionCancel.confirmed).toBe(false)
    expect(body.subscriptionCancel.subscriptions[0]).toMatchObject({
      id: 'sub_fraud',
      outcome: 'failed',
      confirmed: false,
    })
    expect(stripe.subscriptions.get('sub_fraud')!.status).toBe('active')
  })

  it('an unconfigured Stripe is reported as an unconfirmed step, the lock stands', async () => {
    delete process.env.STRIPE_SECRET_KEY
    const { body } = await orgLock({ cancelSubscription: true })
    expect(body.confirmed).toBe(true)
    expect(body.subscriptionCancel).toMatchObject({
      configured: false,
      confirmed: false,
    })
    expect(stripe.calls).toEqual([])
  })

  it('a cancel that throws outright is still a step, not a 500', async () => {
    mockReadOrgBilling.mockRejectedValueOnce(new Error('Firestore unavailable'))
    const { status, body } = await orgLock({ cancelSubscription: true })
    expect(status).toBe(200)
    expect(body.confirmed).toBe(true)
    expect(body.subscriptionCancel.confirmed).toBe(false)
    expect(body.subscriptionCancel.lookupErrors.join(' ')).toMatch(
      /Firestore unavailable/,
    )
  })

  it('locking again with the flag is idempotent in Stripe', async () => {
    await orgLock({ cancelSubscription: true })
    const { body } = await orgLock({ cancelSubscription: true })
    expect(stripe.writes()).toHaveLength(1)
    expect(body.subscriptionCancel).toMatchObject({ confirmed: true, changed: 0 })
  })
})

describe('nothing cancels without the flag', () => {
  it.each([['billing'], ['maintenance'], ['manual'], ['security']])(
    'a %s lock with no flag leaves billing alone — the route infers nothing from a reason',
    async (reason) => {
      const { body } = await post({
        action: 'lock',
        scope: 'org',
        targetId: 'org-fraud',
        reason,
      })
      expect(body.confirmed).toBe(true)
      expect(body.subscriptionCancel).toBeUndefined()
      expect(stripe.calls).toEqual([])
      expect(mockAuditRows.map((row) => row.action)).toEqual(['lockdown.lock'])
    },
  )

  it('only a literal true cancels — a truthy string does not', async () => {
    const { body } = await orgLock({ cancelSubscription: 'yes' })
    expect(body.subscriptionCancel).toBeUndefined()
    expect(stripe.calls).toEqual([])
  })

  it('a LIFT never touches billing, flag or not', async () => {
    await orgLock()
    const { body } = await post({
      action: 'unlock',
      scope: 'org',
      targetId: 'org-fraud',
      cancelSubscription: true,
    })
    expect(body.confirmed).toBe(true)
    expect(body.subscriptionCancel).toBeUndefined()
    expect(stripe.calls).toEqual([])
  })
})

describe('user lock with lockOwnedWorkspaces', () => {
  const userLock = (extra: Record<string, unknown> = {}) =>
    post({
      action: 'lock',
      scope: 'user',
      targetId: 'user-fraud',
      reason: 'security',
      ...extra,
    })

  it('locks and cancels every workspace the account OWNS, never one it only joined', async () => {
    const { status, body } = await userLock({ lockOwnedWorkspaces: true })
    expect(status).toBe(200)
    expect(body.confirmed).toBe(true)
    const owned = body.ownedWorkspaces
    expect(owned.confirmed).toBe(true)
    expect(owned.workspaces.map((ws: any) => ws.orgId).sort()).toEqual([
      'org-fraud',
      'org-second',
    ])
    for (const workspace of owned.workspaces) {
      expect(workspace.verified.locked).toBe(true)
      expect(workspace.subscriptionCancel.confirmed).toBe(true)
    }
    // The same org-lock path the org scope uses, once per owned workspace.
    expect(
      mockApplyOrgLockdown.mock.calls.map((call) => call[0].orgId).sort(),
    ).toEqual(['org-fraud', 'org-second'])
    expect(stripe.subscriptions.get('sub_fraud')!.status).toBe('canceled')
    expect(stripe.subscriptions.get('sub_second')!.status).toBe('canceled')
    // The workspace they merely belong to is somebody else's business.
    expect(stripe.subscriptions.get('sub_joined')!.status).toBe('active')
    expect(mockStore['orgs/org-joined']['suspendedAt']).toBeUndefined()
    // Owned workspaces are found by the owner seat alone. The marketplace
    // then reads each LOCKED workspace's listings (AGL-3365) — never the
    // joined one's.
    expect(mockOwnerQueries).toEqual([
      'orgs.ownerUid==user-fraud',
      'marketplaceListings.profileId==org-fraud',
      'marketplaceListings.profileId==org-second',
    ])
  })

  it('audits the account lock, each workspace lock and each cancel', async () => {
    await userLock({ lockOwnedWorkspaces: true })
    const actions = mockAuditRows.map((row) => `${row.action} ${row.target}`)
    expect(actions[0]).toBe('lockdown.lock users/user-fraud')
    expect(actions).toEqual(
      expect.arrayContaining([
        'lockdown.lock orgs/org-fraud',
        'lockdown.lock orgs/org-second',
        'org.subscription-cancel orgs/org-fraud',
        'org.subscription-cancel orgs/org-second',
      ]),
    )
    const orgRow = mockAuditRows.find(
      (row) => row.action === 'lockdown.lock' && row.target === 'orgs/org-fraud',
    )
    expect(orgRow.after.via).toBe('user-lock:user-fraud')
  })

  it('leaves an already-locked workspace’s lock exactly as it was, and still cancels it', async () => {
    mockStore['orgs/org-second'] = {
      ...mockStore['orgs/org-second'],
      suspendedAt: 123,
      suspendedReasonCode: 'billing',
    }
    const { body } = await userLock({ lockOwnedWorkspaces: true })
    const second = body.ownedWorkspaces.workspaces.find(
      (ws: any) => ws.orgId === 'org-second',
    )
    expect(second.alreadyLocked).toBe(true)
    expect(mockStore['orgs/org-second']['suspendedReasonCode']).toBe('billing')
    expect(
      mockApplyOrgLockdown.mock.calls.map((call) => call[0].orgId),
    ).toEqual(['org-fraud'])
    expect(second.subscriptionCancel.confirmed).toBe(true)
  })

  it('a failed cancel on one workspace leaves every lock standing', async () => {
    stripe.failWrites = true
    const { body } = await userLock({ lockOwnedWorkspaces: true })
    expect(body.confirmed).toBe(true)
    expect(body.ownedWorkspaces.confirmed).toBe(false)
    for (const workspace of body.ownedWorkspaces.workspaces) {
      expect(workspace.verified.locked).toBe(true)
      expect(workspace.subscriptionCancel.confirmed).toBe(false)
    }
  })

  it('without the flag, the account lock touches no workspace and no billing', async () => {
    const { body } = await userLock()
    expect(body.confirmed).toBe(true)
    expect(body.ownedWorkspaces).toBeUndefined()
    expect(mockOwnerQueries).toEqual([])
    expect(mockApplyOrgLockdown).not.toHaveBeenCalled()
    expect(stripe.calls).toEqual([])
  })

  it('lifting the account touches neither its workspaces nor billing', async () => {
    await userLock({ lockOwnedWorkspaces: true })
    const writesAfterLock = stripe.writes().length
    mockApplyOrgLockdown.mockClear()
    const { body } = await post({
      action: 'unlock',
      scope: 'user',
      targetId: 'user-fraud',
      lockOwnedWorkspaces: true,
    })
    expect(body.confirmed).toBe(true)
    expect(body.ownedWorkspaces).toBeUndefined()
    expect(mockApplyOrgLockdown).not.toHaveBeenCalled()
    expect(stripe.writes()).toHaveLength(writesAfterLock)
    // Nothing is recreated: the cancelled subscriptions stay cancelled.
    expect(stripe.subscriptions.get('sub_fraud')!.status).toBe('canceled')
    expect(mockStore['orgs/org-fraud']['suspendedAt']).toBeTruthy()
  })
})
