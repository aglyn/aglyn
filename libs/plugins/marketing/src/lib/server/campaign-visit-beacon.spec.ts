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
 * Who a campaign reached, counted from the site collector's `campaignVisit`
 * beacon (AGL-3461).
 *
 * The beacon is the visitor's browser talking, so the claims here are about
 * what it is NOT believed on: a campaign the page is no longer filed under,
 * one that was deleted, a label nobody — or two campaigns — declare. And the
 * one that inflates quietly: a page and a label naming the same campaign in
 * one pageview are one visit.
 */

import { FieldValue } from 'firebase-admin/firestore'

jest.mock('@aglyn/tenant-data-admin/server/organizations', () => ({
  __esModule: true,
  resolveOrgIdForHost: async (hostId: string) => (hostId === 'host1' ? 'org1' : null),
}))

jest.mock('@aglyn/tenant-data-admin/server/firebase-admin', () => ({
  __esModule: true,
  default: { app: () => ({ firestore: () => null }) },
}))

import { countCampaignVisitBeacon } from './campaign-visit-beacon'

const HOST = 'host1'
const ORG = 'org1'
const SCREEN = 'scr_landing'
const DAY = '2026-10-01'

/** A sentinel `FieldValue.increment(n)`, as the Admin SDK builds it. */
function incrementOf(value: unknown): number | null {
  const operand = (value as { operand?: unknown } | null)?.operand
  return typeof operand === 'number' ? operand : null
}

/** Applies a merge write with increments at any depth. */
function merge(target: Record<string, any>, patch: Record<string, any>): Record<string, any> {
  const next = { ...target }
  for (const [key, value] of Object.entries(patch)) {
    const by = incrementOf(value)
    if (by !== null) {
      next[key] = Number(next[key] ?? 0) + by
    } else if (value && typeof value === 'object' && !Array.isArray(value) && !('isEqual' in value)) {
      next[key] = merge(next[key] ?? {}, value)
    } else {
      next[key] = value
    }
  }
  return next
}

/** Keyed reads, merge sets, and the one `array-contains` query the label lookup asks. */
function fakeFirestore() {
  const store = new Map<string, Record<string, any>>()
  const doc = (path: string): any => ({
    id: path.split('/').pop(),
    get: async () => ({
      exists: store.has(path),
      id: path.split('/').pop(),
      data: () => store.get(path),
    }),
    set: async (patch: Record<string, any>) => {
      store.set(path, merge(store.get(path) ?? {}, patch))
    },
    collection: (name: string) => collection(`${path}/${name}`),
  })
  const collection = (path: string): any => ({
    doc: (id: string) => doc(`${path}/${id}`),
    where: (field: string, op: string, value: unknown) => ({
      limit: () => ({
        get: async () => ({
          docs: [...store.entries()]
            .filter(([key]) => key.startsWith(`${path}/`) && !key.slice(path.length + 1).includes('/'))
            .filter(([, data]) => op === 'array-contains' && (data[field] ?? []).includes(value))
            .map(([key, data]) => ({ id: key.split('/').pop(), data: () => data })),
        }),
      }),
    }),
  })
  return {
    collection,
    seed: (path: string, data: Record<string, any>) => store.set(path, data),
    report: (campaignId: string) => store.get(`orgs/${ORG}/campaignVisitReports/${campaignId}`),
    reports: () => [...store.keys()].filter((key) => key.includes('/campaignVisitReports/')),
  }
}

function seedCampaign(firestore: ReturnType<typeof fakeFirestore>, id: string, extra: Record<string, unknown> = {}) {
  firestore.seed(`orgs/${ORG}/emailCampaigns/${id}`, { name: `Campaign ${id}`, visibleTo: ['org'], ...extra })
}

function beacon(body: Record<string, unknown>, hostId = HOST) {
  return {
    hostId,
    day: DAY,
    dayExpiresAt: new Date('2027-10-01T00:00:00Z'),
    body: { campaignVisit: '1', ...body },
  }
}

it('uses the Admin SDK increment the collector relies on', () => {
  // The double reads `operand`, so it has to be what the SDK builds.
  expect(incrementOf(FieldValue.increment(1))).toBe(1)
})

