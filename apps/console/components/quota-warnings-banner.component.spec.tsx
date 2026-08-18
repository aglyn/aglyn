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
 * AGL-1068: the banner must not ask for org-wide totals it is not allowed
 * to have.
 *
 * What is asserted is the QUERY, not the rendering. An unfiltered `count()`
 * over an org collection is denied for a scoped collaborator on the query
 * SHAPE — Firestore does not evaluate an aggregate per document — so the
 * only fix is to not send it. Asserting "the row is absent" would pass just
 * as well with the query still going out and failing, which is precisely
 * the state this issue describes: every page load denied, silently caught,
 * and the row missing anyway.
 *
 * So each case records calls to `getCountFromServer` AND `getDocs` and checks
 * which paths they addressed. Both belong here: the team-seat row switched
 * from an aggregate to a document read (AGL-1113, so site collaborators stop
 * counting as managers), and a `getDocs` over an org collection is denied to a
 * scoped collaborator exactly like the `count()` was. Recording only the
 * aggregate would have quietly dropped the members path from this file's
 * coverage the moment it changed shape.
 */

import { render, screen, waitFor } from '@testing-library/react'

/** Every org/host path the banner ASKED for, by count() or getDocs(). */
const countedPaths: string[] = []
const scope = { orgWide: true, loaded: false }
const currentOrg: { org: Record<string, unknown>; orgId: string } = {
  org: { plan: 'business' },
  orgId: 'org-1',
}

jest.mock('firebase/firestore', () => ({
  ...jest.requireActual('firebase/firestore'),
  collection: (_db: unknown, ...segments: string[]) => segments.join('/'),
  doc: (_db: unknown, ...segments: string[]) => segments.join('/'),
  getDoc: jest.fn().mockResolvedValue({ exists: () => false, data: () => ({}) }),
  getCountFromServer: jest.fn((path: string) => {
    countedPaths.push(path)
    return Promise.resolve({ data: () => ({ count: 3 }) })
  }),
  // Three org-wide members, matching the count the aggregate used to return,
  // so the seat row still reads 3 used and every quota assertion below is
  // unchanged by the AGL-1113 switch.
  getDocs: jest.fn((path: string) => {
    countedPaths.push(path)
    return Promise.resolve({
      docs: [1, 2, 3].map(() => ({
        data: () => ({ role: 'admin', allHosts: true, hostAccess: {} }),
      })),
    })
  }),
}))

jest.mock('@aglyn/tenant-feature-instance', () => ({
  useFirestore: () => ({}),
  useScopeTokens: () => scope,
  // The seat count is fetched from `/api/orgs/members?counts=1` now
  // (AGL-1253) rather than read from Firestore, so the banner asks for an ID
  // token. These suites assert which FIRESTORE queries are issued and what
  // renders; the seat row is not among their assertions, and `fetch` is
  // stubbed in `beforeEach` so the new call cannot reach the network or throw
  // into the noise.
  useUser: () => ({ data: { uid: 'viewer', getIdToken: async () => 'tok' } }),
}))

// Small enough that the mocked count of 3 breaches every host row, so the
// rendering cases below have a banner to assert about at all.
jest.mock('@aglyn/aglyn', () => ({
  ...jest.requireActual('@aglyn/aglyn'),
  resolveOrgEntitlements: () => ({
    screensPerHost: 3,
    storagePerHostMb: 100,
    datasetsPerOrg: 5,
  }),
}))

jest.mock('@aglyn/shared-ui-jsx', () => ({
  AppLink: ({ href, children }: { href: string; children: string }) => (
    <a href={href}>{children}</a>
  ),
}))

jest.mock('../hooks/use-current-org', () => ({
  __esModule: true,
  default: () => ({ ...currentOrg, ready: true }),
}))

/**
 * The route's own answer to "which workspace is this page about" (AGL-1916),
 * and the org the scope actually resolved to — the two the banner must now
 * agree before it claims anything. Defaults are an org route whose slug the
 * resolved org matches, so every pre-existing case above is unaffected.
 */
