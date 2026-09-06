/**
 * @jest-environment jsdom
 *
 * Pragma must stay in the FIRST block comment — behind the license header it
 * is silently ignored.
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
 * WHAT OPENING BILLING → USAGE ACTUALLY READS.
 *
 * Every meter on this card is a number somebody has to pay for, and the card
 * mounts them all at once. The failure it must not have is the one this
 * codebase keeps rediscovering: a figure that could have come from a counter
 * arriving instead from a scan of the collection it counts, on mount, for
 * every visitor who opens the page.
 *
 * Three properties, and the third is the one a new meter is most likely to
 * break:
 *
 *  1. NOTHING IS SCANNED. Counts come from `getCountFromServer`, which is one
 *     billed read whatever the collection holds. `getDocs` — an unbounded
 *     collection read — must not appear at all.
 *  2. NOTHING IS RE-DERIVED. Totals come from counter documents the meters and
 *     the rollup already maintain, read by id.
 *  3. THE ORG-LEVEL COST DOES NOT MOVE WITH THE SITE COUNT. This is where a
 *     new reading goes wrong quietly: put it inside the per-host block and an
 *     agency with twelve sites pays twelve times for one org-wide fact — and
 *     reads a per-site slice against an org-wide denominator while it is at it
 *     (AGL-2113). The suite therefore renders the SAME org at one site and at
 *     three, and asserts the org-scoped set is identical.
 *
 * Metered at the Firestore and `fetch` boundaries rather than at the DOM: a
 * spec asserting on rendered output passes identically whether a figure cost
 * one read or four hundred, which is the entire question.
 */

/** Every Firestore call the render made, as `kind` + `path`. */
const mockReads: Array<{ kind: string; path: string }> = []
/** Every URL fetched. */
const mockFetched: string[] = []

jest.mock('../utils/fetch-seat-counts', () => ({
  __esModule: true,
  // Counted server-side since AGL-1255 and metered by that route's own spec.
  // Recorded here as one call so it cannot silently become one per host.
  default: async () => {
    mockReads.push({ kind: 'fetchSeatCounts', path: 'orgs/org-1/members' })
    return { managerSeats: 1, collaboratorSeats: 0 }
  },
}))

const mockUser = { uid: 'u1', getIdToken: async () => 'tok' }

jest.mock('@aglyn/tenant-feature-instance', () => ({
  __esModule: true,
  useFirestore: () => ({}),
  useUser: () => ({ data: mockUser }),
}))

jest.mock('firebase/firestore', () => ({
  __esModule: true,
  doc: (_db: unknown, ...segments: string[]) => ({ path: segments.join('/') }),
  collection: (_db: unknown, ...segments: string[]) => ({
    path: segments.join('/'),
  }),
  getCountFromServer: async (ref: { path: string }) => {
    mockReads.push({ kind: 'count', path: ref.path })
    return { data: () => ({ count: 0 }) }
  },
  getDoc: async (ref: { path: string }) => {
    mockReads.push({ kind: 'getDoc', path: ref.path })
    return { exists: () => false, data: () => ({}) }
  },
  /*
   * Recorded, not omitted. A factory that left `getDocs` out would make a
   * reintroduced collection scan throw — which reads as a broken test rather
   * than as the cost regression it is, and would tempt the next author to
   * "fix" it by adding the export back with no assertion on it.
   */
  getDocs: async (ref: { path: string }) => {
    mockReads.push({ kind: 'getDocs', path: ref.path })
    return { docs: [] }
  },
  query: (ref: { path: string }) => ref,
  where: () => ({}),
  orderBy: () => ({}),
  limit: () => ({}),
  documentId: () => '__name__',
}))

import { cleanup, render, screen, waitFor } from '@testing-library/react'
import BillingUsageComponent from '../components/billing/billing-usage.component'

const ORG = { $id: 'org-1', plan: 'pro' } as any
const HOST_A = { $id: 'host-a', displayName: 'Site A' }
const HOSTS_3 = [
  HOST_A,
  { $id: 'host-b', displayName: 'Site B' },
  { $id: 'host-c', displayName: 'Site C' },
]

/** Reads and fetches whose path names no particular site. */
const orgScoped = () =>
  mockReads.filter((read) => !read.path.startsWith('hosts/'))
const orgFetches = () => mockFetched.filter((url) => !url.includes('hostId='))

beforeEach(() => {
  mockReads.length = 0
  mockFetched.length = 0
  global.fetch = jest.fn(async (input: any) => {
    const url = String(input)
    mockFetched.push(url)
    if (url.startsWith('/api/billing/email-ceiling')) {
      return {
        ok: true,
        json: async () => ({
          hourUsed: 12,
          hourLimit: 500,
          hourResetMs: Date.UTC(2026, 7, 30, 15, 0, 0),
          deliverableMonthly: 360_000,
          perSend: 500,
          paced: true,
        }),
      }
    }
    if (url.startsWith('/api/hosts/usage')) {
      return { ok: true, json: async () => ({ screens: 0 }) }
    }
    if (url.startsWith('/api/billing/host-usage')) {
      return { ok: true, json: async () => ({ monthPageViews: 0 }) }
    }
    return { ok: false, json: async () => ({}) }
  }) as any
})

