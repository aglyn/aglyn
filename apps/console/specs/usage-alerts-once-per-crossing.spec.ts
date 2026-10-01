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
 * A LIMIT NOTICE IS SENT ONCE PER CROSSING (AGL-3431).
 *
 * ## What was broken
 *
 * Every guard in `orgs/{id}.usageAlerts` was `{ month, threshold }` and the
 * sweep re-sent any threshold whose guard named another month. For a meter
 * that resets on the 1st that is right. For a quota the workspace HAS — its
 * sites, the pages on a site, its datasets, its stored bytes — it meant a
 * workspace sitting at its limit was told so again on the 1st of every month,
 * forever: production shows the same "You've reached your sites limit" landing
 * on 07-25, 08-01 and 09-01 for one workspace. And each notice went out twice
 * to an admin who had switched billing email on: once from the notification
 * channel inside `notifyOrgAdmins`, once from the sweep's own email.
 *
 * ## What this suite pins
 *
 * Driven through the REAL route with the REAL plan table and a Firestore
 * double that PERSISTS writes with Firestore's deep merge and models
 * `FieldValue.delete()`, across runs on different days:
 *
 *  - a count quota at 100% is announced on day one, not on day two, not next
 *    month; it re-arms when usage falls below and is announced again on the
 *    re-crossing;
 *  - a guard from an earlier month counts as announced, so shipping this does
 *    not mail every workspace already at a limit;
 *  - a monthly meter still announces the same threshold in a new month;
 *  - one crossing is one email per person;
 *  - the body stands on its own: what the limit is on, which site, which
 *    workspace, and — for a limit that refuses rather than bills — that
 *    nothing is charged.
 */

const CRON_SECRET = 'test-cron-secret'

/** The `FieldValue.delete()` sentinel, as this double models it. */
const mockDeleteSentinel = { __delete: true } as const

const DAY_ONE = new Date('2026-10-05T08:00:00Z')
const DAY_TWO = new Date('2026-10-06T08:00:00Z')
const DAY_THREE = new Date('2026-10-07T08:00:00Z')
const NEXT_MONTH = new Date('2026-11-02T08:00:00Z')
const MONTH = '2026-10'
const LAST_MONTH = '2026-09'

interface SeededHost {
  id: string
  orgId: string
  displayName?: string
  subdomain?: string
  pageViews?: number
}

let orgStore: Record<string, Record<string, unknown>>
let mockHosts: SeededHost[]
/** The screen-cap reading the route is handed, and the rows a measure finds. */
let mockScreens: { maxBillable: number; overCapHostIds: string[] }
let mockScreenRows: Array<{ hostId: string; billable: number }> | null
let mockNotifications: Array<{
  orgId: string
  title: string
  body: string
  options?: { skipEmail?: boolean }
}>
let mockEmails: Array<{ orgId: string; subject: string; text: string }>

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  )
}

/** `set(data, { merge: true })`: a DEEP merge, with the delete sentinel. */
function mergeInto(
  target: Record<string, unknown>,
  patch: Record<string, unknown>,
): void {
  for (const [key, value] of Object.entries(patch)) {
    if (value === mockDeleteSentinel) {
      delete target[key]
      continue
    }
    if (isPlainObject(value) && isPlainObject(target[key])) {
      mergeInto(target[key] as Record<string, unknown>, value)
      continue
    }
    target[key] = isPlainObject(value) ? { ...value } : value
  }
}

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

function analyticsCollection(pageViews: number): any {
  const api: any = {
    where: () => api,
    get: async () => ({
      docs: [
        {
          id: `${MONTH}-01`,
          get: (field: string) => (field === 'total' ? pageViews : undefined),
        },
      ],
    }),
  }
  return api
}

function fakeHostDoc(host: SeededHost) {
  const fields: Record<string, unknown> = {
    screens: {},
    displayName: host.displayName,
    subdomain: host.subdomain,
  }
  return {
    id: host.id,
    get: (field: string) => fields[field],
    ref: {
      id: host.id,
      collection: (name: string) =>
        name === 'analytics'
          ? analyticsCollection(host.pageViews ?? 0)
          : emptyCollection(),
    },
  }
}

