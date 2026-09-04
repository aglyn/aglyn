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
 * THE ORG CONTACTS PAGE, AT THE ROUTE.
 *
 * This is the one surface designed to read ACROSS the host boundary, so what
 * it admits and what it renders are the same question asked twice. Both are
 * driven here from the composition Next actually mounts — the `[orgSlug]`
 * layout (which is `OrgGuard`) around the page — rather than from a predicate
 * in isolation.
 *
 * ## Nothing here stubs the permission module
 *
 * `useOrgPermissions` runs for real, resolving a real member document through
 * `resolveOrgPermissions`. A stubbed resolver answering "no" to everything
 * makes every deny-test green while proving nothing — the collaborator case
 * would pass against a gate that refuses the owner too. So the ONLY thing
 * mocked underneath the gate is the Firestore read that fetches the member
 * document, and the owner cases run through the identical harness. Every
 * refusal below is paired with a grant that would die if the gate simply
 * closed.
 *
 * ## And nothing stubs the reach predicate
 *
 * `useOrgReach` runs for real over a mocked `useOrgScope`, so a site
 * collaborator is expressed the way one actually exists — an org membership
 * row with `orgWide: false` — and `isOrgWideMembership` is what decides.
 */

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'

/*==========================================
 * THE WORLD, driven per test.
 *
 * `mock`-prefixed because jest hoists the `jest.mock` factories above these
 * declarations.
 *=========================================*/
let mockMembership: Record<string, unknown>
let mockMemberDoc: Record<string, unknown>
let mockContacts: Record<string, unknown>[]
let mockContactTotal: number
let mockHasMore: boolean
let mockOrgDoc: Record<string, unknown>
/** Every query the list listener built, so a refusal can be shown to read nothing. */
let mockBuiltQueries: unknown[]
/** Every aggregate count() the page asked for, for the same reason. */
let mockCountReads: string[]
const mockReplace = jest.fn()

jest.mock('next/navigation', () => ({
  useRouter: () => ({ replace: mockReplace, push: jest.fn() }),
  usePathname: () => '/test-org/contacts',
  notFound: () => {
    throw new Error('notFound')
  },
}))

jest.mock('@aglyn/shared-ui-snackstack', () => ({
  useSnackbar: () => ({ enqueueSnackbar: () => undefined }),
}))

/**
 * Firestore, reduced to the shapes this page composes.
 *
 * `getDoc` is what `useOrgPermissions` reads the member document through, so
 * it is the seam that lets the REAL permission resolver run.
 */
jest.mock('firebase/firestore', () => ({
  collection: (_db: unknown, ...segments: string[]) => ({
    path: segments.join('/'),
  }),
  doc: (_db: unknown, ...segments: string[]) => ({ path: segments.join('/') }),
  getDoc: async (ref: { path: string }) => ({
    exists: () => true,
    data: () => (ref.path.includes('/members/') ? mockMemberDoc : {}),
  }),
  getCountFromServer: async (ref: { path: string }) => {
    mockCountReads.push(ref.path)
    return { data: () => ({ count: mockContactTotal }) }
  },
  query: (ref: unknown, ...constraints: unknown[]) => ({ ref, constraints }),
  where: (field: string, op: string, value: unknown) => ({ field, op, value }),
  orderBy: (field: unknown) => ({ orderBy: field }),
  documentId: () => '__name__',
  limit: (value: number) => ({ limit: value }),
  /**
   * `useReachableSites` — the read `OrgGuard` uses to decide WHERE to send a
   * scoped collaborator. Left real in the guard, so it needs a listener.
   */
  onSnapshot: (_query: unknown, next: (snapshot: unknown) => void) => {
    next({
      docs: [
        { id: 'host-a', data: () => ({ orgId: 'org-1', subdomain: 'acme' }) },
      ],
    })
    return () => undefined
  },
}))