describe('a view of a page filed under a campaign', () => {
  it('counts a page view, and a first visit only when the device claimed one', async () => {
    const firestore = fakeFirestore()
    seedCampaign(firestore, 'camp_ai')
    firestore.seed(`hosts/${HOST}/screens/${SCREEN}`, { campaignIds: ['camp_ai'] })

    await countCampaignVisitBeacon(beacon({ screenId: SCREEN, campaignIds: ['camp_ai'] }), firestore)
    await countCampaignVisitBeacon(
      beacon({ screenId: SCREEN, campaignIds: ['camp_ai'], first: ['camp_ai'] }),
      firestore,
    )

    expect(firestore.report('camp_ai')).toMatchObject({
      views: 2,
      firstVisits: 1,
      byMonth: { '2026-10': { views: 2, firstVisits: 1 } },
    })
  })

  it('counts nothing for a campaign the page is no longer filed under', async () => {
    const firestore = fakeFirestore()
    seedCampaign(firestore, 'camp_ai')
    seedCampaign(firestore, 'camp_old')
    firestore.seed(`hosts/${HOST}/screens/${SCREEN}`, { campaignIds: ['camp_ai'] })

    await countCampaignVisitBeacon(
      beacon({ screenId: SCREEN, campaignIds: ['camp_old', 'camp_ai'], first: ['camp_old'] }),
      firestore,
    )

    expect(firestore.report('camp_old')).toBeUndefined()
    expect(firestore.report('camp_ai')).toMatchObject({ views: 1 })
    expect(firestore.report('camp_ai')?.firstVisits).toBeUndefined()
  })

  it('counts nothing for a campaign that was deleted', async () => {
    const firestore = fakeFirestore()
    seedCampaign(firestore, 'camp_ai', { deletedAt: 1 })
    firestore.seed(`hosts/${HOST}/screens/${SCREEN}`, { campaignIds: ['camp_ai'] })

    await countCampaignVisitBeacon(beacon({ screenId: SCREEN, campaignIds: ['camp_ai'] }), firestore)

    expect(firestore.reports()).toEqual([])
  })

  it('a site with no organization counts nothing', async () => {
    const firestore = fakeFirestore()

    expect(
      await countCampaignVisitBeacon(beacon({ screenId: SCREEN, campaignIds: ['camp_ai'] }, 'host-orphan'), firestore),
    ).toBe(0)
    expect(firestore.reports()).toEqual([])
  })
})

describe('a link carrying a utm_campaign label', () => {
  it('counts a first visit for the one campaign that declares it, and no page view', async () => {
    const firestore = fakeFirestore()
    seedCampaign(firestore, 'camp_vibe', { utmCampaigns: ['vibe-coders', 'rt-vibe'] })

    await countCampaignVisitBeacon(beacon({ utmCampaign: 'rt-vibe', firstLabel: true }), firestore)

    expect(firestore.report('camp_vibe')).toMatchObject({ firstVisits: 1 })
    expect(firestore.report('camp_vibe')?.views).toBeUndefined()
  })

  it('a label two campaigns declare counts for neither', async () => {
    const firestore = fakeFirestore()
    seedCampaign(firestore, 'camp_a', { utmCampaigns: ['rt-ai'] })
    seedCampaign(firestore, 'camp_b', { utmCampaigns: ['rt-ai'] })

    await countCampaignVisitBeacon(beacon({ utmCampaign: 'rt-ai', firstLabel: true }), firestore)

    expect(firestore.reports()).toEqual([])
  })

  it('a label that is not a first visit counts nothing', async () => {
    const firestore = fakeFirestore()
    seedCampaign(firestore, 'camp_vibe', { utmCampaigns: ['vibe-coders'] })

    await countCampaignVisitBeacon(beacon({ utmCampaign: 'vibe-coders' }), firestore)

    expect(firestore.reports()).toEqual([])
  })

  it('a page and a label naming the same campaign are ONE first visit', async () => {
    const firestore = fakeFirestore()
    seedCampaign(firestore, 'camp_ai', { utmCampaigns: ['onejob-ai'] })
    firestore.seed(`hosts/${HOST}/screens/${SCREEN}`, { campaignIds: ['camp_ai'] })

    await countCampaignVisitBeacon(
      beacon({
        screenId: SCREEN,
        campaignIds: ['camp_ai'],
        first: ['camp_ai'],
        utmCampaign: 'onejob-ai',
        firstLabel: true,
      }),
      firestore,
    )

    expect(firestore.report('camp_ai')).toMatchObject({ views: 1, firstVisits: 1 })
  })
})
