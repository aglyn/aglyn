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
  /** The latest `orgs/{id}/usage/*` document by `computedAt`, or none. */
  rollup?: { month: string; billedCents: number } | null
  /**
   * `orgs/{id}/usage/{month}` read BY ID, when it differs from the latest
   * (AGL-2219). Two sweeps write into this collection now — the closed month
   * at 02:00, the month in progress at 07:00 — so the newest document by
   * `computedAt` is whichever cron ran last, and that is not a property a
   * budget may depend on. Seeding the two apart is the only way to tell the
   * two reads apart at all.
   */
  monthRollup?: { month: string; billedCents: number } | null
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
let mockEmails: Array<{
  to: string[] | string
  subject: string
  text: string
  context: string
}>
/** `uid -> address` for the auth pools, when a member row has none. */
let mockPooledEmails: Record<string, string>
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
      // BY DOCUMENT ID (AGL-2219). The cron now reads `usage/{month}`
      // directly for the budget's spend figure: two sweeps write into this
      // collection (the closed month, and the month in progress), so "latest
      // by `computedAt`" answers "whichever cron ran most recently".
      //
      // Modelled faithfully — an id that is not the seeded rollup's month
      // reads as a MISSING document, exactly as Firestore would. A double
      // that returned the rollup for any id would make the wrong-month case
      // below pass for the wrong reason.
      doc: (id: string) => {
        const byId = org.monthRollup ?? org.rollup
        return {
          get: async () =>
            snapshotOf(byId && byId.month === id ? { ...byId } : null),
        }
      },
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
      /**
       * ORDER, LIMIT and START-AFTER are all modelled (AGL-2220).
       *
       * The sweep is chunked now, and `limit: () => api` — a stub that
       * accepts the call and ignores it — would hand back every seeded org on
       * every page. The cursor could then be wrong in any direction and this
       * suite would never notice: a page that skipped orgs, a cursor that
       * never advanced, an infinite loop. The whole point of the change is
       * that the sweep is bounded and resumable, so the double has to be able
       * to express a boundary.
       */
      const build = (
        limit: number | null,
        startAfter: string | null,
      ): any => {
        const api: any = {
          orderBy: () => api,
          limit: (size: number) => build(size, startAfter),
          startAfter: (ref: any) =>
            build(limit, typeof ref === 'string' ? ref : ref?.id),
          get: async () => {
            const ordered = [...mockOrgs].sort((a, b) =>
              a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
            )
            // Strictly greater than: the cursor names an org already
            // finished, so including it would redo one org per resume.
            const remaining = startAfter
              ? ordered.filter((org) => org.id > startAfter)
              : ordered
            const page =
              limit == null ? remaining : remaining.slice(0, limit)
            return { docs: page.map(fakeOrgDoc), size: page.length }
          },
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
      return build(null, null)
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
  // The auth-pool fallback for an owner/admin whose member document carries no
  // denormalized email (AGL-2234). A wholesale `jest.mock` is a CLOSED WORLD:
  // omitting this would fail as "not a function" inside the fan-out, which
  // reads as a broken suite rather than as a missing recipient.
  findUserByUidAcrossPools: async (uid: string) =>
    mockPooledEmails[uid] ? { record: { email: mockPooledEmails[uid] } } : null,
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
  // The route stamps and reads the free-plan bandwidth cap through the same
  // barrel (AGL-2155); a stubbed export here would fail as "not a function"
  // rather than as anything to do with this suite's subject.
  ...jest.requireActual('../../../libs/aglyn/src/lib/app-utils/bandwidth-cap'),
  buildRoute: () => '/acme/billing',
  Route: { MANAGE_BILLING: 'MANAGE_BILLING' },
  ORG_BILLING_SUBCOLLECTION: 'billing',
  ORG_BILLING_DOC_ID: 'billing',
  // The BODY IS REAL (AGL-2220). It used to be a hardcoded `{}`, which was
  // harmless while the route ignored it and became a lie the moment the sweep
  // grew a `cursor` and a `limit`: every pagination assertion would have run
  // against the first page forever, and passed.
  pluginRequestFromWeb: async (request: Request) => ({
    method: request.method,
    query: {},
    body: await request
      .clone()
      .json()
      .catch(() => ({})),
    headers: {
      'x-cron-secret': request.headers.get('x-cron-secret') ?? undefined,
    },
  }),
}))

