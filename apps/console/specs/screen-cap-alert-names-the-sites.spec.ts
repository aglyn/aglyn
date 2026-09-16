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
 * THE SCREEN-CAP ALERT NAMES THE SITES (AGL-2321).
 *
 * `report-usage` has written `screensOverCapHostIds` onto
 * `orgs/{id}/usage/{month}` beside `maxBillableScreens` since AGL-1390 — and
 * wrote it precisely because three separate ways past the create-time gate
 * were found in one night. Nothing ever read it back.
 *
 * So `usage-alerts` told an owner a site was past its screen cap and could not
 * say WHICH, with the list sitting on the very document it had already fetched
 * for the number it did use. On an org with a hundred sites that is an alert
 * nobody can act on — and this cron is the ONLY thing on the platform that
 * ever re-asks whether a live site is inside its plan.
 *
 * WHAT THIS FILE HAS TO CATCH:
 *
 *  - THE NAMES ARE THE STORED ONES. Two orgs, different over-cap sites, and
 *    each alert must carry its own. A body wired to a constant, to the first
 *    host in the snapshot, or to "one of your sites" satisfies neither.
 *  - IT SURVIVES THE CACHED PATH. AGL-1440 made the common case read the
 *    recorded figure and scan nothing; an alert that could only name sites
 *    when it had just measured them would go quiet in exactly the steady state
 *    that caching produces.
 *  - IT SAYS NOTHING WHEN THERE IS NOTHING. An org at its cap is an org using
 *    what it bought. "Over the cap: ." on a healthy alert is worse than the
 *    silence it replaced.
 *  - BOTH CHANNELS AGREE. The console notification and the email are built
 *    from one string (AGL-2052); an email that omits the sites is how someone
 *    ends up arguing with support about which one meant it.
 */

const CRON_SECRET = 'test-cron-secret'

interface SeededOrg {
  id: string
  plan: string
  /** `orgs/{id}/usage/{month}` — the document the alert already reads. */
  rollup: Record<string, unknown> | null
}
interface SeededHost {
  id: string
  orgId: string
  subdomain: string
}

let mockOrgs: SeededOrg[]
let mockHosts: SeededHost[]
let mockNotifications: Array<{ orgId: string; title: string; body: string }>
let mockEmails: Array<{ orgId: string; subject: string; text: string }>

const mockNotifyOrgAdmins = jest.fn(
  async (orgId: string, payload: { title: string; body: string }) => {
    mockNotifications.push({ orgId, title: payload.title, body: payload.body })
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
    doc: () => ({
      get: async () => ({ exists: false, get: () => undefined }),
    }),
  }
  return api
}

/**
 * The usage rollup, served BOTH ways the route asks for it.
 *
 * `orderBy('computedAt','desc').limit(1)` is the screen-cap read; `.doc(month)`
 * is the budget read (AGL-2219 moved that one to an id deliberately). A double
 * that answered only one of them would leave this suite asserting against a
 * route that threw halfway.
 */
function usageCollection(org: SeededOrg): any {
  const snapshot = {
    exists: org.rollup != null,
    id: 'month',
    data: () => org.rollup ?? {},
    get: (field: string) => (org.rollup ?? {})[field],
  }
  const api: any = {
    orderBy: () => api,
    limit: () => api,
    where: () => api,
    select: () => api,
    count: () => ({ get: async () => ({ data: () => ({ count: 0 }) }) }),
    get: async () => ({
      docs: org.rollup ? [snapshot] : [],
      size: org.rollup ? 1 : 0,
      empty: org.rollup == null,
    }),
    doc: () => ({ get: async () => snapshot }),
  }
  return api
}

function fakeHostDoc(host: SeededHost) {
  return {
    id: host.id,
    get: (field: string) =>
      field === 'screens' ? {} : field === 'subdomain' ? host.subdomain : undefined,
    ref: {
      id: host.id,
      collection: () => emptyCollection(),
    },
  }
}

