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
 *
 * @jest-environment jsdom
 */

/**
 * AGL-2336 — an agency in more than 50 workspaces was locked out of the ones
 * past 50.
 *
 * The membership listen was a bare `limit(50)` with no cursor and no count,
 * and `useOrgScope` is not a list — it is what resolves WHICH org you are in.
 * So workspaces past the 50th were not merely hidden from the switcher, they
 * were unreachable: nothing could produce a `currentOrg` for them.
 *
 * The cap was never the thing protecting us. `org-switcher-nav` handed the
 * WHOLE membership list to `useOrgPlans`, which reads one org doc per id
 * every time the menu opens — 50 reads a glance at 50 memberships, 500 at
 * 500. Raising the number alone would have bought a cost regression, so the
 * fan-out had to go first.
 *
 * Hence three separate contracts here, and all three have to hold — passing
 * only the reachability one is exactly the shape of "the cap was deleted":
 *
 *  1. **The read cost does not scale with membership count.** Opening the
 *     switcher reads a CONSTANT number of plan docs, and re-opening it reads
 *     none at all.
 *  2. **A workspace outside the window is reachable by URL**, in two reads,
 *     regardless of how many memberships exist.
 *  3. **The window says it is a window**, and can be grown.
 */
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import type { UserOrgMembership } from '@aglyn/aglyn'
import OrgSwitcherNav, {
  PLAN_BADGE_PAGE,
} from '../components/org-switcher-nav.component'
import {
  ORG_PAGE_SIZE,
  OrgScopeProvider,
  useOrgScope,
} from '../hooks/use-org-scope'

/** Every membership listen opened, newest last, with the limit it asked for. */
const mockListens: Array<{
  limit: number
  next: (snapshot: unknown) => void
  error: (error: unknown) => void
}> = []

/** Every `getDoc` path, in order — this is the read bill under test. */
const mockReads: string[] = []
/** Path → doc data. A path absent from here reads as a non-existent doc. */
const mockDocs = new Map<string, Record<string, unknown>>()

jest.mock('firebase/firestore', () => ({
  collection: (_firestore: unknown, ...segments: string[]) =>
    segments.join('/'),
  doc: (_firestore: unknown, ...segments: string[]) => segments.join('/'),
  getDoc: async (path: string) => {
    mockReads.push(path)
    const data = mockDocs.get(path)
    return {
      id: path.split('/').pop(),
      exists: () => data !== undefined,
      data: () => data,
      get: (field: string) => data?.[field],
    }
  },
  limit: (count: number) => ({ __limit: count }),
  query: (path: string, ...clauses: Array<{ __limit?: number }>) => ({
    path,
    limit: clauses.find((clause) => clause?.__limit !== undefined)?.__limit,
  }),
  onSnapshot: (
    request: { limit: number },
    _options: unknown,
    next: (snapshot: unknown) => void,
    error: (error: unknown) => void,
  ) => {
    mockListens.push({ limit: request.limit, next, error })
    return () => undefined
  },
}))

jest.mock('@aglyn/tenant-feature-instance', () => {
  // Stable identities, as reactfire provides — a fresh object per render
  // would restart the membership listen on every state change.
  const firestore = {}
  const auth = {}
  const user = { data: { uid: 'user-1' } }
  return {
    useFirestore: () => firestore,
    useUser: () => user,
    // `useAuthRecovery` reads the Auth instance on every render (it re-runs a
    // read that a dead SESSION killed, once the session comes back). Nothing
    // in this suite makes it subscribe, but the accessor must exist or the
    // provider throws before the behavior under test can run.
    useAuth: () => auth,
  }
})

let mockParams: Record<string, string> = { orgSlug: 'client-1' }
jest.mock('next/navigation', () => ({
  useParams: () => mockParams,
  usePathname: () => `/${mockParams['orgSlug'] ?? ''}/hosts`,
  useRouter: () => ({ push: jest.fn() }),
}))

// The switcher's own current-org doc: a live subscription, unrelated to the
// per-row plan reads this is measuring.
jest.mock('../hooks/use-current-org', () => ({
  __esModule: true,
  default: () => ({ org: { plan: 'agency' }, ready: true }),
  useCurrentOrg: () => ({ org: { plan: 'agency' }, ready: true }),
}))

// Leaves, not the subject: the create dialog and the search input pull in
// their own Firestore/router worlds and neither participates in the fan-out.
jest.mock('../components/create-org-dialog.component', () => ({
  __esModule: true,
  default: () => null,
}))
jest.mock('../components/switcher-search-field.component', () => ({
  __esModule: true,
  default: (props: { value: string; onChange: (value: string) => void }) => (
    <input
      aria-label="Find organization"
      value={props.value}
      onChange={(event) => props.onChange(event.target.value)}
    />
  ),
}))

