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
 * Plugin-contributed staff alerts, through the real usage-alerts sweep
 * (AGL-2984).
 *
 * A contributor decides and words an alert; the sweep owns everything else.
 * This suite pins the sweep's half with fictional plugins: the reading a
 * contributor is handed, the senders and the report row its alert goes
 * through, the order contributors run in, the first-sweep seed, and the
 * isolation that keeps one plugin's failure from costing anybody else — or
 * from writing an alert that never went out down as announced.
 */

const CRON_SECRET = 'test-cron-secret'

/** UTC `YYYY-MM`, the key the route stamps and reads guards against. */
const MONTH = new Date().toISOString().slice(0, 7)
const LAST_MONTH = new Date(
  Date.UTC(Number(MONTH.slice(0, 4)), Number(MONTH.slice(5, 7)) - 2, 1),
)
  .toISOString()
  .slice(0, 7)

/** Org documents, merged in place by the double's `set()`. */
let orgStore: Record<string, Record<string, unknown>>
let mockStaffNotifications: Array<Record<string, unknown>>
let mockStaffEmails: Array<Record<string, unknown>>
let mockOrgNotifications: Array<Record<string, unknown>>
let mockStaffEmailResult: { sent: boolean; reason?: string }
const mockRegisterDeclarations = jest.fn(async (): Promise<void> => undefined)

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  )
}

/** `set(data, { merge: true })`: nested maps DEEP-merge, as Firestore's do. */
function mergeInto(
  target: Record<string, unknown>,
  patch: Record<string, unknown>,
): void {
  for (const [key, value] of Object.entries(patch)) {
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

function fakeOrgDoc(orgId: string) {
  const data = orgStore[orgId]
  return {
    id: orgId,
    data: () => JSON.parse(JSON.stringify(data)) as Record<string, unknown>,
    get: (field: string) => data[field],
    ref: {
      id: orgId,
      set: async (
        value: Record<string, unknown>,
        options?: { merge?: boolean },
      ) => {
        if (!options?.merge) for (const key of Object.keys(data)) delete data[key]
        mergeInto(data, JSON.parse(JSON.stringify(value)))
      },
      collection: () => emptyCollection(),
    },
  }
}

const fakeFirestore = {
  collection: (name: string) => {
    if (name !== 'orgs' && name !== 'hosts') return emptyCollection()
    // These orgs own no sites, and every org fits on one page.
    const api: any = {
      where: () => api,
      orderBy: () => api,
      limit: () => api,
      startAfter: () => api,
      doc: (id: string) => ({ id }),
      get: async () =>
        name === 'orgs'
          ? { docs: Object.keys(orgStore).sort().map(fakeOrgDoc) }
          : { docs: [], size: 0 },
    }
    return api
  },
}

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  firebaseAdmin: {
    app: () => ({ firestore: () => fakeFirestore }),
    firestore: { FieldPath: { documentId: () => '__name__' } },
  },
  notifyOrgAdmins: async (orgId: string, payload: Record<string, unknown>) => {
    mockOrgNotifications.push({ orgId, ...payload })
  },
  notifyStaff: async (payload: Record<string, unknown>) => {
    mockStaffNotifications.push(payload)
  },
}))

// THE EMAIL SIDE IS ASSERTED, NEVER SENT.
jest.mock('../app/api/_lib/usage-alert-email', () => ({
  __esModule: true,
  consoleOrigin: () => 'https://app.aglyn.com',
  emailFailureReason: (result: { sent: boolean; reason?: string }) =>
    result.sent ? null : (result.reason ?? null),
  emailOrgAdmins: async () => ({ sent: true }),
  emailStaffAlert: async (input: Record<string, unknown>) => {
    mockStaffEmails.push(input)
    return mockStaffEmailResult
  },
}))

jest.mock('@aglyn/aglyn/server', () => ({
  __esModule: true,
  ...jest.requireActual(
    '../../../libs/aglyn/src/lib/app-utils/plan-entitlements',
  ),
  ...jest.requireActual('../../../libs/aglyn/src/lib/app-utils/bandwidth-cap'),
  buildRoute: () => '/org/billing',
  Route: { MANAGE_BILLING: 'MANAGE_BILLING' },
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
  screenCapReading: async () => ({ maxBillable: 0, overCapHostIds: [] }),
}))

// The plugins' declarations manifest, replaced so the only contributors are
// the fictional ones each case registers.
jest.mock('../constants/plugins.declarations.server.generated', () => ({
  __esModule: true,
  registerPluginServerDeclarations: () => mockRegisterDeclarations(),
}))

import {
  registerUsageAlertContributor,
  resetUsageAlertContributorsForTests,
  type UsageAlertContext,
} from '@aglyn/aglyn/plugin-manager/usage-alert-contributors'
import { POST } from '../app/api/billing/usage-alerts/route'

async function run(): Promise<Record<string, any>> {
  const response = await POST(
    new Request('https://app.aglyn.com/api/billing/usage-alerts', {
      method: 'POST',
      headers: { 'x-cron-secret': CRON_SECRET },
    }),
  )
  expect(response.status).toBe(200)
  return response.json() as Promise<Record<string, any>>
}