function fakeOrgDoc(orgId: string) {
  const data = orgStore[orgId]
  return {
    id: orgId,
    // A DEEP snapshot, like a real `data()` — see usage-alerts-plan-less-orgs.
    data: () => JSON.parse(JSON.stringify(data)) as Record<string, unknown>,
    get: (field: string) => data[field],
    ref: {
      id: orgId,
      set: async (
        value: Record<string, unknown>,
        options?: { merge?: boolean },
      ) => {
        if (!options?.merge) {
          for (const key of Object.keys(data)) delete data[key]
        }
        mergeInto(data, value)
      },
      collection: () => emptyCollection(),
    },
  }
}

const fakeFirestore = {
  collection: (name: string) => {
    if (name === 'orgs') {
      const build = (limit: number | null, startAfter: string | null): any => {
        const api: any = {
          orderBy: () => api,
          limit: (size: number) => build(size, startAfter),
          startAfter: (ref: any) =>
            build(limit, typeof ref === 'string' ? ref : ref?.id),
          get: async () => {
            const ordered = Object.keys(orgStore).sort()
            const remaining = startAfter
              ? ordered.filter((id) => id > startAfter)
              : ordered
            const page = limit == null ? remaining : remaining.slice(0, limit)
            return { docs: page.map(fakeOrgDoc), size: page.length }
          },
          doc: (orgId: string) => ({ id: orgId }),
        }
        return api
      }
      return build(null, null)
    }
    if (name === 'hosts') {
      const build = (limit: number | null, startAfter: string | null): any => {
        let orgId = ''
        const api: any = {
          where: (_field: string, _op: string, value: string) => {
            orgId = value
            return api
          },
          orderBy: () => api,
          limit: (size: number) => {
            const next = build(size, startAfter)
            next.where('orgId', '==', orgId)
            return next
          },
          startAfter: (ref: any) => {
            const next = build(limit, typeof ref === 'string' ? ref : ref?.id)
            next.where('orgId', '==', orgId)
            return next
          },
          get: async () => {
            const ordered = [...mockHosts]
              .filter((host) => host.orgId === orgId)
              .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
            const remaining = startAfter
              ? ordered.filter((host) => host.id > startAfter)
              : ordered
            const page = limit == null ? remaining : remaining.slice(0, limit)
            return { docs: page.map(fakeHostDoc), size: page.length }
          },
          doc: (hostId: string) => ({ id: hostId }),
        }
        return api
      }
      return build(null, null)
    }
    return emptyCollection()
  },
}

jest.mock('firebase-admin/firestore', () => ({
  ...jest.requireActual('firebase-admin/firestore'),
  FieldValue: {
    delete: () => mockDeleteSentinel,
    serverTimestamp: () => 'SERVER_TIMESTAMP',
  },
}))

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  firebaseAdmin: {
    app: () => ({ firestore: () => fakeFirestore }),
    firestore: { FieldPath: { documentId: () => '__name__' } },
  },
  notifyOrgAdmins: async (
    orgId: string,
    payload: { title: string; body: string },
    options?: { skipEmail?: boolean },
  ) => {
    mockNotifications.push({
      orgId,
      title: payload.title,
      body: payload.body,
      options,
    })
  },
  notifyStaff: async () => undefined,
}))

// Asserted, never sent.
jest.mock('../app/api/_lib/usage-alert-email', () => ({
  __esModule: true,
  consoleOrigin: () => 'https://app.aglyn.com',
  emailFailureReason: () => null,
  emailOrgAdmins: async (input: {
    orgId: string
    subject: string
    text: string
  }) => {
    mockEmails.push({
      orgId: input.orgId,
      subject: input.subject,
      text: input.text,
    })
    return { sent: true }
  },
  emailStaffAlert: async () => ({ sent: true }),
}))

jest.mock('@aglyn/aglyn/server', () => ({
  __esModule: true,
  // The REAL plan table: free's 5 pages per site and 1 site are what decide
  // whether a notice is due at all.
  ...jest.requireActual(
    '../../../libs/aglyn/src/lib/app-utils/plan-entitlements',
  ),
  ...jest.requireActual('../../../libs/aglyn/src/lib/app-utils/bandwidth-cap'),
  buildRoute: () => '/ready-to-roll/billing/usage',
  Route: { MANAGE_BILLING_USAGE: 'MANAGE_BILLING_USAGE' },
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
  screenCapReading: async () => ({ ...mockScreens }),
  measureScreenCaps: async (hosts: Array<{ id: string }>) => {
    const rows = (
      mockScreenRows ??
      hosts.map((host) => ({ hostId: host.id, billable: mockScreens.maxBillable }))
    ).map((row) => ({ ...row, limit: 0, overBy: 0 }))
    return {
      rows,
      maxBillable: Math.max(0, ...rows.map((row) => row.billable)),
      limit: 0,
      overCapHostIds: [],
    }
  },
}))

