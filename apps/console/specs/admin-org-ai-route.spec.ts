/**
 * @jest-environment node
 *
 * Pragma must stay in the FIRST block comment — behind the license header it is
 * silently ignored.
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
 * `/api/admin/org-ai` (AGL-2930) backs the staff AI card, so three things
 * get pinned: the staff gate (401 / 403 / 200, the same contract as
 * `org-usage`), the ACCESS audit row an open writes — action, target, and
 * that no subject is named — and the composition, asserted against the real
 * entitlement and credit helpers rather than a stub of them, so the card
 * cannot show a band the meter would not refuse at.
 */

const mockVerifyIdToken = jest.fn()
const mockRecordAdminAudit = jest.fn(async () => undefined)

/** Documents by path, and query results by collection path. */
let mockDocsByPath: Record<string, Record<string, unknown> | undefined> = {}
let mockQueryDocs: Record<string, Array<{ id: string; data: Record<string, unknown> }>> = {}

const mockSnapshotOf = (id: string, data: Record<string, unknown> | undefined) => ({
  id,
  exists: data !== undefined,
  data: () => data,
  get: (field: string) => data?.[field],
})

function mockMakeCollection(path: string): any {
  const query = {
    where: () => query,
    orderBy: () => query,
    limit: () => query,
    get: async () => ({
      docs: (mockQueryDocs[path] ?? []).map((doc) => mockSnapshotOf(doc.id, doc.data)),
    }),
    doc: (id: string) => mockMakeDoc(`${path}/${id}`),
  }
  return query
}

function mockMakeDoc(path: string): any {
  return {
    id: path.split('/').pop(),
    path,
    get: async () => mockSnapshotOf(path.split('/').pop() ?? '', mockDocsByPath[path]),
    collection: (name: string) => mockMakeCollection(`${path}/${name}`),
  }
}

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  firebaseAdmin: {
    app: () => ({
      auth: () => ({
        verifyIdToken: (...args: unknown[]) => mockVerifyIdToken(...args),
      }),
      firestore: () => ({
        collection: (name: string) => mockMakeCollection(name),
        // The per-user reader fetches each roster member's month by path.
        getAll: async (...refs: Array<{ path: string }>) =>
          refs.map((ref) =>
            mockSnapshotOf(ref.path.split('/').pop() ?? '', mockDocsByPath[ref.path]),
          ),
      }),
    }),
  },
  isImpersonationSession: () => false,
  emailUnverifiedResponse: () =>
    Response.json({ error: 'Verify your email to continue' }, { status: 403 }),
  readOrgBilling: async () => ({}),
}))

jest.mock('@aglyn/tenant-data-admin/server/assist-usage', () => ({
  __esModule: true,
  assistUsageMonth: () => '2026-09',
}))

jest.mock('../app/api/_lib/admin-audit', () => ({
  __esModule: true,
  recordAdminAudit: (...args: unknown[]) => mockRecordAdminAudit(...(args as [])),
}))

jest.mock('@aglyn/aglyn/server', () => ({
  __esModule: true,
  ...jest.requireActual('@aglyn/aglyn/server'),
  pluginRequestFromWeb: async (request: Request) => {
    const url = new URL(request.url)
    return {
      method: request.method,
      query: Object.fromEntries(url.searchParams.entries()),
      headers: {
        authorization: request.headers.get('authorization') ?? undefined,
      },
    }
  },
}))

import {
  AI_ADDON_CREDITS_PER_MONTH,
  PLAN_ENTITLEMENTS,
  PLAN_PRICING,
} from '@aglyn/aglyn/app-utils/plan-entitlements'
import { GET, resetAddonSinceCache } from '../app/api/admin/org-ai/route'

const get = (opts: { token?: string; orgId?: string } = {}) =>
  GET(
    new Request(
      `https://app.aglyn.com/api/admin/org-ai?orgId=${opts.orgId ?? 'org-1'}`,
      {
        headers: opts.token ? { authorization: `Bearer ${opts.token}` } : {},
      },
    ),
  )

const staff = () =>
  mockVerifyIdToken.mockResolvedValueOnce({
    uid: 'staff-1',
    email_verified: true,
    staff: true,
  })