const membershipSnapshot = (memberships: UserOrgMembership[]) => ({
  metadata: { fromCache: false },
  docChanges: () => memberships.map(() => ({})),
  docs: memberships.map((membership) => ({
    id: membership.$id,
    data: () => membership,
  })),
})

/** `count` memberships named client-1…client-N, all on the agency plan. */
const memberships = (count: number): UserOrgMembership[] =>
  Array.from({ length: count }, (_, index) => ({
    $id: `org-${index + 1}`,
    slug: `client-${index + 1}`,
    orgName: `Client ${index + 1}`,
    role: 'admin',
  })) as unknown as UserOrgMembership[]

const newestListen = () => {
  const listen = mockListens[mockListens.length - 1]
  if (!listen) throw new Error('no membership listen is open')
  return listen
}

const deliver = (list: UserOrgMembership[]) =>
  act(() => newestListen().next(membershipSnapshot(list)))

const planReads = () => mockReads.filter((path) => path.startsWith('orgs/'))

const openSwitcher = () =>
  fireEvent.click(screen.getByRole('button', { name: /^Workspace:/ }))

/** Lets the plan reads' promises settle. */
const settle = async () => {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

function ScopeProbe() {
  const { currentOrg, orgs, hasMoreOrgs, loadMoreOrgs } = useOrgScope()
  return (
    <>
      <span data-testid="current">{currentOrg?.$id ?? 'none'}</span>
      <span data-testid="count">{String(orgs.length)}</span>
      <span data-testid="more">{String(hasMoreOrgs)}</span>
      <button onClick={loadMoreOrgs}>{'Load more'}</button>
    </>
  )
}

beforeEach(() => {
  mockListens.length = 0
  mockReads.length = 0
  mockDocs.clear()
  mockParams = { orgSlug: 'client-1' }
  // Every org doc resolves, so nothing is left "unknown" and retried.
  for (let index = 1; index <= 400; index += 1) {
    mockDocs.set(`orgs/org-${index}`, { plan: 'agency' })
  }
})

describe('the membership window is bounded, not capped (AGL-2336)', () => {
  it('REGRESSION — opening the switcher costs a CONSTANT number of plan reads', async () => {
    render(
      <OrgScopeProvider>
        <OrgSwitcherNav />
      </OrgScopeProvider>,
    )
    deliver(memberships(ORG_PAGE_SIZE))
    expect(planReads()).toHaveLength(0)

    openSwitcher()
    await settle()

    // The number that matters is that it does not scale with the membership
    // count. Before the fix this was one read per membership — 50 here, and
    // 500 the moment the cap was raised, which is precisely why the cap
    // could not be raised.
    expect(planReads()).toHaveLength(PLAN_BADGE_PAGE)
    expect(planReads().length).toBeLessThan(ORG_PAGE_SIZE)
  })

  it('REGRESSION — re-opening the switcher reads NOTHING', async () => {
    render(
      <OrgScopeProvider>
        <OrgSwitcherNav />
      </OrgScopeProvider>,
    )
    deliver(memberships(ORG_PAGE_SIZE))
    openSwitcher()
    await settle()
    const first = planReads().length
    expect(first).toBe(PLAN_BADGE_PAGE)

    fireEvent.keyDown(document.activeElement ?? document.body, {
      key: 'Escape',
    })
    await settle()
    openSwitcher()
    await settle()

    // A resolved tier is an answer, not a cache miss. Charging for it again
    // on every glance at the menu is the whole cost regression.
    expect(planReads()).toHaveLength(first)
  })

  it('reveals more badges as the list is scrolled — a window, not a truncation', async () => {
    render(
      <OrgScopeProvider>
        <OrgSwitcherNav />
      </OrgScopeProvider>,
    )
    deliver(memberships(ORG_PAGE_SIZE))
    openSwitcher()
    await settle()
    expect(planReads()).toHaveLength(PLAN_BADGE_PAGE)

    // The rows' own parent is the scroll container the reveal hangs off.
    const container = within(screen.getByRole('menu'))
      .getAllByRole('menuitem')[0].parentElement as HTMLElement
    Object.defineProperty(container, 'scrollHeight', {
      value: 1000,
      configurable: true,
    })
    Object.defineProperty(container, 'clientHeight', {
      value: 280,
      configurable: true,
    })
    Object.defineProperty(container, 'scrollTop', {
      value: 720,
      configurable: true,
    })
    fireEvent.scroll(container)
    await settle()

    expect(planReads().length).toBeGreaterThan(PLAN_BADGE_PAGE)
    // Still only what was looked at — never the whole list in one go.
    expect(planReads().length).toBeLessThanOrEqual(PLAN_BADGE_PAGE * 2)
  })

  it('REGRESSION — a workspace OUTSIDE the window is reachable by URL', async () => {
    // The URL names client-99; the window holds client-1…client-50.
    mockParams = { orgSlug: 'client-99' }
    mockDocs.set('orgSlugs/client-99', { orgId: 'org-99' })
    mockDocs.set('users/user-1/orgs/org-99', {
      slug: 'client-99',
      orgName: 'Client 99',
      role: 'admin',
    })

    render(
      <OrgScopeProvider>
        <ScopeProbe />
      </OrgScopeProvider>,
    )
    deliver(memberships(ORG_PAGE_SIZE))
    await settle()

    // Before the fix this stayed 'none' forever: `currentOrg` was resolved by
    // SEARCHING the loaded list, so the list WAS the set of reachable
    // workspaces and paging it could not have helped — you cannot page to a
    // workspace you cannot name.
    expect(screen.getByTestId('current').textContent).toBe('org-99')
    // Two reads, once — the slug index and the membership doc. Constant, so
    // reachability does not reintroduce the fan-out through the back door.
    expect(mockReads).toEqual([
      'orgSlugs/client-99',
      'users/user-1/orgs/org-99',
    ])
  })

  it('does not spend reads on a workspace the window already holds', async () => {
    mockParams = { orgSlug: 'client-7' }
    render(
      <OrgScopeProvider>
        <ScopeProbe />
      </OrgScopeProvider>,
    )
    deliver(memberships(ORG_PAGE_SIZE))
    await settle()

    expect(screen.getByTestId('current').textContent).toBe('org-7')
    expect(mockReads).toHaveLength(0)
  })

  it('a non-member URL is a CONFIRMED miss, asked once and not re-asked', async () => {
    mockParams = { orgSlug: 'someone-elses' }
    mockDocs.set('orgSlugs/someone-elses', { orgId: 'org-999' })
    // No `users/user-1/orgs/org-999` — the caller is not a member.

    render(
      <OrgScopeProvider>
        <ScopeProbe />
      </OrgScopeProvider>,
    )
    deliver(memberships(ORG_PAGE_SIZE))
    await settle()
    // Asked exactly once. A miss is an ANSWER, and re-asking it on every
    // membership snapshot would turn a bounded lookup into a per-tick read.
    expect(mockReads).toEqual([
      'orgSlugs/someone-elses',
      'users/user-1/orgs/org-999',
    ])
    // It grants nothing: the slug resolves to no membership, so the scope
    // falls through to the same first-org default an unknown slug has always
    // taken (the route guards 404 off `slugExists`, not off this).
    expect(screen.getByTestId('current').textContent).toBe('org-1')

    deliver(memberships(ORG_PAGE_SIZE))
    await settle()
    expect(mockReads).toHaveLength(2)
  })

  it('REGRESSION — a full window admits it is a window, and grows', async () => {
    render(
      <OrgScopeProvider>
        <ScopeProbe />
      </OrgScopeProvider>,
    )
    expect(newestListen().limit).toBe(ORG_PAGE_SIZE)

    deliver(memberships(ORG_PAGE_SIZE))
    // A full window is not known to be the whole list. Saying nothing here
    // is what let 50 pass for "all".
    expect(screen.getByTestId('more').textContent).toBe('true')
    expect(screen.getByTestId('count').textContent).toBe(String(ORG_PAGE_SIZE))

    fireEvent.click(screen.getByRole('button', { name: 'Load more' }))
    expect(newestListen().limit).toBe(ORG_PAGE_SIZE * 2)

    deliver(memberships(ORG_PAGE_SIZE + 30))
    expect(screen.getByTestId('count').textContent).toBe(
      String(ORG_PAGE_SIZE + 30),
    )
    // A window that came back short IS the whole list — stop claiming more.
    expect(screen.getByTestId('more').textContent).toBe('false')
  })

  it('a short first window never claims to be truncated', () => {
    render(
      <OrgScopeProvider>
        <ScopeProbe />
      </OrgScopeProvider>,
    )
    deliver(memberships(3))
    expect(screen.getByTestId('more').textContent).toBe('false')
  })
})