import { POST } from '../app/api/billing/usage-alerts/route'
import { pageViewsFromBandwidthGb } from '../utils/usage-metering'
import { PLAN_ENTITLEMENTS } from '@aglyn/aglyn/server'

/**
 * Ready To Roll's pages per site: 6, from the `entitlements` override its org
 * document carries in production (free's table says 5).
 */
const RTR_PAGES = 6

/** Past free's monthly bandwidth band. */
const OVER_BANDWIDTH = Math.round(
  pageViewsFromBandwidthGb(PLAN_ENTITLEMENTS.free.bandwidthGb) * 1.2,
)

/**
 * A plan-ful free workspace with one site — the Ready To Roll shape.
 *
 * `plan` is set so the AGL-2420 first-sweep seed does not apply: this suite is
 * about what happens to an org the sweep already knows.
 */
function readyToRoll(guards: Record<string, unknown> = {}) {
  orgStore = {
    rtr: {
      name: 'Ready To Roll',
      slug: 'ready-to-roll',
      plan: 'free',
      entitlements: { screensPerHost: RTR_PAGES },
      usageAlerts: {
        // The one site against `hostLimit: 1` sits at 100% of the sites
        // quota, and has since before this shipped: a LEGACY guard from an
        // earlier month, which must count as announced.
        hosts: { month: LAST_MONTH, threshold: 100 },
        ...guards,
      },
    },
  }
  mockHosts = [
    {
      id: 'host-rtr',
      orgId: 'rtr',
      displayName: 'Ready To Roll',
      subdomain: 'ready-to-roll',
    },
  ]
}

async function run(on: Date) {
  jest.setSystemTime(on)
  const response = await POST(
    new Request('https://app.aglyn.com/api/billing/usage-alerts', {
      method: 'POST',
      headers: { 'x-cron-secret': CRON_SECRET },
    }),
  )
  expect(response.status).toBe(200)
  return (await response.json()) as Record<string, any>
}

const guardsOf = (orgId: string) =>
  (orgStore[orgId]?.['usageAlerts'] ?? {}) as Record<
    string,
    { month: string; threshold: number }
  >

const pageNotices = () =>
  mockNotifications.filter((entry) => entry.title.includes('pages on a site'))
const pageEmails = () =>
  mockEmails.filter((entry) => entry.subject.includes('pages on a site'))

beforeEach(() => {
  jest.useFakeTimers({
    // Only the clock: the route awaits real promises throughout.
    doNotFake: [
      'nextTick',
      'queueMicrotask',
      'setImmediate',
      'clearImmediate',
      'setTimeout',
      'clearTimeout',
      'setInterval',
      'clearInterval',
      'hrtime',
      'performance',
    ],
  })
  process.env.CRON_SECRET = CRON_SECRET
  delete process.env.AUTO_LOCK_BILLING_FROM
  orgStore = {}
  mockHosts = []
  mockScreens = { maxBillable: 0, overCapHostIds: [] }
  mockScreenRows = null
  mockNotifications = []
  mockEmails = []
})

afterEach(() => {
  jest.useRealTimers()
})