/**
 * ⚠️ THE INSTANCES ARE SINGLETONS, AND THAT IS LOAD-BEARING.
 *
 * `useFirestore` and `useUser` are dependencies of real effects underneath
 * this page — `useOrgPermissions` keys its member read on `[user, firestore,
 * orgId]`, and `useReachableSites` keys its listener the same way. Returning a
 * fresh object from either one changes its identity on every render, so the
 * effect re-runs, sets state, and re-renders forever.
 *
 * That is not a slow test, it is an unbounded one: it took the heap to 4GB and
 * aborted the run with no failed assertion, which reads exactly like the
 * worker deaths this repo warns about and is nothing of the sort. The real
 * hooks hand back one instance for the life of the app; a mock that does not
 * is testing a component under conditions that cannot occur.
 */
jest.mock('@aglyn/tenant-feature-instance', () => {
  const firestore = {}
  const user = { data: { uid: 'u1', getIdToken: async () => 't' } }
  return {
    useFirestore: () => firestore,
    useUser: () => user,
    collectionPage: (ref: unknown, pageLimit: number) => ({
      ref,
      ordered: '__name__',
      limit: pageLimit,
    }),
    usePagedCollection: (build: (pageLimit: number) => unknown) => {
      const built = build(11)
      mockBuiltQueries.push(built)
      return {
        status: 'success',
        // A refused page must not be handed rows by the harness either — the
        // listener returning null is what the page relies on.
        rows: built ? mockContacts : [],
        hasMore: mockHasMore,
        page: 0,
        setPage: () => undefined,
        pageSize: 10,
        setPageSize: () => undefined,
      }
    },
  }
})

jest.mock('../hooks/use-org-scope', () => ({
  __esModule: true,
  useOrgSlug: () => 'test-org',
  useOrgScope: () => ({
    currentOrg: mockMembership,
    orgs: [mockMembership],
    pathOrgSlug: 'test-org',
    loading: false,
    confirmed: true,
    slugExists: true,
  }),
  default: () => ({ currentOrg: mockMembership, loading: false }),
}))

jest.mock('../hooks/use-current-org', () => ({
  __esModule: true,
  default: () => ({ org: mockOrgDoc, orgId: 'org-1', ready: true }),
}))

/**
 * The org's sites, which is where a host ID becomes a NAME. Both exports
 * answer the same way — the page imports the default and a mock that let them
 * disagree would be testing a fixture rather than the page.
 */
const ORG_HOSTS = {
  hosts: [
    // The SUBDOMAIN is deliberately unlike the id: `/[orgSlug]/hosts/[host]`
    // takes the subdomain, and a link built from the id renders the
    // site-not-found page while looking perfectly plausible in a diff.
    { $id: 'host-a', displayName: 'Acme Shop', subdomain: 'acme' },
    { $id: 'host-b', displayName: 'Globex Clinic', subdomain: 'globex' },
  ],
  ready: true,
  error: false,
  retry: () => undefined,
}
// One object, for the reason the Firestore instance above is one: the page
// memoises its name maps on this identity.
const mockOrgHosts = () => ORG_HOSTS
jest.mock('../hooks/use-org-hosts', () => ({
  __esModule: true,
  useOrgHosts: () => mockOrgHosts(),
  default: () => mockOrgHosts(),
}))

jest.mock('../hooks/use-release-flags', () => ({
  useReleaseFlag: () => ({
    visible: true,
    staffPreview: false,
    ready: true,
    isStaff: false,
    released: true,
  }),
}))

/**
 * The layout, reduced to its SLOTS rather than removed.
 *
 * `headerRight` carries the quota readout and `aside` carries the drawer, so a
 * passthrough that dropped them would silently stop testing two of the things
 * this page puts there.
 */
jest.mock('../components/layouts/dashboard.layout', () => ({
  __esModule: true,
  default: ({ children, headerRight, aside }: any) => (
    <div>
      <div data-testid="header-right">{headerRight}</div>
      {children}
      {aside}
    </div>
  ),
}))

import OrgContactsPage from '../app/(app)/[orgSlug]/contacts/page'
import OrgSlugLayout from '../app/(app)/[orgSlug]/layout'