function fakeOrgDoc(org: SeededOrg) {
  const data: Record<string, unknown> = { plan: org.plan, slug: org.id }
  return {
    id: org.id,
    data: () => data,
    get: (field: string) => data[field],
    ref: {
      id: org.id,
      set: async () => undefined,
      collection: (name: string) =>
        name === 'usage' ? usageCollection(org) : emptyCollection(),
    },
  }
}

const fakeFirestore = {
  collection: (name: string) => {
    if (name === 'orgs') {
      const api: any = {
        orderBy: () => api,
        limit: () => api,
        startAfter: () => api,
        get: async () => ({
          docs: mockOrgs.map(fakeOrgDoc),
          size: mockOrgs.length,
        }),
        doc: (orgId: string) => ({ id: orgId }),
      }
      return api
    }
    if (name === 'hosts') {
      /**
       * ORDER, LIMIT and an EXCLUSIVE START-AFTER (AGL-2421). The route pages
       * this query now, so a double that answers `where().get()` and nothing
       * else throws "orderBy is not a function" and the whole sweep 500s —
       * which is what happened when only `bandwidth-cap-engages` was updated.
       *
       * Modelled properly rather than stubbed to `() => api`, even though
       * these fixtures never fill a page: an un-modelled limit is exactly
       * what hid the truncation this issue was filed for.
       */
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
            const docs = page.map(fakeHostDoc)
            return { docs, size: docs.length }
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

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  firebaseAdmin: {
    app: () => ({ firestore: () => fakeFirestore }),
    firestore: { FieldPath: { documentId: () => '__name__' } },
  },
  notifyOrgAdmins: (...args: unknown[]) => (mockNotifyOrgAdmins as any)(...args),
}))