describe('a count quota is announced once per crossing (AGL-3431)', () => {
  it('announces a site at its page limit on day one — and not on day two, nor next month', async () => {
    readyToRoll()
    mockScreens = { maxBillable: RTR_PAGES, overCapHostIds: [] }

    await run(DAY_ONE)
    expect(pageNotices()).toHaveLength(1)
    expect(pageEmails()).toHaveLength(1)
    expect(guardsOf('rtr')['screens']).toEqual({ month: MONTH, threshold: 100 })

    await run(DAY_TWO)
    // The month guard stopped this. The next one is what it could not stop.
    expect(pageNotices()).toHaveLength(1)

    await run(NEXT_MONTH)
    // Still at the limit on the 2nd of the next month: nothing new happened,
    // so nothing is sent. Before AGL-3431 this run mailed the notice again.
    expect(pageNotices()).toHaveLength(1)
    expect(pageEmails()).toHaveLength(1)
  })

  it('re-arms when the site drops below, and announces the re-crossing', async () => {
    readyToRoll()
    mockScreens = { maxBillable: RTR_PAGES, overCapHostIds: [] }
    await run(DAY_ONE)
    expect(pageNotices()).toHaveLength(1)

    // Pages deleted: 3 of 5 is under every band.
    mockScreens = { maxBillable: 3, overCapHostIds: [] }
    const dropped = await run(DAY_TWO)
    expect(pageNotices()).toHaveLength(1)
    // Removed with a DELETE inside the delta, and reported as such…
    expect(guardsOf('rtr')['screens']).toBeUndefined()
    expect(dropped['rearmed']).toBe(1)
    expect(dropped['rearmedDetails']).toEqual([
      { orgId: 'rtr', quota: 'screens', threshold: 0 },
    ])
    // …without disturbing the keys it did not decide.
    expect(guardsOf('rtr')['hosts']).toEqual({ month: LAST_MONTH, threshold: 100 })

    // Back at the limit: a new crossing, announced like the first.
    mockScreens = { maxBillable: RTR_PAGES, overCapHostIds: [] }
    await run(DAY_THREE)
    expect(pageNotices()).toHaveLength(2)
    expect(pageEmails()).toHaveLength(2)
  })

  it('lowers the guard to the approach band without announcing the drop', async () => {
    readyToRoll()
    mockScreens = { maxBillable: RTR_PAGES, overCapHostIds: [] }
    await run(DAY_ONE)

    // 5 of 6 is inside the 80% band: already announced on the way up, so
    // nothing is sent — but the 100% step is armed again.
    mockScreens = { maxBillable: RTR_PAGES - 1, overCapHostIds: [] }
    await run(DAY_TWO)
    expect(pageNotices()).toHaveLength(1)
    expect(guardsOf('rtr')['screens']).toEqual({ month: MONTH, threshold: 80 })

    mockScreens = { maxBillable: RTR_PAGES, overCapHostIds: [] }
    await run(DAY_THREE)
    expect(pageNotices()).toHaveLength(2)
    expect(pageNotices()[1].title).toContain('reached')
  })

  it('counts a guard from an earlier month as announced — no re-mail wave on deploy', async () => {
    // What every workspace already at a limit holds today: month-scoped
    // guards from September or before.
    readyToRoll({ screens: { month: LAST_MONTH, threshold: 100 } })
    mockScreens = { maxBillable: RTR_PAGES, overCapHostIds: [] }

    await run(DAY_ONE)

    expect(mockNotifications).toHaveLength(0)
    expect(mockEmails).toHaveLength(0)
    // …and the guards are left as they were rather than rewritten.
    expect(guardsOf('rtr')).toEqual({
      hosts: { month: LAST_MONTH, threshold: 100 },
      screens: { month: LAST_MONTH, threshold: 100 },
    })
  })

  it('still announces the NEXT step past a legacy guard', async () => {
    // Announced at 80% in September; reaching the limit is new.
    readyToRoll({ screens: { month: LAST_MONTH, threshold: 80 } })
    mockScreens = { maxBillable: RTR_PAGES, overCapHostIds: [] }

    await run(DAY_ONE)

    expect(pageNotices()).toHaveLength(1)
    expect(pageNotices()[0].title).toContain('reached')
  })
})

/**
 * A Pro workspace with one site, for a BIG limit: 100 pages per site, so each
 * of the four steps is its own reading.
 */
const PRO_PAGES = PLAN_ENTITLEMENTS.pro.screensPerHost as number

function proSite(guards: Record<string, unknown> = {}) {
  orgStore = {
    acme: { name: 'Acme', slug: 'acme', plan: 'pro', usageAlerts: { ...guards } },
  }
  mockHosts = [{ id: 'host-acme', orgId: 'acme', displayName: 'Acme Shop' }]
}

const atPages = (pages: number) => {
  mockScreens = { maxBillable: pages, overCapHostIds: [] }
}