/** The composition Next mounts: the org guard around the page. */
const AtTheRoute = () => (
  <OrgSlugLayout>
    <OrgContactsPage />
  </OrgSlugLayout>
)

const ORG_WIDE_OWNER = { $id: 'org-1', slug: 'test-org', role: 'owner' }
/** A site collaborator, as `grantHostAccess` writes one. */
const SITE_COLLABORATOR = {
  $id: 'org-1',
  slug: 'test-org',
  role: 'editor',
  orgWide: false,
}

const JO_ON_TWO_SITES = {
  $id: 'contact-jo',
  email: 'jo@example.com',
  name: 'Jo Canonical',
  capturedByHostIds: ['host-b', 'host-a'],
  marketingConsentByHost: {
    'host-a': { marketingConsent: true },
    'host-b': { marketingConsent: false },
  },
  facets: {
    'host-a': {
      name: 'JoRenamedByAcme',
      notes: 'ACMEPRIVATENOTE',
      tags: ['ACMEPRIVATETAG'],
      sources: { order: true },
      interactions: [{ type: 'order', atMs: 1, summary: 'ACMEPRIVATECALL' }],
      ltvCents: 123_456,
      ordersCount: 9,
    },
  },
}

beforeEach(() => {
  jest.clearAllMocks()
  mockMembership = ORG_WIDE_OWNER
  mockMemberDoc = { role: 'owner' }
  mockContacts = [JO_ON_TWO_SITES]
  mockContactTotal = 1
  mockHasMore = false
  mockOrgDoc = { $id: 'org-1', plan: 'business' }
  mockBuiltQueries = []
  mockCountReads = []
})

/**
 * Opens the "Captured by" picker and chooses a site.
 *
 * `mouseDown`, not `click`: an MUI Select opens on mousedown, and a click
 * event alone leaves the listbox closed with no option to find — which reads
 * as "the site is not offered" rather than "the interaction was wrong".
 */
const pickSite = async (name: string) => {
  fireEvent.mouseDown(screen.getByRole('combobox', { name: /captured by/i }))
  fireEvent.click(await screen.findByRole('option', { name }))
  fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' })
}

/** The grid row holding a given email. */
const rowFor = async (email: string) => {
  const cell = await screen.findByText(email)
  const row = cell.closest('[role="row"]')
  if (!row) throw new Error(`no row for ${email}`)
  return within(row as HTMLElement)
}

describe('a SITE COLLABORATOR cannot reach the org contacts page', () => {
  beforeEach(() => {
    mockMembership = SITE_COLLABORATOR
    // The permission they genuinely hold. `data.manage` is an editor default
    // and a collaborator IS an editor, so this is the map the gate must
    // refuse in spite of.
    mockMemberDoc = { role: 'editor', allHosts: false, hostAccess: { 'host-a': 'admin' } }
  })

  it('renders no contact of any kind at the route', async () => {
    render(<AtTheRoute />)
    await waitFor(() => expect(mockReplace).toHaveBeenCalled())
    expect(screen.queryByText('jo@example.com')).toBeNull()
    expect(screen.queryByText('Jo Canonical')).toBeNull()
  })

  it('is moved off the org route rather than shown an empty one', async () => {
    render(<AtTheRoute />)
    await waitFor(() => expect(mockReplace).toHaveBeenCalled())
  })

  it('is STILL refused with the guard bypassed — the page holds its own', async () => {
    render(<OrgContactsPage />)
    expect(
      await screen.findByText(/limited to the sites you/i),
    ).toBeTruthy()
    expect(screen.queryByText('jo@example.com')).toBeNull()
  })

  it('never opens the listener, so the refusal costs no read', () => {
    render(<OrgContactsPage />)
    expect(mockBuiltQueries.length).toBeGreaterThan(0)
    expect(mockBuiltQueries.every((built) => built === null)).toBe(true)
  })

  it('costs no aggregate read either — a refusal is not billed for', async () => {
    /*
     * The head-count is a server `count()` over the whole collection. Running
     * it for somebody the gate refused spends a read on their behalf and
     * hands back a figure about an organization they were just told they may
     * not see — the count IS the disclosure, in miniature.
     */
    render(<OrgContactsPage />)
    await screen.findByText(/limited to the sites you/i)
    await waitFor(() => expect(mockCountReads).toEqual([]))
  })

  it('is told where its own people are, not to ask for a permission', async () => {
    render(<OrgContactsPage />)
    const notice = await screen.findByText(/limited to the sites you/i)
    expect(notice.textContent).not.toMatch(/permission/i)
  })
})