/** A subscribed org inside every band, so only contributors speak. */
const subscribedOrg = (extra: Record<string, unknown> = {}) => ({
  'org-acme': { name: 'Acme', slug: 'acme', ownerUid: 'u1', plan: 'pro', ...extra },
})

/** The persisted guard map for an org, after every merge so far. */
const guardsOf = (orgId: string) =>
  (orgStore[orgId]?.['usageAlerts'] ?? {}) as Record<string, unknown>

/** A staff alert with fixed words, for a contributor that decided to send. */
function staffAlert(quota: string, threshold: number) {
  return {
    quota,
    threshold,
    title: `${quota} crossed ${threshold}`,
    body: `The ${quota} reading passed ${threshold}.`,
    link: '/admin/orgs',
    emailContext: 'deliverability',
  }
}

/** A contributor that records `quota` at `threshold` and alerts when told to send. */
function alertingContributor(pluginId: string, id: string, quota: string, threshold: number) {
  return {
    pluginId,
    id,
    evaluate: async (context: UsageAlertContext) => {
      if (context.recordAlert(quota, threshold)) {
        await context.alertStaff(staffAlert(quota, threshold))
      }
    },
  }
}

let consoleError: jest.SpyInstance

beforeEach(() => {
  process.env.CRON_SECRET = CRON_SECRET
  delete process.env.USAGE_ALERT_APPROACH_PCT
  delete process.env.AUTO_LOCK_BILLING_FROM
  resetUsageAlertContributorsForTests()
  orgStore = {}
  mockStaffNotifications = []
  mockStaffEmails = []
  mockOrgNotifications = []
  mockStaffEmailResult = { sent: true }
  mockRegisterDeclarations.mockReset()
  mockRegisterDeclarations.mockImplementation(async () => undefined)
  consoleError = jest.spyOn(console, 'error').mockImplementation(() => undefined)
})

afterEach(() => {
  consoleError.mockRestore()
})

describe('a contributor is handed the org’s reading (AGL-2984)', () => {
  it('sees each org, its slug, the run’s month, the spend and the guard map the sweep read', async () => {
    orgStore = {
      ...subscribedOrg({
        usageAlerts: { bounceRate: { month: LAST_MONTH, threshold: 1 } },
      }),
      // No slug on the document.
      'org-bare': { name: 'Bare', ownerUid: 'u2', plan: 'pro' },
    }
    const seen: UsageAlertContext[] = []
    registerUsageAlertContributor({
      pluginId: 'deliverability',
      id: 'bounce-rate',
      evaluate: async (context) => {
        seen.push(context)
      },
    })

    await run()

    expect(seen.map((context) => [context.orgId, context.orgSlug])).toEqual([
      ['org-acme', 'acme'],
      ['org-bare', null],
    ])
    expect(seen[0]).toMatchObject({
      month: MONTH,
      org: { plan: 'pro', slug: 'acme' },
      guards: { bounceRate: { month: LAST_MONTH, threshold: 1 } },
      spend: { meteredUsd: 0, totalUsd: 0, meteredFresh: false },
    })
  })
})

describe('the sweep delivers a contributor’s alert (AGL-2984)', () => {
  it('rings the staff bell, mails staff the absolute link, reports the row and writes the guard', async () => {
    orgStore = subscribedOrg()
    registerUsageAlertContributor(
      alertingContributor('deliverability', 'bounce-rate', 'bounceRate', 2),
    )

    const payload = await run()

    expect(mockStaffNotifications).toEqual([
      {
        type: 'billing.usage',
        title: 'bounceRate crossed 2',
        body: 'The bounceRate reading passed 2.',
        orgId: 'org-acme',
        link: '/admin/orgs',
      },
    ])
    expect(mockStaffEmails).toEqual([
      {
        subject: 'bounceRate crossed 2',
        text: 'The bounceRate reading passed 2.\n\nOrg: https://app.aglyn.com/admin/orgs',
        context: 'deliverability',
      },
    ])
    expect(payload['details']).toEqual([
      { orgId: 'org-acme', quota: 'bounceRate', threshold: 2, emailed: true },
    ])
    expect(guardsOf('org-acme')).toEqual({
      bounceRate: { month: MONTH, threshold: 2 },
    })
    // A staff alert tells the customer nothing.
    expect(mockOrgNotifications).toEqual([])
  })

  it('reports a staff mail that reached nobody, and why', async () => {
    orgStore = subscribedOrg()
    mockStaffEmailResult = { sent: false, reason: 'unconfigured' }
    registerUsageAlertContributor(
      alertingContributor('deliverability', 'bounce-rate', 'bounceRate', 1),
    )

    const payload = await run()

    expect(mockStaffNotifications).toHaveLength(1)
    expect(payload['details']).toEqual([
      {
        orgId: 'org-acme',
        quota: 'bounceRate',
        threshold: 1,
        emailed: false,
        emailReason: 'unconfigured',
      },
    ])
  })
})