describe('the four steps — 75, 80, 90, 100 — each once (AGL-3431)', () => {
  it('steps through every band on a big limit, announcing each exactly once', async () => {
    expect(PRO_PAGES).toBe(100)
    proSite()
    const days = [
      [75, 'above 75%'],
      [76, null],
      [80, 'above 80%'],
      [85, null],
      [90, 'above 90%'],
      [99, null],
      [100, 'reached'],
      [100, null],
    ] as const
    let day = 1
    for (const [pages, expected] of days) {
      const before = pageNotices().length
      atPages(pages)
      await run(new Date(Date.UTC(2026, 9, day++, 8)))
      const sent = pageNotices().slice(before)
      if (expected === null) {
        expect({ pages, sent: sent.length }).toEqual({ pages, sent: 0 })
      } else {
        expect({ pages, sent: sent.length }).toEqual({ pages, sent: 1 })
        expect(sent[0].title).toContain(expected)
      }
    }
    expect(pageNotices()).toHaveLength(4)
    expect(pageEmails()).toHaveLength(4)
  })

  it('a jump straight to 95% sends ONE 90% notice, not 75, 80 and 90', async () => {
    proSite()
    atPages(95)
    await run(DAY_ONE)
    expect(pageNotices()).toHaveLength(1)
    expect(pageNotices()[0].title).toBe("You're above 90% of your pages on a site quota")
    expect(guardsOf('acme')['screens']).toEqual({ month: MONTH, threshold: 90 })
  })

  it('a small limit of 6 sends 80 at 5 pages and 100 at 6 — nothing at 4', async () => {
    readyToRoll()
    atPages(4)
    await run(DAY_ONE)
    // 4 of 6 is 67%: under every step.
    expect(pageNotices()).toHaveLength(0)

    atPages(5)
    await run(DAY_TWO)
    expect(pageNotices()).toHaveLength(1)
    expect(pageNotices()[0].title).toContain('above 80%')

    atPages(6)
    await run(DAY_THREE)
    expect(pageNotices()).toHaveLength(2)
    expect(pageNotices()[1].title).toContain('reached')
  })

  it('dropping from 90 to 85% lowers the guard to 80, and 90 is announced again', async () => {
    proSite()
    atPages(90)
    await run(DAY_ONE)
    atPages(85)
    await run(DAY_TWO)
    expect(pageNotices()).toHaveLength(1)
    expect(guardsOf('acme')['screens']).toEqual({ month: MONTH, threshold: 80 })
    atPages(91)
    await run(DAY_THREE)
    expect(pageNotices()).toHaveLength(2)
    expect(pageNotices()[1].title).toContain('above 90%')
  })

  it('a legacy 80 guard: 83% sends nothing, 92% sends 90', async () => {
    proSite({ screens: { month: LAST_MONTH, threshold: 80 } })
    atPages(83)
    await run(DAY_ONE)
    expect(pageNotices()).toHaveLength(0)
    expect(guardsOf('acme')['screens']).toEqual({ month: LAST_MONTH, threshold: 80 })

    atPages(92)
    await run(DAY_TWO)
    expect(pageNotices()).toHaveLength(1)
    expect(pageNotices()[0].title).toContain('above 90%')
  })
})

describe('a monthly meter still announces the same threshold in a new month', () => {
  it('re-announces bandwidth past the band next month, once', async () => {
    readyToRoll()
    mockHosts[0].pageViews = OVER_BANDWIDTH
    const bandwidthNotices = () =>
      mockNotifications.filter((entry) => /bandwidth/i.test(entry.title))

    await run(DAY_ONE)
    expect(bandwidthNotices()).toHaveLength(1)

    await run(DAY_TWO)
    expect(bandwidthNotices()).toHaveLength(1)

    // The meter reset on the 1st and was crossed again: a new crossing.
    await run(NEXT_MONTH)
    expect(bandwidthNotices()).toHaveLength(2)
    expect(guardsOf('rtr')['bandwidth']).toEqual({
      month: '2026-11',
      threshold: 100,
    })
  })
})

describe('a monthly meter steps within the month and starts over the next', () => {
  it('80 then 90 in October, once each, and 80 again in November', async () => {
    readyToRoll()
    const band = pageViewsFromBandwidthGb(PLAN_ENTITLEMENTS.free.bandwidthGb)
    const bandwidthNotices = () =>
      mockNotifications.filter((entry) => /bandwidth/i.test(entry.title))

    mockHosts[0].pageViews = Math.round(band * 0.82)
    await run(DAY_ONE)
    await run(DAY_TWO)
    expect(bandwidthNotices().map((entry) => entry.title)).toEqual([
      "You're above 80% of your monthly bandwidth quota",
    ])

    mockHosts[0].pageViews = Math.round(band * 0.92)
    await run(DAY_THREE)
    expect(bandwidthNotices()).toHaveLength(2)
    expect(bandwidthNotices()[1].title).toContain('above 90%')

    // The meter reset on the 1st; 82% of November is a new crossing of 80.
    mockHosts[0].pageViews = Math.round(band * 0.82)
    await run(NEXT_MONTH)
    expect(bandwidthNotices()).toHaveLength(3)
    expect(bandwidthNotices()[2].title).toContain('above 80%')
  })
})