describe('an org-wide member reaches it — the control that makes the refusals mean something', () => {
  it('renders the contact at the route, through the same guard', async () => {
    render(<AtTheRoute />)
    expect(await screen.findByText('jo@example.com')).toBeTruthy()
    expect(mockReplace).not.toHaveBeenCalled()
  })

  it('refuses an org-wide member who lacks the permission', async () => {
    mockMemberDoc = { role: 'viewer' }
    render(<AtTheRoute />)
    expect(await screen.findByText(/don't have permission/i)).toBeTruthy()
    expect(screen.queryByText('jo@example.com')).toBeNull()
  })

  it('admits an org-wide member granted it by a per-member override', async () => {
    mockMemberDoc = { role: 'viewer', permissions: { 'data.manage': true } }
    render(<AtTheRoute />)
    expect(await screen.findByText('jo@example.com')).toBeTruthy()
  })

  it('CONTROL: an admitted reader DOES take the aggregate read', async () => {
    // Without this the refusal case above passes for a page that never counts
    // at all, which would make it a test of nothing.
    render(<AtTheRoute />)
    await screen.findByText('jo@example.com')
    await waitFor(() =>
      expect(mockCountReads).toEqual(['orgs/org-1/contacts']),
    )
  })

  it('opens the listener only once admitted', async () => {
    render(<AtTheRoute />)
    await screen.findByText('jo@example.com')
    expect(mockBuiltQueries.some((built) => built !== null)).toBe(true)
  })
})

describe('one person, every site that knows them', () => {
  it('appears ONCE and names both sites', async () => {
    render(<AtTheRoute />)
    const row = await rowFor('jo@example.com')
    expect(screen.getAllByText('jo@example.com')).toHaveLength(1)
    expect(row.getByText('Acme Shop')).toBeTruthy()
    expect(row.getByText('Globex Clinic')).toBeTruthy()
  })

  it('names a capturing site it cannot label rather than dropping it', async () => {
    mockContacts = [
      { ...JO_ON_TWO_SITES, capturedByHostIds: ['host-a', 'host-gone'] },
    ]
    render(<AtTheRoute />)
    const row = await rowFor('jo@example.com')
    // The site is gone from the org's list, but it still held a
    // relationship. Dropping it would understate who knows this person.
    expect(row.getByText('host-gone')).toBeTruthy()
  })

  it('reads no capture attribution as UNATTRIBUTED, never as every site', async () => {
    mockContacts = [
      { $id: 'c2', email: 'old@example.com', name: 'Old Row' },
    ]
    render(<AtTheRoute />)
    const row = await rowFor('old@example.com')
    expect(row.getByText('No site recorded')).toBeTruthy()
    expect(row.queryByText('Acme Shop')).toBeNull()
  })
})

describe('the bridge into a site owns the URL it builds', () => {
  it('links a site by its SUBDOMAIN, never by its document id', async () => {
    render(<AtTheRoute />)
    await screen.findByText('jo@example.com')
    fireEvent.click(
      screen.getByRole('button', { name: /more actions.*Jo Canonical/i }),
    )
    const link = (await screen.findByRole('menuitem', {
      name: /Open in Acme Shop/,
    })) as HTMLAnchorElement
    expect(link.getAttribute('href')).toBe(
      '/test-org/hosts/acme/contacts',
    )
    expect(link.getAttribute('href')).not.toContain('host-a')
  })

  it('offers no link for a site it cannot address, and says why', async () => {
    mockContacts = [
      { ...JO_ON_TWO_SITES, capturedByHostIds: ['host-a', 'host-gone'] },
    ]
    render(<AtTheRoute />)
    await screen.findByText('jo@example.com')
    fireEvent.click(
      screen.getByRole('button', { name: /more actions.*Jo Canonical/i }),
    )
    const dead = await screen.findByRole('menuitem', {
      name: /Open in host-gone/,
    })
    expect(dead.getAttribute('href')).toBeNull()
    // CONTROL: the addressable one in the SAME menu still has its link, so
    // this is about the unresolvable site and not about the menu.
    expect(
      screen.getByRole('menuitem', { name: /Open in Acme Shop/ })
        .getAttribute('href'),
    ).toBe('/test-org/hosts/acme/contacts')
  })
})

describe('per-host facet content is not rendered at org level', () => {
  /*
   * THE CONTROL FIRST. "the note is absent" passes for free if the page
   * rendered nothing at all — and this page has a refusal branch and a
   * spinner branch that would swallow exactly that. So the same render must
   * be shown to contain the fields it IS meant to carry.
   */
  it('CONTROL: the row does render this contact', async () => {
    render(<AtTheRoute />)
    expect(await screen.findByText('jo@example.com')).toBeTruthy()
    expect(screen.getByText('Jo Canonical')).toBeTruthy()
  })

  it('shows no note, tag, timeline entry or lifetime value', async () => {
    const { container } = render(<AtTheRoute />)
    await screen.findByText('jo@example.com')
    const painted = container.textContent ?? ''
    expect(painted).not.toContain('ACMEPRIVATENOTE')
    expect(painted).not.toContain('ACMEPRIVATETAG')
    expect(painted).not.toContain('ACMEPRIVATECALL')
    expect(painted).not.toContain('1234.56')
    expect(painted).not.toContain('123456')
  })

  it("shows the canonical name, not one holder's rename", async () => {
    const { container } = render(<AtTheRoute />)
    await screen.findByText('Jo Canonical')
    expect(container.textContent).not.toContain('JoRenamedByAcme')
  })

  it('says where those records live instead of hiding that they exist', async () => {
    render(<AtTheRoute />)
    await screen.findByText('jo@example.com')
    expect(
      screen.getByText(/Notes, tags and history stay on the site/i),
    ).toBeTruthy()
  })
})

describe('consent renders per host, never as a bare verdict', () => {
  it('names the site beside each verdict', async () => {
    render(<AtTheRoute />)
    const row = await rowFor('jo@example.com')
    expect(row.getByText('Acme Shop · Opted in')).toBeTruthy()
    expect(row.getByText('Globex Clinic · Opted out')).toBeTruthy()
  })

  it('paints no verdict word standing on its own', async () => {
    const { container } = render(<AtTheRoute />)
    await screen.findByText('jo@example.com')
    // Every occurrence of a verdict must be inside a label that also names
    // its controller. A bare chip would match these and fail.
    for (const bare of ['Opted in', 'Opted out', 'No record']) {
      expect(screen.queryByText(bare)).toBeNull()
    }
    expect(container.textContent).toContain('Acme Shop · Opted in')
  })

  it('names the DECLARED GROUP when the sites are one sender', async () => {
    mockOrgDoc = {
      $id: 'org-1',
      plan: 'business',
      consentGroups: {
        'grp-1': { name: 'Acme Family', hostIds: ['host-a', 'host-b'] },
      },
    }
    render(<AtTheRoute />)
    const row = await rowFor('jo@example.com')
    // One controller, so one label repeated — and the refusal on host-b now
    // runs across the group, which is what the reader must be shown.
    expect(row.getAllByText('Acme Family · Opted out').length).toBe(2)
    expect(row.queryByText('Acme Shop · Opted in')).toBeNull()
  })
})

describe('a truncated page says so', () => {
  it('reports the ORGANIZATION total, not the size of the window', async () => {
    mockContactTotal = 4213
    mockHasMore = true
    render(<AtTheRoute />)
    await screen.findByText('jo@example.com')
    await waitFor(() =>
      expect(screen.getByText(/of 4,?213/)).toBeTruthy(),
    )
  })

  it('says the window is a stable walk and not the most recent contacts', async () => {
    mockContactTotal = 4213
    mockHasMore = true
    render(<AtTheRoute />)
    expect(
      await screen.findByText(/not the most recent ones/i),
    ).toBeTruthy()
  })

  it('says nothing of the kind when the whole collection is on screen', async () => {
    mockContactTotal = 1
    mockHasMore = false
    render(<AtTheRoute />)
    await screen.findByText('jo@example.com')
    expect(screen.queryByText(/not the most recent ones/i)).toBeNull()
  })

  it('quotes the org total in the header quota readout', async () => {
    mockContactTotal = 4213
    render(<AtTheRoute />)
    await screen.findByText('jo@example.com')
    const header = screen.getByTestId('header-right')
    await waitFor(() => expect(header.textContent).toMatch(/4,?213/))
  })

  it('does not quote the org total over a FILTERED list', async () => {
    /*
     * The aggregate counts the whole collection, so it describes the list
     * only while the list is the whole list. Under a host filter the footer
     * must fall back to "more than this" rather than print a total that is
     * true about the organization and false about the rows above it.
     */
    mockContactTotal = 4213
    mockHasMore = true
    render(<AtTheRoute />)
    await screen.findByText('jo@example.com')
    await waitFor(() => expect(screen.getByText(/of 4,?213/)).toBeTruthy())

    await pickSite('Acme Shop')

    await waitFor(() => expect(screen.queryByText(/of 4,?213/)).toBeNull())
    // And it still says there is more — the disclosure is not dropped with
    // the number.
    expect(screen.getByText(/more than/i)).toBeTruthy()
  })

  it('builds the filtered read as one array-contains-any query', async () => {
    render(<AtTheRoute />)
    await screen.findByText('jo@example.com')
    await pickSite('Acme Shop')

    await waitFor(() => {
      const filtered = mockBuiltQueries
        .filter((entry): entry is any => entry !== null)
        .find((entry) => Array.isArray(entry.constraints))
      expect(filtered.constraints).toContainEqual({
        field: 'capturedByHostIds',
        op: 'array-contains-any',
        value: ['host-a'],
      })
      // Still the id-ordered walk — the filter narrows the set, it does not
      // change what "in order" means.
      expect(filtered.constraints).toContainEqual({ orderBy: '__name__' })
    })
  })
})

describe('the list read is ordered and paged', () => {
  it('walks on the document id, and asks for one row past the page', async () => {
    render(<AtTheRoute />)
    await screen.findByText('jo@example.com')
    const built = mockBuiltQueries.find((entry) => entry !== null) as any
    expect(built.ordered).toBe('__name__')
    expect(built.limit).toBe(11)
  })

  it('settles, rather than re-rendering forever', async () => {
    /*
     * The listener is rebuilt once per render, so the number of queries built
     * IS the render count. An unstable hook identity underneath this page
     * turns that into an unbounded loop that ends in an out-of-memory abort
     * with no failed assertion — which is indistinguishable from a crashed
     * worker unless something counts.
     */
    render(<AtTheRoute />)
    await screen.findByText('jo@example.com')
    const settled = mockBuiltQueries.length
    expect(settled).toBeLessThan(25)
    await waitFor(() => expect(screen.getByText('Acme Shop')).toBeTruthy())
    // And it STAYS settled — a loop that merely paints first would keep going.
    expect(mockBuiltQueries.length).toBe(settled)
  })

  it('reads the org contacts collection, not a per-host one', async () => {
    render(<AtTheRoute />)
    await screen.findByText('jo@example.com')
    const built = mockBuiltQueries.find((entry) => entry !== null) as any
    expect(built.ref.path).toBe('orgs/org-1/contacts')
  })
})
