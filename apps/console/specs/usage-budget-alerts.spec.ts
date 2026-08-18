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
 * Usage budgets, through the real cron (AGL-1528) — and the email channel
 * that never existed (AGL-2052).
 *
 * `usage-budget.spec.ts` pins the arithmetic. This suite pins the WIRING:
 * that the cron reads the invoice's own `billedCents` rather than inventing a
 * figure, that it refuses a rollup from the wrong month, that the guard it
 * writes is the one it reads next tick, and that both channels fire with the
 * same words.
 *
 * Every case was forced red before it was kept; each says how.
 */

const CRON_SECRET = 'test-cron-secret'

interface SeededOrg {
  id: string
  plan: string
  usageBudget?: { amountUsd?: unknown; thresholdPcts?: unknown }
  /** The latest `orgs/{id}/usage/*` document, or none. */
  rollup?: { month: string; billedCents: number } | null
  /** `orgs/{id}/assistUsage/{month}.estCostUsd`. */
  assistEstCostUsd?: number
  /** `orgs/{id}/counters/media.bytes` — the org library. */
  orgLibraryBytes?: number
  usageAlerts?: Record<string, { month?: string; threshold?: number }>
  /** `orgs/{id}/members` — role + denormalized email. */
  members?: Array<{ id: string; role: string; email?: string }>
}

let mockOrgs: SeededOrg[]
let mockNotifications: Array<{ orgId: string; title: string; body: string }>
let mockStaffNotifications: Array<{ title: string; body: string }>
let mockEmails: Array<{ to: string[]; subject: string; text: string; context: string }>
/** Every `usageAlerts` map written back, in order. */
let mockGuardWrites: Array<Record<string, { month: string; threshold: number }>>

const mockNotifyOrgAdmins = jest.fn(
  async (orgId: string, payload: { title: string; body: string }) => {
    mockNotifications.push({ orgId, title: payload.title, body: payload.body })
  },
)
const mockNotifyStaff = jest.fn(
  async (payload: { title: string; body: string }) => {
    mockStaffNotifications.push({ title: payload.title, body: payload.body })
  },
)

function emptyCollection(): any {
  const api: any = {
    select: () => api,
    where: () => api,
    limit: () => api,
    orderBy: () => api,
    get: async () => ({ docs: [], size: 0, empty: true }),
    count: () => ({ get: async () => ({ data: () => ({ count: 0 }) }) }),
    doc: () => ({ get: async () => ({ exists: false, get: () => undefined }) }),
  }
  return api
}

function snapshotOf(fields: Record<string, unknown> | null) {
  return {
    exists: fields != null,
    get: (field: string) => (fields ? fields[field] : undefined),
  }
}

function orgSubcollection(org: SeededOrg, name: string): any {
  if (name === 'usage') {
    const api: any = {
      orderBy: () => api,
      limit: () => api,
      get: async () => ({
        docs: org.rollup
          ? [
              {
                id: org.rollup.month,
                get: (field: string) =>
                  (org.rollup as any)[field] ??
                  // `computedAt` is read by the screen-cap helper, which this
                  // suite stubs out; anything else is genuinely absent.
                  undefined,
              },
            ]
          : [],
      }),
    }
    return api
  }
  if (name === 'assistUsage') {
    return {
      doc: () => ({
        get: async () =>
          snapshotOf(
            org.assistEstCostUsd === undefined
              ? null
              : { estCostUsd: org.assistEstCostUsd },
          ),
      }),
    }
  }
  if (name === 'counters') {
    return {
      doc: (counter: string) => ({
        get: async () =>
          snapshotOf(
            counter === 'media' && org.orgLibraryBytes !== undefined
              ? { bytes: org.orgLibraryBytes }
              : null,
          ),
      }),
    }
  }
  if (name === 'members') {
    return {
      get: async () => ({
        docs: (org.members ?? []).map((member) => ({
          id: member.id,
          get: (field: string) => (member as any)[field],
        })),
      }),
    }
  }
  return emptyCollection()
}