describe('one crossing is one email per person', () => {
  it('writes the console notice WITHOUT its per-person email, and sends the one email itself', async () => {
    readyToRoll()
    mockScreens = { maxBillable: RTR_PAGES, overCapHostIds: [] }

    await run(DAY_ONE)

    // One crossing: one console notice and one email. The notice asks the
    // notification channel not to mail — an admin who switched billing email
    // on was otherwise sent the same notice twice.
    expect(pageNotices()).toHaveLength(1)
    expect(pageNotices()[0].options).toEqual({ skipEmail: true })
    expect(pageEmails()).toHaveLength(1)
    // Every notice this sweep writes carries it, not only this one.
    expect(mockNotifications.every((entry) => entry.options?.skipEmail)).toBe(true)
  })
})

describe('the body stands on its own (AGL-3431)', () => {
  it('names the quota, the site and the workspace, and says nothing is charged', async () => {
    // The notice a client read as "6 of 6 what? And now I have to pay?".
    readyToRoll()
    mockScreens = { maxBillable: RTR_PAGES, overCapHostIds: [] }

    await run(DAY_ONE)

    const [notice] = pageNotices()
    expect(notice.title).toBe("You've reached your pages on a site limit")
    expect(notice.body).toBe(
      `Your site Ready To Roll in the Ready To Roll workspace has ` +
        `${RTR_PAGES} of the ${RTR_PAGES} pages your plan includes per ` +
        'site. Every page already there keeps working and nothing is ' +
        'charged — you only need to upgrade in Billing to add more pages.',
    )
    expect(notice.body).not.toMatch(/\bbilled\b|invoice|screen/i)
    // Both channels carry the same words (AGL-2052).
    expect(pageEmails()[0].text).toContain(notice.body)
  })

  it('says the same on the approach, before anything is refused', async () => {
    readyToRoll()
    mockScreens = { maxBillable: RTR_PAGES - 1, overCapHostIds: [] }

    await run(DAY_ONE)

    const [notice] = pageNotices()
    expect(notice.title).toContain('above 80%')
    expect(notice.body).toContain(
      `Your site Ready To Roll in the Ready To Roll workspace has ` +
        `${RTR_PAGES - 1} of the ${RTR_PAGES} pages your plan includes per site.`,
    )
    expect(notice.body).toContain('nothing is charged')
    expect(notice.body).not.toMatch(/\bbilled\b|invoice/i)
  })

  it('names the workspace on the sites limit, and charges nothing', async () => {
    readyToRoll()
    // No legacy guard this time: the one site IS the limit.
    orgStore['rtr']['usageAlerts'] = {}

    await run(DAY_ONE)

    const sites = mockNotifications.find((entry) => entry.title.includes('sites'))
    expect(sites?.body).toContain(
      'The Ready To Roll workspace has 1 of the 1 sites your plan includes.',
    )
    expect(sites?.body).toContain('nothing is charged')
    expect(sites?.body).not.toMatch(/\bbilled\b|invoice/i)
  })

  it('names the site at the limit in a workspace with several', async () => {
    orgStore = {
      acme: {
        name: 'Acme',
        slug: 'acme',
        plan: 'pro',
        usageAlerts: {},
      },
    }
    mockHosts = [
      { id: 'host-a', orgId: 'acme', displayName: 'Alpha Blog' },
      { id: 'host-b', orgId: 'acme', displayName: 'Beta Shop' },
    ]
    const limit = PLAN_ENTITLEMENTS.pro.screensPerHost as number
    mockScreens = { maxBillable: limit, overCapHostIds: [] }
    mockScreenRows = [
      { hostId: 'host-a', billable: 12 },
      { hostId: 'host-b', billable: limit },
    ]

    await run(DAY_ONE)

    const [notice] = pageNotices()
    expect(notice.body).toContain(
      `Your site Beta Shop in the Acme workspace has ${limit} of the ${limit} ` +
        'pages your plan includes per site.',
    )
    expect(notice.body).not.toContain('Alpha Blog')
  })
})