const routeScope = {
  namesOrg: true,
  pathOrgSlug: 'acme' as string | null,
  currentOrg: { $id: 'org-1', slug: 'acme' } as { $id: string; slug?: string },
}

jest.mock('../hooks/use-org-scope', () => ({
  useOrgSlug: () => 'acme',
  useOrgScope: () => routeScope,
}))
jest.mock('../hooks/use-secondary-nav', () => ({
  useUrlNamesOrg: () => routeScope.namesOrg,
}))
jest.mock('../components/host-id-provider', () => ({
  useHostId: () => 'host-1',
}))
jest.mock('next/navigation', () => ({ useParams: () => ({}) }))

import QuotaWarningsBanner from './quota-warnings-banner.component'

const orgPaths = () => countedPaths.filter((p) => p.startsWith('orgs/'))

/** Seat-count fetches made by the banner (AGL-1253). */
const seatFetches: string[] = []

beforeEach(() => {
  countedPaths.length = 0
  seatFetches.length = 0
  scope.orgWide = true
  scope.loaded = false
  currentOrg.org = { plan: 'business' }
  routeScope.namesOrg = true
  routeScope.pathOrgSlug = 'acme'
  routeScope.currentOrg = { $id: 'org-1', slug: 'acme' }
  sessionStorage.clear()
  // The seat count is a server call now. Stubbed rather than left undefined
  // so a scope-gating regression shows up as an unexpected ENTRY here, not as
  // an unhandled rejection buried in the output.
  global.fetch = jest.fn(async (input: RequestInfo | URL) => {
    seatFetches.push(String(input))
    return new Response(JSON.stringify({ managerSeats: 1, memberCount: 1 }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }) as unknown as typeof fetch
})

describe('QuotaWarningsBanner org-wide counts (AGL-1068)', () => {
  it('asks for no org total while the viewer scope is still loading', async () => {
    render(<QuotaWarningsBanner />)
    // The host-scoped screens count is fine and proves the effect ran at
    // all — without it an empty `orgPaths()` would pass vacuously.
    await waitFor(() => expect(countedPaths).toContain('hosts/host-1/screens'))
    expect(orgPaths()).toEqual([])
  })

  it('asks for no org total for a scoped collaborator', async () => {
    scope.loaded = true
    scope.orgWide = false
    render(<QuotaWarningsBanner />)
    await waitFor(() => expect(countedPaths).toContain('hosts/host-1/screens'))
    expect(orgPaths()).toEqual([])
  })

  it('asks for both once an org-wide viewer has resolved', async () => {
    scope.loaded = true
    scope.orgWide = true
    render(<QuotaWarningsBanner />)
    await waitFor(() => expect(orgPaths()).toContain('orgs/org-1/datasets'))
    // Seats come from the SERVER now (AGL-1253), not from a Firestore list.
    // The client list was denied for readers this component had already
    // decided were org-wide, because the client and the rules disagree about
    // what org-wide means for a legacy member doc.
    await waitFor(() =>
      expect(seatFetches.join('\n')).toContain(
        '/api/orgs/members?orgId=org-1&counts=1',
      ),
    )
  })

  it('never lists the org roster from the client (AGL-1253)', async () => {
    // The regression guard. `orgs/{orgId}/members` is a LIST, evaluated
    // against the query, so the rule's own-document clause can never satisfy
    // it — asking at all is the bug, whatever the viewer's scope looks like
    // from here.
    scope.loaded = true
    scope.orgWide = true
    render(<QuotaWarningsBanner />)
    await waitFor(() => expect(orgPaths()).toContain('orgs/org-1/datasets'))
    expect(orgPaths()).not.toContain('orgs/org-1/members')
  })

  it('asks for no seat count while the viewer scope is still loading', async () => {
    // The AGL-1068 gate must still hold for the server call, or a scoped
    // collaborator gets a 403 per mount instead of a denied read.
    render(<QuotaWarningsBanner />)
    await waitFor(() => expect(countedPaths).toContain('hosts/host-1/screens'))
    expect(seatFetches).toEqual([])
  })

  it('never addresses the removed host datasets path (AGL-1050)', async () => {
    scope.loaded = true
    scope.orgWide = true
    render(<QuotaWarningsBanner />)
    await waitFor(() => expect(countedPaths).toContain('hosts/host-1/screens'))
    expect(countedPaths).not.toContain('hosts/host-1/datasets')
  })
})

/**
 * AGL-1072: the actions, not the queries. Billing is gone from a site
 * collaborator's console and AGL-1032 redirects them off the URL, so a link
 * to it here is a round trip back to where they started.
 *
 * Every case asserts the WARNING is still rendered alongside the missing
 * link — "no link to billing" passes trivially on a banner that never
 * appeared, which would be the other bug (a collaborator hitting a screens
 * limit with nothing on screen to explain it).
 */
const billingLinks = () =>
  screen
    .queryAllByRole('link')
    .filter((link) => link.getAttribute('href')?.includes('billing'))

describe('QuotaWarningsBanner actions for a scoped viewer (AGL-1072)', () => {
  it('offers Upgrade to an org-wide viewer', async () => {
    scope.loaded = true
    scope.orgWide = true
    render(<QuotaWarningsBanner />)
    await screen.findByText(/reached your screens limit/)
    expect(billingLinks()).toHaveLength(1)
    expect(billingLinks()[0].textContent).toBe('Upgrade')
  })

  it('warns a site collaborator without linking to Billing', async () => {
    scope.loaded = true
    scope.orgWide = false
    render(<QuotaWarningsBanner />)
    await screen.findByText(/ask a workspace admin to upgrade/)
    expect(billingLinks()).toEqual([])
  })

  it('offers no Upgrade while the viewer scope is still loading', async () => {
    // Withheld, but NOT reworded: the button costs an owner one render,
    // whereas the collaborator wording would spend that render telling the
    // owner to go ask an admin — themselves.
    render(<QuotaWarningsBanner />)
    await screen.findByText(/reached your screens limit/)
    expect(billingLinks()).toEqual([])
  })

  it('sends a site collaborator to an admin when payment is past due', async () => {
    scope.loaded = true
    scope.orgWide = false
    currentOrg.org = { plan: 'business', subscription: { status: 'past_due' } }
    render(<QuotaWarningsBanner />)
    await screen.findByText(/A workspace admin needs to update the payment/)
    expect(billingLinks()).toEqual([])
  })

  it('keeps Fix payment for an org-wide viewer', async () => {
    scope.loaded = true
    scope.orgWide = true
    currentOrg.org = { plan: 'business', subscription: { status: 'past_due' } }
    render(<QuotaWarningsBanner />)
    await screen.findByText(/Update your payment method/)
    expect(billingLinks()[0].textContent).toBe('Fix payment')
  })
})

/**
 * AGL-1916: the banner must be silent where the URL names no workspace.
 *
 * Every case here sets up a FULLY RESOLVED, breaching org — the same fixture
 * the suites above use to render a banner — and changes only the route. That
 * is the whole point: `plan` is truthy, the seat and screen quotas are over
 * their limits, and the banner must still say nothing, because the org that
 * answered is one the picker never asked about. A case that also blanked the
 * org would pass with the gate deleted.
 *
 * The paired positive lives in `renders on an org route ...` below, and it is
 * the load-bearing half: silencing a real breach trades a false positive for a
 * false negative, and a quota warning nobody sees is money nobody collects.
 */
describe('QuotaWarningsBanner off an org-scoped route (AGL-1916)', () => {
  /** The picker: `/` on the apex, no path slug, no subdomain. */
  const onThePicker = () => {
    routeScope.namesOrg = false
    routeScope.pathOrgSlug = null
    // The fallback the scope hands out anyway — a remembered selection or the
    // user's first org. Present on purpose: this is the reported bug's exact
    // state, an org fully resolved on a page that named none.
    routeScope.currentOrg = { $id: 'org-1', slug: 'acme' }
    scope.loaded = true
    scope.orgWide = true
  }

  it('renders no quota banner on the workspace picker', async () => {
    onThePicker()
    const { container } = render(<QuotaWarningsBanner />)
    // Give the effects the same window the positive cases need to render.
    await waitFor(() => expect(seatFetches).toEqual([]))
    expect(container.innerHTML).toBe('')
    expect(screen.queryByText(/reached your/)).toBeNull()
  })

  it('asks for no seat count or quota totals on the picker', async () => {
    // The banner's cost, not just its wording. Gating only the render would
    // leave `/api/orgs/members?counts=1` firing for the fallback org on every
    // mount of a page that has no org — and, for a viewer whose scope the
    // rules disagree with, a 403 per mount.
    onThePicker()
    render(<QuotaWarningsBanner />)
    await waitFor(() => expect(seatFetches).toEqual([]))
    expect(countedPaths).toEqual([])
  })

  it('renders no SUSPENSION banner on the picker', async () => {
    // Suspension outranks plan and dismissal by design (AGL-202). It does not
    // outrank knowing which workspace it is about.
    onThePicker()
    currentOrg.org = { plan: 'business', suspendedAt: 1 }
    const { container } = render(<QuotaWarningsBanner />)
    await waitFor(() => expect(seatFetches).toEqual([]))
    expect(screen.queryByText(/This account is suspended/)).toBeNull()
    expect(container.innerHTML).toBe('')
  })

  it('renders no DUNNING banner on the picker', async () => {
    onThePicker()
    currentOrg.org = { plan: 'business', billingStatus: 'past_due' }
    const { container } = render(<QuotaWarningsBanner />)
    await waitFor(() => expect(seatFetches).toEqual([]))
    expect(screen.queryByText(/last payment failed/)).toBeNull()
    expect(container.innerHTML).toBe('')
  })

  it('stays silent when the resolved org contradicts the URL slug', async () => {
    // The URL names a workspace, so `useUrlNamesOrg()` alone would let this
    // through — but the scope fell through to a DIFFERENT org (a shared link
    // to a workspace this user is not in). Same ambient answer, now wearing a
    // URL that appears to justify it.
    routeScope.namesOrg = true
    routeScope.pathOrgSlug = 'other-org'
    routeScope.currentOrg = { $id: 'org-1', slug: 'acme' }
    scope.loaded = true
    scope.orgWide = true
    const { container } = render(<QuotaWarningsBanner />)
    await waitFor(() => expect(seatFetches).toEqual([]))
    expect(container.innerHTML).toBe('')
  })

  it('still warns when the membership row carries no slug at all', async () => {
    // The deliberate NON-suppression. `slug` is optional on the membership
    // doc, and a legacy row without one must not silence a real breach —
    // only a slug that actively DISAGREES suppresses. If this ever flips to
    // "silent", the gate has become a revenue bug.
    routeScope.namesOrg = true
    routeScope.pathOrgSlug = 'acme'
    routeScope.currentOrg = { $id: 'org-1' }
    scope.loaded = true
    scope.orgWide = true
    render(<QuotaWarningsBanner />)
    await screen.findByText(/reached your screens limit/)
  })

  it('renders on an org route with a breached quota (the paired positive)', async () => {
    // Unchanged defaults: URL names the workspace, resolved org agrees. The
    // gate must not have silenced the case the banner exists for.
    scope.loaded = true
    scope.orgWide = true
    render(<QuotaWarningsBanner />)
    await screen.findByText(/reached your screens limit/)
    expect(countedPaths).toContain('hosts/host-1/screens')
    await waitFor(() =>
      expect(seatFetches.join('\n')).toContain('/api/orgs/members?orgId=org-1'),
    )
  })
})