describe('/api/admin/org-ai (AGL-2930)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    resetAddonSinceCache()
    delete process.env.STRIPE_SECRET_KEY
    mockDocsByPath = {
      'orgs/org-1': {
        name: 'Acme',
        plan: 'pro',
        seatAddons: { aiAddon: 1 },
        entitlements: { assistCreditsPerMonth: 12_000 },
      },
      'orgs/org-1/billing/stripe': { subscription: { status: 'active' } },
      'orgs/org-1/assistUsage/2026-09': {
        month: '2026-09',
        estCostUsd: 2.5,
        messages: 40,
        deflected: 7,
        refusals: { cap: 2, band: 1 },
      },
    }
    mockQueryDocs = {
      'orgs/org-1/usage': [],
      'orgs/org-1/aiJobs': [
        {
          id: 'job-2',
          data: {
            kind: 'screen',
            status: 'running',
            creditsReserved: 400,
            creditsSpent: 120,
            createdAt: new Date('2026-09-10T12:00:00Z'),
            createdBy: 'user-a',
          },
        },
        {
          id: 'job-1',
          data: {
            kind: 'copy',
            status: 'failed',
            creditsReserved: 50,
            creditsSpent: 0,
            createdAt: new Date('2026-09-09T12:00:00Z'),
            createdBy: 'user-b',
          },
        },
      ],
      // The roster the per-user rollup is joined to (AGL-2928): names come
      // from here, months from the documents keyed by each uid below.
      'orgs/org-1/members': [
        { id: 'user-a', data: { displayName: 'Ada', email: 'ada@example.com', role: 'admin' } },
        { id: 'user-b', data: { email: 'bo@example.com', role: 'editor' } },
        { id: 'user-c', data: { email: 'quiet@example.com', role: 'viewer' } },
      ],
    }
    mockDocsByPath['orgs/org-1/aiUsageByUser/user-a/months/2026-09'] = {
      uid: 'user-a',
      month: '2026-09',
      credits: 1800,
      estCostUsd: 1.8,
      requests: 30,
      refusals: 2,
      byKind: { assist: 1000, page: 800 },
      byHost: { 'host-1': 1800 },
    }
    mockDocsByPath['orgs/org-1/aiUsageByUser/user-b/months/2026-09'] = {
      uid: 'user-b',
      month: '2026-09',
      credits: 700,
      estCostUsd: 0.7,
      requests: 10,
      byKind: { element: 700 },
    }
  })

  it('401s an unauthenticated caller', async () => {
    expect((await get()).status).toBe(401)
    expect(mockRecordAdminAudit).not.toHaveBeenCalled()
  })

  it('403s a verified NON-staff token — the claim is the gate', async () => {
    mockVerifyIdToken.mockResolvedValueOnce({ uid: 'user-1', email_verified: true })
    expect((await get({ token: 'tok' })).status).toBe(403)
    expect(mockRecordAdminAudit).not.toHaveBeenCalled()
  })

  it('404s an org that does not exist, and records no access', async () => {
    staff()
    expect((await get({ token: 'tok', orgId: 'missing' })).status).toBe(404)
    expect(mockRecordAdminAudit).not.toHaveBeenCalled()
  })

  it('records the open as an ACCESS row about the org, naming no person', async () => {
    staff()
    expect((await get({ token: 'tok' })).status).toBe(200)
    expect(mockRecordAdminAudit).toHaveBeenCalledTimes(1)
    const [entry] = mockRecordAdminAudit.mock.calls[0] as unknown as [Record<string, unknown>]
    expect(entry.actorUid).toBe('staff-1')
    expect(entry.action).toBe('org.ai-viewed')
    expect(entry.target).toBe('orgs/org-1/assistUsage')
    // The leaderboard names ten people; the row is about the ORG.
    expect(entry.subjectUid).toBeUndefined()
  })

  it('composes the pool, overage, refusals, jobs and users from the real helpers', async () => {
    staff()
    const response = await get({ token: 'tok' })
    expect(response.status).toBe(200)
    const body = await response.json()

    expect(body.month).toBe('2026-09')

    // Add-on: on, priced at the plan's figure, no Stripe key → unavailable.
    expect(body.addon).toEqual({
      on: true,
      priceUsd: PLAN_PRICING.pro.aiAddonMonthlyUsd,
      since: null,
      sinceSource: 'unavailable',
    })

    // Pool: the override REPLACES the plan band, the add-on stacks on it —
    // the same fold `resolveOrgEntitlements` makes for the meter.
    expect(body.pool.planCredits).toBe(PLAN_ENTITLEMENTS.pro.assistCreditsPerMonth)
    expect(body.pool.overrideCredits).toBe(12_000)
    expect(body.pool.addonCredits).toBe(AI_ADDON_CREDITS_PER_MONTH.pro)
    expect(body.pool.totalCredits).toBe(12_000 + AI_ADDON_CREDITS_PER_MONTH.pro)
    // $2.50 of provider spend is 2,500 credits, rounded up.
    expect(body.pool.usedCredits).toBe(2_500)
    expect(body.pool.providerUsd).toBe(2.5)
    expect(body.pool.remainingCredits).toBe(12_000 + AI_ADDON_CREDITS_PER_MONTH.pro - 2_500)
    expect(body.pool.projectedCredits).toBeGreaterThanOrEqual(2_500)
    expect(body.pool.messages).toBe(40)
    expect(body.pool.deflected).toBe(7)

    // Overage: inside the band, sold at Pro's rate, no org ceilings.
    expect(body.overage.overageCredits).toBe(0)
    expect(body.overage.rateUsdPer1k).toBe(PLAN_PRICING.pro.extraAssistCreditsUsdPer1k)
    expect(body.overage.sellsOverage).toBe(true)
    expect(body.overage.hardCap).toBe(false)
    expect(body.overage.capUsd).toBeNull()
    expect(body.overage.capReached).toBe(false)

    // Refusals: zero-filled from the sparse map on the month document.
    expect(body.refusals).toEqual({
      band: 1,
      cap: 2,
      messages: 0,
      budget: 0,
      account: 0,
      requests: 0,
      refusals: 0,
      platform: 0,
      total: 3,
    })

    // Jobs: counted by status, listed newest-first with the assumed fields.
    expect(body.jobs.counts).toEqual({
      queued: 0,
      running: 1,
      needs_input: 0,
      done: 0,
      failed: 1,
      canceled: 0,
    })
    expect(body.jobs.recent.map((job: { id: string }) => job.id)).toEqual(['job-2', 'job-1'])
    expect(body.jobs.recent[0]).toEqual({
      id: 'job-2',
      kind: 'screen',
      status: 'running',
      creditsReserved: 400,
      creditsSpent: 120,
      createdAt: '2026-09-10T12:00:00.000Z',
      createdBy: 'user-a',
    })
    expect(body.jobs.truncated).toBe(false)

    // Users: the per-user rollup joined to the roster, dearest first, with
    // each share measured against the org's $2.50. The member with no month
    // document is not a zero row.
    expect(body.users).toEqual([
      {
        uid: 'user-a',
        name: 'Ada',
        credits: 1800,
        estCostUsd: 1.8,
        share: 0.72,
        requests: 30,
        refusals: 2,
        byKind: { assist: 1000, page: 800 },
        byHost: { 'host-1': 1800 },
      },
      {
        uid: 'user-b',
        name: 'bo@example.com',
        credits: 700,
        estCostUsd: 0.7,
        share: 0.28,
        requests: 10,
        refusals: 0,
        byKind: { element: 700 },
        byHost: {},
      },
    ])

    // Margin: add-on price plus the override's dollar value, spend under it.
    expect(body.margin.addonRevenueUsd).toBe(PLAN_PRICING.pro.aiAddonMonthlyUsd)
    expect(body.margin.planAssistShareUsd).toBe(12)
    expect(body.margin.spendUsd).toBe(2.5)
    expect(body.margin.underwater).toBe(false)
    // No usage rollup → no contribution margin, not a zero one.
    expect(body.margin.contribution).toEqual({ month: null, marginPct: null, rating: null })
  })

  it('reads an org with nothing yet as empty, not as a failure', async () => {
    staff()
    delete mockDocsByPath['orgs/org-1/assistUsage/2026-09']
    mockDocsByPath['orgs/org-1'] = { name: 'Fresh', plan: 'starter' }
    mockDocsByPath['orgs/org-1/billing/stripe'] = undefined
    mockQueryDocs['orgs/org-1/aiJobs'] = []
    delete mockDocsByPath['orgs/org-1/aiUsageByUser/user-a/months/2026-09']
    delete mockDocsByPath['orgs/org-1/aiUsageByUser/user-b/months/2026-09']
    const body = await (await get({ token: 'tok' })).json()
    expect(body.addon.on).toBe(false)
    expect(body.pool.totalCredits).toBeNull()
    expect(body.pool.usedCredits).toBe(0)
    expect(body.refusals.total).toBe(0)
    expect(body.jobs).toEqual({
      counts: { queued: 0, running: 0, needs_input: 0, done: 0, failed: 0, canceled: 0 },
      recent: [],
      truncated: false,
    })
    expect(body.users).toEqual([])
    expect(body.overage.sellsOverage).toBe(false)
  })
})