jest.mock('../utils/screen-cap-reconciliation', () => ({
  __esModule: true,
  measureScreenCaps: async () => ({ maxBillable: 0, overCapHostIds: [] }),
  screenCapReading: async () => ({ maxBillable: 0, overCapHostIds: [] }),
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

async function run(body?: Record<string, unknown>) {
  mockNotifications = []
  mockStaffNotifications = []
  mockEmails = []
  mockGuardWrites = []
  return runChunk(body)
}

/** One invocation, WITHOUT clearing what earlier chunks recorded. */
async function runChunk(body?: Record<string, unknown>) {
  const response = await POST(
    new Request('https://app.aglyn.com/api/billing/usage-alerts', {
      method: 'POST',
      headers: {
        'x-cron-secret': CRON_SECRET,
        ...(body ? { 'content-type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    }),
  )
  expect(response.status).toBe(200)
  return response.json() as Promise<Record<string, any>>
}

const budgetAlerts = () =>
  mockNotifications.filter((entry) => entry.title.includes('usage budget'))

/**
 * A captured send's recipients as a list.
 *
 * `sendEmail` takes one address or many, and since AGL-2234 both shapes are
 * really used — the org fan-out passes an array, the staff alert a single
 * `STAFF_ALERT_EMAIL`. Normalizing here keeps the union honest in the fixture
 * instead of pretending every send is a fan-out.
 */
const recipientsOf = (entry: { to: string[] | string }): string[] =>
  Array.isArray(entry.to) ? [...entry.to] : [entry.to]

beforeEach(() => {
  process.env.CRON_SECRET = CRON_SECRET
  delete process.env.USAGE_ALERT_APPROACH_PCT
  delete process.env.BILL_ASSIST_TOKENS_FROM
  delete process.env.ASSIST_ORG_MONTHLY_COGS_ALERT_USD
  delete process.env.AUTO_LOCK_BILLING_FROM
  delete process.env.STAFF_ALERT_EMAIL
  jest.clearAllMocks()
  mockOrgs = []
  mockPooledEmails = {}
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

  it('reads THIS month by id, not whichever sweep wrote last', async () => {
    // The latest document by `computedAt` is LAST month's — the state the
    // 02:00 closed-month sweep leaves behind whenever it runs after the
    // 07:00 in-progress one (a manual backfill, a retried chunk, a schedule
    // reorder). The current month's rollup exists and says $25.00.
    //
    // Under the old `orderBy('computedAt').limit(1)` read this org went
    // SILENT, because the month comparison correctly refused July's figure
    // for an August budget. Reading by id makes the answer a property of the
    // document's name instead of a property of two crons' running order.
    //
    // Forced red by reverting the route to `rollup?.get(...)`: no alert.
    mockOrgs = [
      seededOrg({
        rollup: { month: LAST_MONTH, billedCents: 999_00 },
        monthRollup: { month: MONTH, billedCents: 2_500 },
        usageBudget: { amountUsd: 50 },
      }),
    ]
    await run()
    expect(budgetAlerts()).toHaveLength(1)
    expect(budgetAlerts()[0].body).toContain('$25.00')
    // …and NOT the $999.00 the stale latest document carries.
    expect(budgetAlerts()[0].body).not.toContain('999')
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
    expect(recipientsOf(mail[0]).sort()).toEqual([
      'admin@acme.test',
      'owner@acme.test',
    ])
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

describe('an alert that reaches nobody says so (AGL-2234)', () => {
  /** One org over its $50 budget, with whatever member roster is given. */
  function overBudget(members: SeededOrg['members']) {
    return [
      seededOrg({
        monthRollup: { month: MONTH, billedCents: 5_000 },
        usageBudget: { amountUsd: 50 },
        members,
      }),
    ]
  }

  const budgetRow = (payload: Record<string, any>) =>
    (payload['details'] as Array<Record<string, any>>).find(
      (entry) => entry['quota'] === 'budget',
    )

  it('records that the budget alert was emailed', async () => {
    mockOrgs = overBudget([{ id: 'u1', role: 'owner', email: 'owner@acme.test' }])
    const payload = await run()
    expect(budgetRow(payload)).toMatchObject({ emailed: true })
  })

  it('records when it reached NOBODY, and why', async () => {
    // THE NEGATIVE CONTROL, and the reason the field exists. The alert fires,
    // the dedupe guard is written, and that threshold is now silent for the
    // rest of the month — so a fan-out that resolved to zero addresses has to
    // be legible in the run's own output or it is invisible forever.
    mockOrgs = overBudget([{ id: 'u1', role: 'owner' }])
    const payload = await run()
    expect(budgetAlerts()).toHaveLength(1) // it DID fire
    expect(budgetRow(payload)).toMatchObject({
      emailed: false,
      emailReason: 'no-recipient',
    })
    expect(mockEmails).toHaveLength(0)
  })

  it('reaches an owner whose member row carries no email, through the pools', async () => {
    // `createOrganization` writes `email: ownerEmail ?? null`, so an owner
    // from an identity that carried no address leaves the org with no billing
    // mail at all. Same fixture as the case above, one pooled record added.
    mockOrgs = overBudget([{ id: 'u1', role: 'owner' }])
    mockPooledEmails = { u1: 'Owner@Acme.test' }
    const payload = await run()
    expect(budgetRow(payload)).toMatchObject({ emailed: true })
    expect(recipientsOf(mockEmails[0])).toEqual(['owner@acme.test'])
  })

  it('does NOT chase a member who is neither owner nor admin', async () => {
    // The fallback must not become a lookup per member: that is the unbounded
    // read the original comment was right to refuse.
    mockOrgs = overBudget([
      { id: 'u1', role: 'owner', email: 'owner@acme.test' },
      { id: 'u2', role: 'editor' },
    ])
    mockPooledEmails = { u2: 'editor@acme.test' }
    await run()
    expect(recipientsOf(mockEmails[0])).toEqual(['owner@acme.test'])
  })
})

describe('the Assist margin alert reaches staff by EMAIL too (AGL-2234)', () => {
  function bigAssistSpend() {
    return [
      seededOrg({
        assistEstCostUsd: 40,
        monthRollup: { month: MONTH, billedCents: 0 },
      }),
    ]
  }

  const marginRow = (payload: Record<string, any>) =>
    (payload['details'] as Array<Record<string, any>>).find(
      (entry) => entry['quota'] === 'assistCogs',
    )

  it('emails STAFF_ALERT_EMAIL with the same words as the bell', async () => {
    // `notifyStaff` writes `users/{uid}/notifications` and nothing turns that
    // into mail — the identical defect AGL-2052 removed one audience over.
    process.env.STAFF_ALERT_EMAIL = 'staff@aglyn.com'
    mockOrgs = bigAssistSpend()
    const payload = await run()

    expect(mockStaffNotifications).toHaveLength(1)
    const staffMail = mockEmails.filter(
      (entry) => entry.context === 'assist-margin',
    )
    expect(staffMail).toHaveLength(1)
    expect(staffMail[0].to).toBe('staff@aglyn.com')
    // ONE set of words for both channels: an inbox and a bell disagreeing
    // about the same number is how somebody ends up arguing with the alert.
    expect(staffMail[0].subject).toBe(mockStaffNotifications[0].title)
    expect(staffMail[0].text).toContain(mockStaffNotifications[0].body)
    expect(marginRow(payload)).toMatchObject({ emailed: true })
  })

  it('does not mail the CUSTOMER about our margin', async () => {
    // The org is not being charged for Assist and has done nothing wrong.
    process.env.STAFF_ALERT_EMAIL = 'staff@aglyn.com'
    mockOrgs = bigAssistSpend()
    await run()
    for (const entry of mockEmails) {
      expect(recipientsOf(entry)).not.toContain('owner@acme.test')
    }
  })

  it('reports unconfigured rather than pretending, with no address set', async () => {
    // The ordinary answer in local and preview environments. It must not read
    // as a delivered alert, and it must not throw.
    mockOrgs = bigAssistSpend()
    const payload = await run()
    expect(mockStaffNotifications).toHaveLength(1)
    expect(
      mockEmails.filter((entry) => entry.context === 'assist-margin'),
    ).toHaveLength(0)
    expect(marginRow(payload)).toMatchObject({
      emailed: false,
      emailReason: 'unconfigured',
    })
  })
})

describe('the sweep is bounded, resumable and honest about it (AGL-2220)', () => {
  /** Five orgs, each over its own $50 budget, ids ordered so pages are legible. */
  function fiveOverBudgetOrgs() {
    return ['org-a', 'org-b', 'org-c', 'org-d', 'org-e'].map((id) =>
      seededOrg({
        id,
        monthRollup: { month: MONTH, billedCents: 5_000 },
        usageBudget: { amountUsd: 50 },
      }),
    )
  }

  it('reports how far it got, and does NOT claim to be done', async () => {
    // THE DEFECT. The old sweep took `limit(500)` with no cursor and returned
    // `alerted: N` whether it had covered the platform or stopped at 500 —
    // and `alerted: 0` is the answer we want most days, so a truncated sweep
    // was indistinguishable from a quiet one. Now it says which.
    mockOrgs = fiveOverBudgetOrgs()
    const first = await run({ limit: 2 })
    expect(first['swept']).toBe(2)
    expect(first['done']).toBe(false)
    expect(first['nextCursor']).toBe('org-b')
    expect(budgetAlerts()).toHaveLength(2)
  })

  it('the caller\u2019s loop reaches EVERY org, exactly once', async () => {
    // The property the ceiling removed: an org past the page boundary got no
    // quota alert, no budget alert, no margin alert, no bandwidth cap and no
    // auto-lock. Driven the way `scheduled-crons.yml` drives it — re-POST
    // with the cursor until `done`.
    mockOrgs = fiveOverBudgetOrgs()
    await run({ limit: 2 })
    let payload = { done: false, nextCursor: 'org-b' } as Record<string, any>
    let pages = 1
    while (!payload['done']) {
      payload = await runChunk({ limit: 2, cursor: payload['nextCursor'] })
      pages += 1
      expect(pages).toBeLessThanOrEqual(10)
    }
    expect(payload['done']).toBe(true)
    expect(payload['nextCursor']).toBeNull()

    const alerted = budgetAlerts().map((entry) => entry.orgId).sort()
    expect(alerted).toEqual(['org-a', 'org-b', 'org-c', 'org-d', 'org-e'])
    // Exactly once each: a cursor that included the org it names would redo
    // one org per resume, and the dedupe guard is written at the END of an
    // org's pass, so a double visit inside one sweep would double-mail.
    expect(new Set(alerted).size).toBe(alerted.length)
  })

  it('finishes in ONE page when the platform fits', async () => {
    // The ordinary case, and the one that must not have grown a second
    // invocation: a small platform is still one call.
    mockOrgs = fiveOverBudgetOrgs()
    const payload = await run()
    expect(payload['swept']).toBe(5)
    expect(payload['done']).toBe(true)
    expect(payload['nextCursor']).toBeNull()
    expect(budgetAlerts()).toHaveLength(5)
  })

  it('ignores a cursor that is not an org id, rather than throwing', async () => {
    // `.doc('')` throws SYNCHRONOUSLY, at construction, outside any `.catch()`
    // on the promise, and a slash builds a ref to a deeper path instead of
    // refusing. Either would take down the whole sweep — including the
    // billing auto-lock it hosts — on a malformed resume.
    mockOrgs = fiveOverBudgetOrgs()
    for (const bad of ['', 'orgs/org-a', 42, null]) {
      const payload = await run({ cursor: bad })
      expect(payload['swept']).toBe(5)
      expect(payload['done']).toBe(true)
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