function fakeOrgDoc(org: SeededOrg) {
  const data: Record<string, unknown> = {
    plan: org.plan,
    slug: org.id,
    ...(org.usageBudget ? { usageBudget: org.usageBudget } : {}),
    ...(org.usageAlerts ? { usageAlerts: org.usageAlerts } : {}),
  }
  return {
    id: org.id,
    data: () => data,
    get: (field: string) => data[field],
    ref: {
      id: org.id,
      // Firestore `set(..., {merge:true})` conjures a missing document and
      // merges a present one; the route only ever writes `usageAlerts`, so
      // capturing that map is a faithful model of the write.
      set: async (payload: any) => {
        if (payload?.usageAlerts) mockGuardWrites.push(payload.usageAlerts)
      },
      collection: (name: string) => orgSubcollection(org, name),
    },
  }
}

const fakeFirestore = {
  collection: (name: string) => {
    if (name === 'orgs') {
      const api: any = {
        limit: () => api,
        get: async () => ({
          docs: mockOrgs.map(fakeOrgDoc),
          size: mockOrgs.length,
        }),
        // The EMAIL fan-out addresses an org by id (AGL-2052) rather than
        // walking the sweep's snapshot, so the double has to serve both.
        doc: (orgId: string) => {
          const org = mockOrgs.find((entry) => entry.id === orgId)
          return {
            id: orgId,
            collection: (sub: string) =>
              org ? orgSubcollection(org, sub) : emptyCollection(),
          }
        },
      }
      return api
    }
    if (name === 'hosts') {
      const api: any = {
        where: () => api,
        limit: () => api,
        get: async () => ({ docs: [], size: 0 }),
      }
      return api
    }
    return emptyCollection()
  },
}

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  firebaseAdmin: {
    app: () => ({ firestore: () => fakeFirestore }),
    firestore: { FieldPath: { documentId: () => '__name__' } },
  },
  notifyOrgAdmins: (...args: unknown[]) => (mockNotifyOrgAdmins as any)(...args),
  notifyStaff: (...args: unknown[]) => (mockNotifyStaff as any)(...args),
  meterPlatformEmail: async () => undefined,
}))

jest.mock('@aglyn/shared-util-email', () => ({
  __esModule: true,
  sendEmail: async (options: any) => {
    mockEmails.push({
      to: options.to,
      subject: options.subject,
      text: options.text,
      context: options.context,
    })
    return { sent: true, id: 'test' }
  },
}))

jest.mock('@aglyn/aglyn/server', () => ({
  __esModule: true,
  // The REAL entitlements — a stubbed plan would make every threshold below
  // unfalsifiable.
  ...jest.requireActual('../../../libs/aglyn/src/lib/app-utils/plan-entitlements'),
  buildRoute: () => '/acme/billing',
  Route: { MANAGE_BILLING: 'MANAGE_BILLING' },
  ORG_BILLING_SUBCOLLECTION: 'billing',
  ORG_BILLING_DOC_ID: 'billing',
  pluginRequestFromWeb: async (request: Request) => ({
    method: request.method,
    query: {},
    body: {},
    headers: {
      'x-cron-secret': request.headers.get('x-cron-secret') ?? undefined,
    },
  }),
}))

jest.mock('../utils/screen-cap-reconciliation', () => ({
  __esModule: true,
  measureScreenCaps: async () => ({ maxBillable: 0, overCapHostIds: [] }),
  screenCapMaxBillable: async () => 0,
}))

import { POST } from '../app/api/billing/usage-alerts/route'

const MONTH = new Date().toISOString().slice(0, 7)
const LAST_MONTH = new Date(
  Date.UTC(
    Number(MONTH.slice(0, 4)),
    Number(MONTH.slice(5, 7)) - 2,
    1,
  ),
)
  .toISOString()
  .slice(0, 7)

async function run() {
  mockNotifications = []
  mockStaffNotifications = []
  mockEmails = []
  mockGuardWrites = []
  const response = await POST(
    new Request('https://app.aglyn.com/api/billing/usage-alerts', {
      method: 'POST',
      headers: { 'x-cron-secret': CRON_SECRET },
    }),
  )
  expect(response.status).toBe(200)
}