jest.mock('@aglyn/aglyn/server', () => ({
  __esModule: true,
  // The REAL entitlements: `screensPerHost` is what decides whether this alert
  // fires at all, and a stub would make the arithmetic unfalsifiable.
  ...jest.requireActual('../../../libs/aglyn/src/lib/app-utils/plan-entitlements'),
  ...jest.requireActual('../../../libs/aglyn/src/lib/app-utils/bandwidth-cap'),
  buildRoute: () => '/org/billing',
  Route: { MANAGE_BILLING: 'MANAGE_BILLING' },
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

/**
 * The email arm is captured, not stubbed away.
 *
 * Both channels are built from one string on purpose (AGL-2052). If only the
 * console body were asserted, an email that dropped the site names would be
 * invisible here — and mail is the channel that reaches someone who is not
 * already staring at the bell.
 */
jest.mock('../app/api/_lib/usage-alert-email', () => ({
  __esModule: true,
  consoleOrigin: () => 'https://app.aglyn.com',
  emailFailureReason: () => null,
  emailStaffAlert: async () => ({ sent: 0 }),
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
    return { sent: 1 }
  },
}))

// NOT mocked: `screen-cap-reconciliation`. The recorded-vs-measured decision
// and the id sanitising are the behaviour under test, and a double for them
// would leave this file asserting that a mock agreed with itself.

import { POST } from '../app/api/billing/usage-alerts/route'

/** Starter allows 25 screens per site, so 40 is comfortably over. */
const OVER = 40

async function run() {
  mockNotifications = []
  mockEmails = []
  const response = await POST(
    new Request('https://app.aglyn.com/api/billing/usage-alerts', {
      method: 'POST',
      headers: { 'x-cron-secret': CRON_SECRET },
    }),
  )
  expect(response.status).toBe(200)
  return mockNotifications
}

const screenAlerts = (orgId: string) =>
  mockNotifications.filter(
    (entry) => entry.orgId === orgId && entry.title.includes('screens on a site'),
  )

beforeEach(() => {
  process.env.CRON_SECRET = CRON_SECRET
  delete process.env.USAGE_ALERT_APPROACH_PCT
  jest.clearAllMocks()
  mockHosts = []
  mockOrgs = []
})

/** A rollup fresh enough that the route reads it instead of scanning. */
const freshRollup = (overCapHostIds: string[]) => ({
  month: '2026-08',
  maxBillableScreens: OVER,
  computedAt: { toMillis: () => Date.now() },
  screensOverCapHostIds: overCapHostIds,
})

describe('the alert names the over-cap sites', () => {
  it('gives each org its OWN sites, off the recorded list', async () => {
    // Two orgs whose over-cap sites differ. An alert body wired to a constant,
    // or to the first host in whichever snapshot is at hand, satisfies at most
    // one of these two assertions.
    mockOrgs = [
      { id: 'org-a', plan: 'starter', rollup: freshRollup(['host-a2']) },
      { id: 'org-b', plan: 'starter', rollup: freshRollup(['host-b1']) },
    ]
    mockHosts = [
      { id: 'host-a1', orgId: 'org-a', subdomain: 'alpha-blog' },
      { id: 'host-a2', orgId: 'org-a', subdomain: 'alpha-shop' },
      { id: 'host-b1', orgId: 'org-b', subdomain: 'beta-docs' },
      { id: 'host-b2', orgId: 'org-b', subdomain: 'beta-news' },
    ]

    await run()

    const a = screenAlerts('org-a')
    const b = screenAlerts('org-b')
    expect(a).toHaveLength(1)
    expect(b).toHaveLength(1)
    expect(a[0].body).toContain('alpha-shop')
    // …and NOT the sibling that is fine. Naming every site would be the same
    // uselessness in a longer sentence.
    expect(a[0].body).not.toContain('alpha-blog')
    expect(b[0].body).toContain('beta-docs')
    expect(b[0].body).not.toContain('beta-news')
  })

  it('names ALL of them when more than one site is over', async () => {
    mockOrgs = [
      {
        id: 'org-a',
        plan: 'starter',
        rollup: freshRollup(['host-a1', 'host-a2']),
      },
    ]
    mockHosts = [
      { id: 'host-a1', orgId: 'org-a', subdomain: 'alpha-blog' },
      { id: 'host-a2', orgId: 'org-a', subdomain: 'alpha-shop' },
    ]

    await run()

    const [alert] = screenAlerts('org-a')
    expect(alert.body).toContain('alpha-blog')
    expect(alert.body).toContain('alpha-shop')
  })

  it('falls back to the id for a site that is no longer there', async () => {
    // Deleted or moved since the rollup ran. Dropping it silently would make
    // the sentence disagree with the count above it, and this is exactly the
    // case a reader most needs to see.
    mockOrgs = [
      { id: 'org-a', plan: 'starter', rollup: freshRollup(['host-gone']) },
    ]
    mockHosts = [{ id: 'host-a1', orgId: 'org-a', subdomain: 'alpha-blog' }]

    await run()

    expect(screenAlerts('org-a')[0].body).toContain('host-gone')
  })

  it('says nothing about sites when none are over', async () => {
    // An org AT its cap is an org using what it bought — the approach alert
    // still fires, and "Over the cap: ." would be worse than saying nothing.
    mockOrgs = [{ id: 'org-a', plan: 'starter', rollup: freshRollup([]) }]
    mockHosts = [{ id: 'host-a1', orgId: 'org-a', subdomain: 'alpha-blog' }]

    await run()

    const [alert] = screenAlerts('org-a')
    // The alert itself still happened — otherwise this assertion proves
    // nothing about the sentence.
    expect(alert).toBeTruthy()
    expect(alert.body).not.toContain('Over the cap')
  })
})

describe('both channels carry the same sentence', () => {
  it('puts the site names in the EMAIL too, not just the bell', async () => {
    mockOrgs = [
      { id: 'org-a', plan: 'starter', rollup: freshRollup(['host-a2']) },
    ]
    mockHosts = [
      { id: 'host-a1', orgId: 'org-a', subdomain: 'alpha-blog' },
      { id: 'host-a2', orgId: 'org-a', subdomain: 'alpha-shop' },
    ]

    await run()

    const email = mockEmails.find((entry) =>
      entry.subject.includes('screens on a site'),
    )
    expect(email?.text).toContain('alpha-shop')
  })
})