describe('contributors run in order, and in isolation (AGL-2984)', () => {
  it('runs in the seam’s order, and a contributor that throws costs the next one nothing', async () => {
    orgStore = subscribedOrg()
    const ran: string[] = []
    registerUsageAlertContributor({
      pluginId: 'deliverability',
      id: 'bounce-rate',
      evaluate: async (context) => {
        ran.push('deliverability:bounce-rate')
        if (context.recordAlert('bounceRate', 1)) {
          await context.alertStaff(staffAlert('bounceRate', 1))
        }
      },
    })
    // Registered second and run first: `backups` sorts before `deliverability`.
    registerUsageAlertContributor({
      pluginId: 'backups',
      id: 'snapshots',
      evaluate: async () => {
        ran.push('backups:snapshots')
        throw new Error('snapshot index unavailable')
      },
    })

    const payload = await run()

    expect(ran).toEqual(['backups:snapshots', 'deliverability:bounce-rate'])
    expect(mockStaffNotifications.map((entry) => entry['title'])).toEqual([
      'bounceRate crossed 1',
    ])
    expect(payload['details']).toEqual([
      expect.objectContaining({ quota: 'bounceRate', emailed: true }),
    ])
    expect(consoleError).toHaveBeenCalledWith(
      '[usage-alerts] usage alert contributor failed',
      'backups:snapshots',
      'org-acme',
      expect.objectContaining({ message: 'snapshot index unavailable' }),
    )
  })

  it('writes the guard of an alert a failed contributor delivered, and drops the ones it never sent', async () => {
    orgStore = subscribedOrg({
      usageAlerts: { snapshotAge: { month: LAST_MONTH, threshold: 7 } },
    })
    registerUsageAlertContributor({
      pluginId: 'backups',
      id: 'snapshots',
      evaluate: async (context) => {
        if (context.recordAlert('snapshotStorage', 1)) {
          await context.alertStaff(staffAlert('snapshotStorage', 1))
        }
        // Recorded again at a higher threshold, and a second key — neither
        // delivered before the throw.
        context.recordAlert('snapshotStorage', 2)
        context.recordAlert('snapshotAge', 30)
        throw new Error('snapshot index unavailable')
      },
    })

    const payload = await run()

    expect(mockStaffNotifications).toHaveLength(1)
    expect(payload['details']).toEqual([
      expect.objectContaining({ quota: 'snapshotStorage', threshold: 1 }),
    ])
    // Delivered at 1, so written at 1 rather than at the 2 that never went
    // out; the undelivered key keeps last month's guard, so the next sweep
    // tries it again.
    expect(guardsOf('org-acme')).toEqual({
      snapshotStorage: { month: MONTH, threshold: 1 },
      snapshotAge: { month: LAST_MONTH, threshold: 7 },
    })
  })
})

describe('an org’s first sweep is silent for contributors too (AGL-2984)', () => {
  it('records the guard as seeded and sends nothing, even for a contributor that does not ask', async () => {
    // No `plan`, no seed marker and no guard map: the org's first evaluation.
    orgStore = { 'org-organic': { name: 'Organic', slug: 'organic', ownerUid: 'u1' } }
    const answers: boolean[] = []
    registerUsageAlertContributor({
      pluginId: 'deliverability',
      id: 'bounce-rate',
      evaluate: async (context) => {
        answers.push(context.recordAlert('bounceRate', 1))
        await context.alertStaff(staffAlert('bounceRate', 1))
      },
    })

    const payload = await run()

    expect(answers).toEqual([false])
    expect(mockStaffNotifications).toEqual([])
    expect(mockStaffEmails).toEqual([])
    expect(payload['details']).toEqual([])
    expect(payload['seededDetails']).toEqual([
      { orgId: 'org-organic', quota: 'bounceRate', threshold: 1 },
    ])
    expect(guardsOf('org-organic')).toEqual({
      bounceRate: { month: MONTH, threshold: 1 },
    })
  })
})

describe('the plugin declarations load before the contributors are listed (AGL-2984)', () => {
  it('evaluates a contributor the declarations register on this invocation', async () => {
    orgStore = subscribedOrg()
    const ran: string[] = []
    mockRegisterDeclarations.mockImplementation(async () => {
      registerUsageAlertContributor({
        pluginId: 'deliverability',
        id: 'bounce-rate',
        evaluate: async (context) => {
          ran.push(context.orgId)
        },
      })
    })

    await run()

    expect(mockRegisterDeclarations).toHaveBeenCalledTimes(1)
    expect(ran).toEqual(['org-acme'])
  })

  it('sweeps with the contributors it has when the declarations fail to load', async () => {
    orgStore = subscribedOrg()
    mockRegisterDeclarations.mockRejectedValue(new Error('declarations failed to load'))
    registerUsageAlertContributor(
      alertingContributor('deliverability', 'bounce-rate', 'bounceRate', 1),
    )

    const payload = await run()

    expect(consoleError).toHaveBeenCalledWith(
      '[usage-alerts] plugin declarations failed',
      expect.objectContaining({ message: 'declarations failed to load' }),
    )
    expect(payload['details']).toEqual([
      expect.objectContaining({ quota: 'bounceRate', emailed: true }),
    ])
  })
})
