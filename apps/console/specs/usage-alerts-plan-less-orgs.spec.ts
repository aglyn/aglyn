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
 * The sweep REACHES a never-subscribed org, and its first pass is SILENT
 * (AGL-2420).
 *
 * ## What was broken
 *
 * `usage-alerts` opened its per-org loop with `if (!orgData['plan']) continue`,
 * and `createOrganization` writes no `plan` field — that field is
 * Stripe-webhook-owned and only ever stamped by a subscription. So the sweep
 * skipped every org that had never subscribed: the entire organic free tier
 * arriving on September 1, receiving none of the quota or budget warnings the
 * product promises them. AGL-2413 rescued the one consequence that refused
 * traffic (the bandwidth cap, re-enforced at `/api/analytics/collect`); the
 * notifications stayed dark.
 *
 * ## Why removing the line needed a decision, not just a deletion
 *
 * Those orgs' guard maps are empty, so every band they already sit above
 * reads as a threshold crossed for the first time — deleting the `continue`
 * alone mails the whole free tier at once, about states they have been in for
 * weeks. the call: BACKFILL the guard map on an org's first evaluation and
 * send nothing; a genuine crossing after that mails normally.
 *
 * ## What this suite pins
 *
 * The two halves of that sentence, as counts of send calls — never by
 * actually sending. An org seeded above a threshold with no guard map
 * produces ZERO sends on the first pass, and exactly ONE when it crosses the
 * next threshold. Plus the three properties that make it a fix rather than a
 * mute: the org is REACHED at all, a PLAN-FUL org's first alert is NOT
 * swallowed, and the marker stops a second silent pass.
 *
 * Every case is driven through the REAL route with the REAL plan table. The
 * Firestore double PERSISTS writes and models `set(..., { merge: true })` as
 * the DEEP merge Firestore performs, because the whole dedupe mechanism is a
 * read-modify-write of one nested map across runs — a double that replaced
 * the map, or that forgot the write, would make the second pass unfalsifiable.
 */

const CRON_SECRET = 'test-cron-secret'

/** UTC `YYYY-MM`, the key the route stamps and reads guards against. */
const MONTH = new Date().toISOString().slice(0, 7)

/** A Firestore `FieldValue.delete()` sentinel, as this double models it. */
const DELETE_SENTINEL = { __delete: true } as const

interface SeededHost {
  id: string
  orgId: string
  /** This month's page views for the site. */
  pageViews: number
}

/**
 * The org documents, MUTATED IN PLACE by the double's `set()`.
 *
 * Persisted rather than rebuilt per run because the property under test spans
 * two sweeps: pass one writes a guard map, pass two must READ it. A double
 * that discarded the write would report "one send on the next crossing" for a
 * route that had lost the guard entirely, and for a route that never wrote
 * one.
 */
let orgStore: Record<string, Record<string, unknown>>
let mockHosts: SeededHost[]

/** Every console notification the sweep produced, in order. */
let mockOrgNotifications: Array<{ orgId: string; title: string }>
/** Every staff console notification. */
let mockStaffNotifications: Array<{ title: string }>
/** Every customer EMAIL the sweep asked for — asserted, never sent. */
let mockOrgEmails: Array<{ orgId: string; subject: string }>
/** Every staff email. */
let mockStaffEmails: Array<{ subject: string }>
/** Every `set()` payload written to an org doc, with its options. */
let mockOrgWrites: Array<{
  orgId: string
  data: Record<string, unknown>
  options?: { merge?: boolean }
}>

/** Total outbound attempts of ANY kind. The number the seed must hold at 0. */
const sendCount = () =>
  mockOrgNotifications.length +
  mockStaffNotifications.length +
  mockOrgEmails.length +
  mockStaffEmails.length

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  )
}