/** Renders and waits for the whole card to have settled. */
async function mount(hosts: unknown[]) {
  render(<BillingUsageComponent org={ORG} hosts={hosts as never} />)
  await waitFor(() => {
    expect(
      screen.getByText('Campaign emails (this hour, organization)'),
    ).toBeTruthy()
  })
  await waitFor(() => {
    expect(
      screen.getByText('Bandwidth (this month, organization)').parentElement
        ?.textContent,
    ).toContain('/')
  })
}

describe('the meter reads counters, never collections', () => {
  it('scans nothing', async () => {
    await mount(HOSTS_3)
    // The anti-vacuity control: the render really did read something, so
    // "no scans" is not "no reads".
    expect(mockReads.length).toBeGreaterThan(5)
    expect(mockReads.filter((read) => read.kind === 'getDocs')).toEqual([])
  })

  it('takes head counts through the aggregation, not a document list', async () => {
    await mount([HOST_A])
    const counted = mockReads
      .filter((read) => read.kind === 'count')
      .map((read) => read.path)
    // One billed read each, whatever the collection holds. `contacts` is the
    // one that makes this matter: an org's audience is the largest collection
    // on the platform and listing it to size it would be ruinous.
    expect(counted).toContain('orgs/org-1/contacts')
    expect(counted).toContain('orgs/org-1/datasets')
    // The records band's other two parts (AGL-2611): one aggregate each,
    // never a listing — a company list can be tens of thousands.
    expect(counted).toContain('orgs/org-1/companies')
    expect(counted).toContain('orgs/org-1/deals')
  })

  it('reads every total by document id', async () => {
    await mount([HOST_A])
    const byId = mockReads
      .filter((read) => read.kind === 'getDoc')
      .map((read) => read.path)
    // The campaign counter the send gate itself claims against — read, never
    // recomputed from delivery records.
    expect(byId).toContain('orgs/org-1/counters/campaignEmailSends')
    expect(byId).toContain(
      `orgs/org-1/apiUsage/${new Date().toISOString().slice(0, 7)}`,
    )
    // Today's one-to-one email counter (AGL-2611), keyed by UTC day as the
    // send route keys its write — the document the cap is enforced against.
    expect(byId).toContain(
      `orgs/org-1/crmEmailUsage/${new Date().toISOString().slice(0, 10)}`,
    )
  })
})

describe('the organization is read once, whatever the site count', () => {
  it('costs the same org-scoped reads at one site and at three', async () => {
    await mount([HOST_A])
    const one = orgScoped()
      .map((read) => `${read.kind} ${read.path}`)
      .sort()
    const oneFetches = orgFetches().sort()

    // Unmount before the second render. RTL's automatic cleanup runs between
    // TESTS, so two cards would otherwise be mounted at once and the second
    // measurement would be of both.
    cleanup()
    mockReads.length = 0
    mockFetched.length = 0
    await mount(HOSTS_3)
    const three = orgScoped()
      .map((read) => `${read.kind} ${read.path}`)
      .sort()

    // Identical, not merely similar. A new org-wide figure placed inside the
    // per-host block would show up here as three copies of one path.
    expect(three).toEqual(one)
    expect(orgFetches().sort()).toEqual(oneFetches)
    // Non-vacuous: the per-HOST reads did scale, so the comparison above is
    // over a fixture where the two counts genuinely differ.
    expect(
      mockReads.filter((read) => read.path.startsWith('hosts/')).length,
    ).toBeGreaterThan(0)
  })

  it('asks for the send ceiling exactly once, for the org', async () => {
    await mount(HOSTS_3)
    const asked = mockFetched.filter((url) =>
      url.startsWith('/api/billing/email-ceiling'),
    )
    expect(asked).toEqual(['/api/billing/email-ceiling?orgId=org-1'])
    // Two server-side document reads behind it at most — the platform ramp
    // (cached 15s in-process) and this org's hourly window — and neither is a
    // scan. Pinned as a comment on the route; pinned here as the ONE request
    // that carries them.
    expect(asked).toHaveLength(1)
  })

  it('adds no Firestore read for the hourly ceiling', async () => {
    // Its counter lives in `rateLimits`, which the rules deny to every client.
    // A client read there would not be expensive — it would be denied, and the
    // row would silently never render.
    await mount([HOST_A])
    expect(
      mockReads.filter((read) => read.path.includes('rateLimits')),
    ).toEqual([])
  })
})