const budgetAlerts = () =>
  mockNotifications.filter((entry) => entry.title.includes('usage budget'))

beforeEach(() => {
  process.env.CRON_SECRET = CRON_SECRET
  delete process.env.USAGE_ALERT_APPROACH_PCT
  delete process.env.BILL_ASSIST_TOKENS_FROM
  delete process.env.ASSIST_ORG_MONTHLY_COGS_ALERT_USD
  delete process.env.AUTO_LOCK_BILLING_FROM
  jest.clearAllMocks()
  mockOrgs = []
})

/** An org on a metered plan with a $50 budget and one admin who can be mailed. */
function seededOrg(overrides: Partial<SeededOrg> = {}): SeededOrg {
  return {
    id: 'acme',
    plan: 'pro',
    usageBudget: { amountUsd: 50 },
    members: [{ id: 'u1', role: 'owner', email: 'owner@acme.test' }],
    ...overrides,
  }
}

describe('usage budgets fire from the invoice’s own figure (AGL-1528)', () => {
  it('stays silent for an org that never set a budget', async () => {
    // The default posture. A budget is opt-in; inventing one would alert
    // every org on the platform about a number nobody chose.
    mockOrgs = [
      seededOrg({
        usageBudget: undefined,
        rollup: { month: MONTH, billedCents: 999_00 },
      }),
    ]
    await run()
    expect(budgetAlerts()).toHaveLength(0)
  })

  it('stays silent below the lowest rule', async () => {
    mockOrgs = [seededOrg({ rollup: { month: MONTH, billedCents: 2_400 } })]
    await run()
    // $24 of a $50 budget is 48% — under the default 50 rule.
    expect(budgetAlerts()).toHaveLength(0)
  })

  it('alerts at 50% of the budget, in dollars', async () => {
    mockOrgs = [seededOrg({ rollup: { month: MONTH, billedCents: 2_500 } })]
    await run()
    const alerts = budgetAlerts()
    expect(alerts).toHaveLength(1)
    expect(alerts[0].title).toContain('50%')
    expect(alerts[0].title).toContain('$50')
    expect(alerts[0].body).toContain('$25.00')
    // A budget is NOT a cap, and the copy has to say so — AGL-1529 rejected a
    // spend ceiling that takes a site down to save $2, and a customer who
    // believes a budget stops things will set one and then be surprised twice.
    expect(alerts[0].body).toContain('not a limit')
  })

  it('reports the HIGHEST rule crossed when spend jumps', async () => {
    // Forced red by alerting on the first matching rule: an org that went
    // from $0 to $60 between two daily ticks was told it was at 50%.
    mockOrgs = [seededOrg({ rollup: { month: MONTH, billedCents: 6_000 } })]
    await run()
    expect(budgetAlerts()[0].title).toContain('reached your $50')
  })

  it('honours the customer’s own threshold rules', async () => {
    // Forced red by ignoring `thresholdPcts` and using the default trio: a
    // customer who asked to hear at 10% heard nothing until 50%, which is a
    // configurable control that silently is not one.
    mockOrgs = [
      seededOrg({
        usageBudget: { amountUsd: 50, thresholdPcts: [10, 100] },
        rollup: { month: MONTH, billedCents: 600 },
      }),
    ]
    await run()
    expect(budgetAlerts()[0].title).toContain('10%')
  })

  it('REFUSES a rollup from a previous month', async () => {
    // The live hazard: the cron reads the LATEST usage document by
    // `computedAt`, which on the 1st is still last month's. Forced red by
    // dropping the month comparison in `orgMonthlySpend` — this org's budget
    // fired on day one of every month, from spend it had not yet incurred.
    mockOrgs = [
      seededOrg({ rollup: { month: LAST_MONTH, billedCents: 20_000 } }),
    ]
    await run()
    expect(budgetAlerts()).toHaveLength(0)
  })

  it('is silent for an org with no rollup at all', async () => {
    mockOrgs = [seededOrg({ rollup: null })]
    await run()
    expect(budgetAlerts()).toHaveLength(0)
  })
})