/**
 * `set(data, { merge: true })` semantics, modelled honestly.
 *
 * ⚠️ Firestore DEEP-merges nested maps under `merge: true` — a write of
 * `{ usageAlerts: { bandwidth: … } }` leaves `usageAlerts.hosts` standing.
 * That is not a detail: it is the reason the route may write only the KEYS IT
 * DECIDED rather than a stale whole-map spread, and the reason a locally
 * pruned map would leave pruned keys alive. A double that replaced the nested
 * map would turn the delta write into data loss and this suite would call it
 * green.
 *
 * `FieldValue.delete()` is modelled too, so a write that removes a key is
 * expressible even though this route does not currently issue one —
 * `api/billing/usage-budget` does, against this very map.
 */
function mergeInto(
  target: Record<string, unknown>,
  patch: Record<string, unknown>,
): void {
  for (const [key, value] of Object.entries(patch)) {
    if (value === DELETE_SENTINEL) {
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

/**
 * Fired ONCE, from inside the per-org body of a sweep.
 *
 * The concurrency case below needs another writer to land BETWEEN the route's
 * `data()` read at the top of the org loop and its `set()` at the bottom —
 * that interleaving is the whole hazard, and a mutation applied before or
 * after a run models nothing. The analytics read is the natural seam: it is
 * awaited in the middle of the org body.
 */
let duringSweep: (() => Promise<void> | void) | null = null

async function fireDuringSweep(): Promise<void> {
  const hook = duringSweep
  if (!hook) return
  duringSweep = null
  await hook()
}

/** One `hosts/{id}/analytics/{day}` document carrying the whole month. */
function analyticsCollection(pageViews: number): any {
  const api: any = {
    where: () => api,
    get: async () => (await fireDuringSweep(), {
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
  return {
    id: host.id,
    get: (field: string) => (field === 'screens' ? {} : undefined),
    ref: {
      id: host.id,
      collection: (name: string) =>
        name === 'analytics'
          ? analyticsCollection(host.pageViews)
          : emptyCollection(),
    },
  }
}

function fakeOrgDoc(orgId: string) {
  const data = orgStore[orgId]
  return {
    id: orgId,
    // ⚠️ A DEEP snapshot, like a real `data()`.
    //
    // A shallow `{ ...data }` aliases the nested `usageAlerts` map, so a
    // concurrent writer's delete would reach INSIDE the snapshot the route is
    // holding — and the stale-spread bug this suite exists to catch would
    // silently repair itself in the double. That is a fake GREEN of exactly
    // the kind that hides the defect: the mutation test for the delta write
    // reddened one case instead of two until this was a real copy.
    data: () => JSON.parse(JSON.stringify(data)) as Record<string, unknown>,
    get: (field: string) => data[field],
    ref: {
      id: orgId,
      set: async (
        value: Record<string, unknown>,
        options?: { merge?: boolean },
      ) => {
        mockOrgWrites.push({
          orgId,
          data: JSON.parse(JSON.stringify(value)),
          options,
        })
        if (options?.merge) mergeInto(data, value)
        // A bare `set()` REPLACES — modelled so a regression away from
        // `{ merge: true }` is visible here as vanished fields rather than as
        // silence.
        else for (const key of Object.keys(data)) delete data[key]
        if (!options?.merge) mergeInto(data, value)
      },
      collection: () => emptyCollection(),
      update: async (patch: Record<string, unknown>) => {
        // Dotted paths are NESTED paths in `update()` only — the distinction
        // `api/billing/usage-budget` turns on. Modelled so this suite can
        // stand in for that route deleting a guard between sweeps.
        for (const [path, value] of Object.entries(patch)) {
          const parts = path.split('.')
          let node: Record<string, unknown> = data
          for (const part of parts.slice(0, -1)) {
            if (!isPlainObject(node[part])) node[part] = {}
            node = node[part] as Record<string, unknown>
          }
          const leaf = parts[parts.length - 1]
          if (value === DELETE_SENTINEL) delete node[leaf]
          else node[leaf] = value
        }
      },
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
      // ORDER, LIMIT and an EXCLUSIVE START-AFTER, as AGL-2421's paging needs.
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

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  firebaseAdmin: {
    app: () => ({ firestore: () => fakeFirestore }),
    firestore: { FieldPath: { documentId: () => '__name__' } },
  },
  notifyOrgAdmins: async (orgId: string, payload: { title: string }) => {
    mockOrgNotifications.push({ orgId, title: payload.title })
  },
  // A `jest.mock` factory is a CLOSED WORLD: an omitted export fails inside
  // the sweep as "not a function", which reads as a broken suite rather than
  // as a missing send. Both staff channels are listed even though a free org
  // has no Assist entitlement to spend against — a suite that asserts on
  // ZERO sends must be able to observe every channel that could produce one.
  notifyStaff: async (payload: { title: string }) => {
    mockStaffNotifications.push({ title: payload.title })
  },
  assistOrgMonthlyCostLimitUsd: (
    jest.requireActual(
      '../../../libs/tenant/data/admin/src/lib/server/assist-usage',
    ) as typeof import('../../../libs/tenant/data/admin/src/lib/server/assist-usage')
  ).assistOrgMonthlyCostLimitUsd,
}))

// THE EMAIL SIDE IS ASSERTED, NEVER SENT. Mocked at the module the route
// imports so a send is a recorded call and nothing reaches Resend.
jest.mock('../app/api/_lib/usage-alert-email', () => ({
  __esModule: true,
  consoleOrigin: () => 'https://app.aglyn.com',
  emailFailureReason: () => null,
  emailOrgAdmins: async (input: { orgId: string; subject: string }) => {
    mockOrgEmails.push({ orgId: input.orgId, subject: input.subject })
    return { sent: 1 }
  },
  emailStaffAlert: async (input: { subject: string }) => {
    mockStaffEmails.push({ subject: input.subject })
    return { sent: 1 }
  },
}))

jest.mock('@aglyn/aglyn/server', () => ({
  __esModule: true,
  // The REAL plan table and the REAL cap resolvers: the point is that the
  // shipped free-tier arithmetic reaches these orgs, not that a stub can be
  // made to.
  ...jest.requireActual(
    '../../../libs/aglyn/src/lib/app-utils/plan-entitlements',
  ),
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

jest.mock('../utils/screen-cap-reconciliation', () => ({
  __esModule: true,
  measureScreenCaps: async () => ({ maxBillable: 0, overCapHostIds: [] }),
  screenCapReading: async () => ({ maxBillable: 0, overCapHostIds: [] }),
}))

import { POST } from '../app/api/billing/usage-alerts/route'
import { pageViewsFromBandwidthGb } from '../utils/usage-metering'
import { PLAN_ENTITLEMENTS } from '@aglyn/aglyn/server'

/** ~8.7k views. Free's 5 GB band, in the unit the counter is in. */
const FREE_BAND_VIEWS = Math.round(
  pageViewsFromBandwidthGb(PLAN_ENTITLEMENTS.free.bandwidthGb),
)
/** Comfortably past 80% of the band and comfortably under 100%. */
const APPROACHING = Math.round(FREE_BAND_VIEWS * 0.9)
/** Past the band. */
const OVER = Math.round(FREE_BAND_VIEWS * 1.2)

/**
 * The org document `createOrganization` ACTUALLY writes — no `plan` key at
 * all (`libs/tenant/data/admin/src/lib/server/organizations.ts`).
 *
 * ⚠️ Written as an explicit object rather than `{ plan: undefined }`: the
 * defect is about an ABSENT field, and a fixture carrying the key with an
 * undefined value would pass against a `plan in orgData` check that the real
 * document would fail.
 */
const neverSubscribedOrg = (id = 'org-organic') => ({
  [id]: { name: 'Organic', slug: id, ownerUid: 'u1', hosts: {} },
})

/** The DOWNGRADE shape: a real `plan` field, stamped by the webhook. */
const downgradedFreeOrg = (id = 'org-downgraded') => ({
  [id]: { name: 'Downgraded', slug: id, ownerUid: 'u1', plan: 'free' },
})

async function run() {
  mockOrgNotifications = []
  mockStaffNotifications = []
  mockOrgEmails = []
  mockStaffEmails = []
  mockOrgWrites = []
  const response = await POST(
    new Request('https://app.aglyn.com/api/billing/usage-alerts', {
      method: 'POST',
      headers: { 'x-cron-secret': CRON_SECRET },
    }),
  )
  expect(response.status).toBe(200)
  return response
}

/** The persisted guard map for an org, after every merge so far. */
const guardsOf = (orgId: string) =>
  (orgStore[orgId]?.['usageAlerts'] ?? {}) as Record<
    string,
    { month: string; threshold: number }
  >

beforeEach(() => {
  process.env.CRON_SECRET = CRON_SECRET
  delete process.env.USAGE_ALERT_APPROACH_PCT
  delete process.env.AUTO_LOCK_BILLING_FROM
  jest.clearAllMocks()
  orgStore = {}
  mockHosts = []
  duringSweep = null
  mockOrgWrites = []
  mockOrgNotifications = []
  mockStaffNotifications = []
  mockOrgEmails = []
  mockStaffEmails = []
})

describe('the sweep REACHES a never-subscribed org at all (AGL-2420)', () => {
  it('evaluates an org with no `plan` field and records what it found', async () => {
    // The whole defect, in one assertion. `if (!orgData['plan']) continue`
    // made this org invisible: no guard map, no response entry, no write.
    orgStore = neverSubscribedOrg()
    mockHosts = [
      { id: 'site-a', orgId: 'org-organic', pageViews: APPROACHING },
    ]
    const response = await run()

    // One site against `hostLimit: 1` is 100% of the band; 90% of the
    // bandwidth band is the approach threshold. Both are real states this
    // customer is in, and before the fix nothing here had ever looked.
    expect(guardsOf('org-organic')).toEqual({
      hosts: { month: MONTH, threshold: 100 },
      bandwidth: { month: MONTH, threshold: 80 },
    })
    await expect(response.json()).resolves.toMatchObject({ seeded: 2 })
  })
})

describe('the first pass BACKFILLS instead of firing (AGL-2420)', () => {
  it('sends NOTHING for an org already sitting above its thresholds', async () => {
    // The property the whole decision rests on. Two thresholds are crossed
    // the instant this org becomes visible, and neither may produce mail:
    // the customer has been in this state for weeks, and a cron that swept
    // the platform would mail the entire free tier at once.
    orgStore = neverSubscribedOrg()
    mockHosts = [
      { id: 'site-a', orgId: 'org-organic', pageViews: APPROACHING },
    ]
    const response = await run()

    expect(sendCount()).toBe(0)
    expect(mockOrgNotifications).toHaveLength(0)
    expect(mockOrgEmails).toHaveLength(0)
    // …and the run reports the silence rather than reporting nothing. A
    // sweep that skipped the org and a sweep that seeded it would otherwise
    // both read as `alerted: 0`.
    await expect(response.json()).resolves.toMatchObject({
      alerted: 0,
      seeded: 2,
    })
  })

  it('MAILS on the NEXT threshold the org actually crosses', async () => {
    // The other half, and the reason this is a backfill and not a mute. The
    // guard seeded above says "80% already announced"; crossing 100% is new
    // information and must arrive.
    orgStore = neverSubscribedOrg()
    mockHosts = [
      { id: 'site-a', orgId: 'org-organic', pageViews: APPROACHING },
    ]
    await run()

    // The org's traffic grows past the band. Nothing else about it changes —
    // in particular it still has no `plan`.
    mockHosts = [{ id: 'site-a', orgId: 'org-organic', pageViews: OVER }]
    await run()

    // EXACTLY ONE. `hosts` was seeded at 100 and has not moved, so it is
    // deduped; `bandwidth` went 80 -> 100 and is announced, on both channels.
    expect(mockOrgNotifications).toHaveLength(1)
    expect(mockOrgNotifications[0].title).toMatch(/bandwidth/i)
    expect(mockOrgEmails).toHaveLength(1)
    expect(mockStaffNotifications).toHaveLength(0)
    expect(guardsOf('org-organic')['bandwidth']).toEqual({
      month: MONTH,
      threshold: 100,
    })
  })

  it('stays silent on a REPEAT pass at the same threshold', async () => {
    // The seeded guard has to be a real guard, not a one-run flag: a second
    // sweep at unchanged usage must find it and say nothing.
    orgStore = neverSubscribedOrg()
    mockHosts = [
      { id: 'site-a', orgId: 'org-organic', pageViews: APPROACHING },
    ]
    await run()
    await run()
    expect(sendCount()).toBe(0)
  })
})

describe('the seed does not swallow anybody else’s first alert', () => {
  it('POSITIVE CONTROL: a PLAN-FUL org with an empty guard map still MAILS', async () => {
    // The regression the backfill could have introduced, and the reason it is
    // keyed on the absent `plan` rather than on an absent guard map alone.
    // Every existing org on the platform has been swept daily for a year, so
    // ITS empty guard map truthfully means "has never crossed anything" — and
    // its first crossing is genuinely new. Seeding on an empty map alone
    // would silence the first alert for every paying customer.
    orgStore = downgradedFreeOrg()
    mockHosts = [
      { id: 'site-a', orgId: 'org-downgraded', pageViews: APPROACHING },
    ]
    const response = await run()

    expect(mockOrgNotifications.length).toBeGreaterThan(0)
    expect(mockOrgEmails.length).toBeGreaterThan(0)
    await expect(response.json()).resolves.toMatchObject({ seeded: 0 })
  })

  it('seeds only the plan-less org when both are swept together', async () => {
    // Both shapes in one run, because the decision is per-org and a flag
    // computed once for the sweep would pass every single-org case above.
    orgStore = { ...neverSubscribedOrg(), ...downgradedFreeOrg() }
    mockHosts = [
      { id: 'site-a', orgId: 'org-organic', pageViews: APPROACHING },
      { id: 'site-b', orgId: 'org-downgraded', pageViews: APPROACHING },
    ]
    await run()

    expect(
      mockOrgNotifications.every((entry) => entry.orgId === 'org-downgraded'),
    ).toBe(true)
    expect(mockOrgEmails.every((entry) => entry.orgId === 'org-downgraded')).toBe(
      true,
    )
    expect(guardsOf('org-organic')['bandwidth']).toBeDefined()
  })
})

describe('the seed marker (AGL-2420)', () => {
  it('is written even when the org crossed NOTHING', async () => {
    // An org inside every band records no guards at all. Without a marker it
    // would look "never evaluated" again tomorrow, and the first band it ever
    // crossed would be seeded silently — a permanent one-alert hole instead
    // of a one-run one.
    orgStore = neverSubscribedOrg()
    mockHosts = []
    await run()
    expect(guardsOf('org-organic')).toEqual({})
    expect(orgStore['org-organic']['usageAlertsSeeded']).toMatchObject({
      month: MONTH,
    })
  })

  it('lets the org’s FIRST EVER crossing arrive as mail', async () => {
    // The marker doing its job: nothing to seed on pass one, a real crossing
    // on pass two, and it is announced rather than backfilled.
    orgStore = neverSubscribedOrg()
    mockHosts = []
    await run()

    mockHosts = [{ id: 'site-a', orgId: 'org-organic', pageViews: OVER }]
    await run()

    // `hosts` (1 of 1) and `bandwidth` (past the band), both newly crossed.
    expect(mockOrgNotifications).toHaveLength(2)
    expect(mockOrgEmails).toHaveLength(2)
  })
})

describe('the guard map is written as a DELTA (AGL-2420)', () => {
  it('writes only the keys this run decided, not a stale whole-map spread', async () => {
    orgStore = neverSubscribedOrg()
    mockHosts = [
      { id: 'site-a', orgId: 'org-organic', pageViews: APPROACHING },
    ]
    await run()

    mockHosts = [{ id: 'site-a', orgId: 'org-organic', pageViews: OVER }]
    await run()

    const written = mockOrgWrites.find((write) => 'usageAlerts' in write.data)
    // `bandwidth` moved; `hosts` did not. A `{ ...guards, ...guardUpdates }`
    // spread would carry `hosts` along on every write forever.
    expect(Object.keys(written?.data['usageAlerts'] as object)).toEqual([
      'bandwidth',
    ])
    expect(written?.options).toEqual({ merge: true })
  })

  it('DEEP MERGE keeps the keys the delta did not mention', async () => {
    // The other side of the same coin, and the reason the delta is safe:
    // `set(..., { merge: true })` merges nested maps, so `hosts` survives a
    // write that never names it. If it did not, the delta would be data loss
    // and the dedupe would reset every run.
    orgStore = neverSubscribedOrg()
    mockHosts = [
      { id: 'site-a', orgId: 'org-organic', pageViews: APPROACHING },
    ]
    await run()

    mockHosts = [{ id: 'site-a', orgId: 'org-organic', pageViews: OVER }]
    await run()

    expect(guardsOf('org-organic')).toEqual({
      hosts: { month: MONTH, threshold: 100 },
      bandwidth: { month: MONTH, threshold: 100 },
    })
  })

  it('does NOT resurrect a guard another writer deleted MID-SWEEP', async () => {
    // ⚠️ The concurrency defect the delta closes. `api/billing/usage-budget`
    // clears a guard with `update({ 'usageAlerts.budget': FieldValue.delete() })`
    // precisely so a customer who changes their budget is alerted against the
    // NEW amount. This sweep is a NON-TRANSACTIONAL read-modify-write of that
    // whole map: `guards` is snapshotted at the top of the org body and
    // written back hundreds of lines and several awaits later. A customer who
    // changed their budget in that window had the old guard written straight
    // back over the delete, and their new budget stayed silent for the rest
    // of the month.
    //
    // The delete therefore has to land INSIDE the sweep — after the read, before
    // the write. Applied before the run it would prove nothing, because the
    // route would simply never have read the key.
    orgStore = neverSubscribedOrg()
    mockHosts = [
      { id: 'site-a', orgId: 'org-organic', pageViews: APPROACHING },
    ]
    await run()

    // A budget guard, as `usage-alerts` itself would have recorded one.
    await fakeOrgDoc('org-organic').ref.update({
      'usageAlerts.budget': { month: MONTH, threshold: 50 },
    })

    // The customer changes their budget while the next sweep is mid-org.
    duringSweep = () =>
      fakeOrgDoc('org-organic').ref.update({
        'usageAlerts.budget': DELETE_SENTINEL,
      })
    mockHosts = [{ id: 'site-a', orgId: 'org-organic', pageViews: OVER }]
    await run()

    // Gone, and STAYING gone. A `{ ...guards, ...guardUpdates }` spread would
    // have carried the snapshotted `budget` back into the merge.
    expect(guardsOf('org-organic')['budget']).toBeUndefined()
    // …while the key this run genuinely decided is written as normal.
    expect(guardsOf('org-organic')['bandwidth']).toEqual({
      month: MONTH,
      threshold: 100,
    })
  })
})

describe('the seed suppresses ALERTS, never ENFORCEMENT (AGL-2413)', () => {
  it('still engages the free-plan bandwidth cap on the silent pass', async () => {
    // The line AGL-2413 could not leave to a notification decision. The cap
    // is not a warning — it is the enforcement that was dark for this exact
    // population — and the customer is told about it by the beacon's own
    // `system.bandwidthCapEngaged` notice, not by this sweep.
    orgStore = neverSubscribedOrg()
    mockHosts = [{ id: 'site-a', orgId: 'org-organic', pageViews: OVER * 10 }]
    const response = await run()

    expect(orgStore['org-organic']['bandwidthCap']).toMatchObject({
      month: MONTH,
    })
    // …and it did so without mailing anybody.
    expect(sendCount()).toBe(0)
    await expect(response.json()).resolves.toMatchObject({ capped: 1 })
  })
})