describe('budget alerts are idempotent across cron ticks', () => {
  it('writes the guard it will read next tick', async () => {
    mockOrgs = [seededOrg({ rollup: { month: MONTH, billedCents: 2_500 } })]
    await run()
    expect(budgetAlerts()).toHaveLength(1)
    const written = mockGuardWrites.at(-1)
    expect(written?.['budget']).toEqual({ month: MONTH, threshold: 50 })
  })

  it('does NOT re-alert on the next tick with the guard in place', async () => {
    // The whole idempotency requirement, end to end. Forced red by writing
    // the guard under a key the read side does not use — the alert fired on
    // every tick while the guard document looked correct, which is the shape
    // that survives a code review.
    mockOrgs = [
      seededOrg({
        rollup: { month: MONTH, billedCents: 2_500 },
        usageAlerts: { budget: { month: MONTH, threshold: 50 } },
      }),
    ]
    await run()
    expect(budgetAlerts()).toHaveLength(0)
    expect(mockEmails.filter((mail) => mail.context === 'usage-budget')).toHaveLength(0)
  })

  it('DOES alert again when spend climbs to the next rule', async () => {
    mockOrgs = [
      seededOrg({
        rollup: { month: MONTH, billedCents: 5_000 },
        usageAlerts: { budget: { month: MONTH, threshold: 50 } },
      }),
    ]
    await run()
    expect(budgetAlerts()).toHaveLength(1)
    expect(mockGuardWrites.at(-1)?.['budget']).toEqual({
      month: MONTH,
      threshold: 100,
    })
  })

  it('alerts again in a new budget period', async () => {
    mockOrgs = [
      seededOrg({
        rollup: { month: MONTH, billedCents: 5_000 },
        usageAlerts: { budget: { month: LAST_MONTH, threshold: 100 } },
      }),
    ]
    await run()
    expect(budgetAlerts()).toHaveLength(1)
  })
})

describe('delivery is console AND email (AGL-2052)', () => {
  it('emails the org’s owners and admins with the same words', async () => {
    // The defect this closes: `notifyOrgAdmins` writes
    // `users/{uid}/notifications` and NOTHING turns that into mail, so the
    // platform's only pre-invoice warning reached only people already looking
    // at the console. Forced red by removing the `emailOrgAdmins` call — the
    // console assertion above still passed, which is exactly how the gap
    // survived: the in-app half looks like delivery.
    mockOrgs = [
      seededOrg({
        rollup: { month: MONTH, billedCents: 2_500 },
        members: [
          { id: 'u1', role: 'owner', email: 'owner@acme.test' },
          { id: 'u2', role: 'admin', email: 'admin@acme.test' },
          // Not an admin: must NOT be mailed about the org's money.
          { id: 'u3', role: 'editor', email: 'editor@acme.test' },
          // No denormalized email: skipped, never `undefined` in a recipient
          // list (Resend rejects the request, losing the OTHER recipients).
          { id: 'u4', role: 'admin' },
        ],
      }),
    ]
    await run()
    const mail = mockEmails.filter((entry) => entry.context === 'usage-budget')
    expect(mail).toHaveLength(1)
    expect(mail[0].to.sort()).toEqual(['admin@acme.test', 'owner@acme.test'])
    expect(mail[0].subject).toBe(budgetAlerts()[0].title)
    // An email has no console context, so its link must be ABSOLUTE or it is
    // a dead link.
    expect(mail[0].text).toContain('https://')
    expect(mail[0].text).toContain('/acme/billing')
  })

  it('emails the QUOTA alerts too, not only the budget ones', async () => {
    // AGL-2052 is about EVERY alert this cron sends, not just the new ones —
    // the storage warning is the one Zach's "no surprise bill" condition
    // actually rests on. Free plan, org library at its whole 250 MB band.
    mockOrgs = [
      {
        id: 'acme',
        plan: 'free',
        rollup: null,
        orgLibraryBytes: 250 * 1024 * 1024,
        members: [{ id: 'u1', role: 'owner', email: 'owner@acme.test' }],
      },
    ]
    await run()
    // Asserted NON-VACUOUSLY: the loop below would pass on an empty list, so
    // the count comes first. (This case was written the lazy way, passed with
    // zero notifications, and is the reason the next line exists.)
    const storage = mockNotifications.filter((entry) =>
      entry.title.includes('storage'),
    )
    expect(storage.length).toBeGreaterThan(0)
    for (const notification of storage) {
      const mail = mockEmails.find(
        (entry) => entry.subject === notification.title,
      )
      expect(mail?.context).toBe('usage-alert')
      expect(mail?.to).toEqual(['owner@acme.test'])
      expect(mail?.text).toContain(notification.body)
    }
  })
})

describe('the Assist margin guard is staff-facing (AGL-1528)', () => {
  it('does not add unbilled Assist cost to a customer’s budget', async () => {
    // Assist is a plan entitlement (`aiAssist: true`) with no per-token price
    // anywhere in the platform. Folding its cost into a customer's budget
    // would be a surprise bill invented by a notification — the exact thing
    // this feature exists to prevent. Forced red by summing it
    // unconditionally: this org alerted at 100% on spend it will never owe.
    mockOrgs = [
      seededOrg({
        rollup: { month: MONTH, billedCents: 2_400 },
        assistEstCostUsd: 40,
      }),
    ]
    await run()
    expect(budgetAlerts()).toHaveLength(0)
  })

  it('counts Assist once a start month names it', async () => {
    process.env.BILL_ASSIST_TOKENS_FROM = MONTH
    mockOrgs = [
      seededOrg({
        rollup: { month: MONTH, billedCents: 2_400 },
        assistEstCostUsd: 40,
      }),
    ]
    await run()
    const alerts = budgetAlerts()
    expect(alerts).toHaveLength(1)
    // And names the split, so the figure is not a mystery.
    expect(alerts[0].body).toContain('Assist')
  })

  it('notifies STAFF when one org’s Assist cost crosses the review threshold', async () => {
    // The live half of "covers Assist token spend alike". Forced red by
    // returning false from `assistMarginBreach` — nothing anywhere else on
    // the platform puts a dollar figure on Assist, whose only ceiling is a
    // 1,000-MESSAGE count.
    process.env.ASSIST_ORG_MONTHLY_COGS_ALERT_USD = '25'
    mockOrgs = [seededOrg({ rollup: null, assistEstCostUsd: 30 })]
    await run()
    expect(mockStaffNotifications).toHaveLength(1)
    expect(mockStaffNotifications[0].title).toContain('$30.00')
    // The CUSTOMER hears nothing: they are not being charged for it.
    expect(budgetAlerts()).toHaveLength(0)
    expect(mockEmails).toHaveLength(0)
  })

  it('escalates at the next multiple rather than going quiet', async () => {
    process.env.ASSIST_ORG_MONTHLY_COGS_ALERT_USD = '25'
    mockOrgs = [
      seededOrg({
        rollup: null,
        assistEstCostUsd: 260,
        usageAlerts: { assistCogs: { month: MONTH, threshold: 1 } },
      }),
    ]
    await run()
    expect(mockStaffNotifications).toHaveLength(1)
    expect(mockGuardWrites.at(-1)?.['assistCogs']).toEqual({
      month: MONTH,
      threshold: 10,
    })
  })

  it('stays quiet under the threshold and after the multiple is recorded', async () => {
    process.env.ASSIST_ORG_MONTHLY_COGS_ALERT_USD = '25'
    mockOrgs = [
      seededOrg({
        rollup: null,
        assistEstCostUsd: 30,
        usageAlerts: { assistCogs: { month: MONTH, threshold: 1 } },
      }),
    ]
    await run()
    expect(mockStaffNotifications).toHaveLength(0)
  })
})
