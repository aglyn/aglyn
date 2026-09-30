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
 * Convert from the Leads list's row menu (AGL-2641).
 *
 * Three contracts:
 *
 *  1. THE ROW MENU OFFERS CONVERT… on a lead that can be converted, and it
 *     opens the one conversion dialog for THAT row — the lead's id and its
 *     site, the org and the hub's base path — so the list path is one click
 *     shorter than opening the page first.
 *  2. IT IS DISABLED, WITH THE REASON AS THE TOOLTIP, on a lead that was
 *     converted, one that was unqualified, and one whose person has an
 *     erasure pending — the same three refusals the lead's page makes.
 *  3. AT THE ORGANIZATION LEVEL the dialog is fed the ROW'S site, not the
 *     mounted one (there is none): a lead is its own site's record.
 *
 * The grid is a plain list that renders the actions cell; the row menu is
 * real, the dialog a stub that records what it was opened for.
 *
 * And the search box and filters (AGL-3246, AGL-3321): each is on the list's
 * QUERY — planned for real and answered from the rows below by the
 * list-query double, as Firestore would — so a lead on page two is found,
 * and the footer, the real one, pages what the query returned.
 */

import { CONTACT_ERASURE_REQUESTED_FIELD, crmLeadListFields } from '@aglyn/aglyn'
import { lastListQueryPlan } from '@aglyn/tenant-feature-instance/testing/list-query-double'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import { CrmLeadsSection } from './leads-section'

/** The site's leads, under a site; the merged window, at the org level. */
let siteRows: Array<Record<string, unknown>> = []
let orgRows: Array<Record<string, unknown>> = []
/** `null` under a site; the org hub's mount at the organization level. */
let mount: Record<string, unknown> | null = null
/** Every set of props the convert dialog was opened with. */
const opened: Array<Record<string, unknown>> = []

// The org's lead source list (AGL-3298), read as the starter set.
jest.mock('../hooks/use-lead-source-picklist', () => {
  const { effectiveCrmLeadSourcePicklist } = jest.requireActual('@aglyn/aglyn/app-utils/crm')
  const picklist = effectiveCrmLeadSourcePicklist(null)
  return {
    useLeadSourcePicklist: () => ({ picklist, stored: false, ready: true, fromCache: false }),
  }
})

jest.mock('../hooks/use-crm-org-mount', () => ({
  useCrmOrgMount: () => mount,
}))
jest.mock('../hooks/use-crm-scope', () => ({
  // The real predicates the list query reads; only the scope is staged.
  crmScopeListable: jest.requireActual('../hooks/use-crm-scope').crmScopeListable,
  crmVisibleToClause: jest.requireActual('../hooks/use-crm-scope').crmVisibleToClause,
  useCrmScope: (props: { hostId: string | null }) => ({
    orgId: 'org-1',
    ready: true,
    level: props.hostId ? 'site' : 'org',
    hostId: props.hostId ?? null,
    visibleTo: null,
  }),
}))
// The list's query (AGL-3321), answered from every lead the org holds.
jest.mock('@aglyn/tenant-feature-instance/hooks/use-list-query', () =>
  jest
    .requireActual('@aglyn/tenant-feature-instance/testing/list-query-double')
    .listQueryModule(
      () => [...siteRows, ...orgRows],
      jest.requireActual('@aglyn/tenant-feature-instance/hooks/use-list-query'),
    ),
)
jest.mock('../hooks/use-org-member-options', () => ({
  useOrgMemberOptions: () => ({
    options: [],
    labelFor: () => 'Ada Lovelace',
    emailFor: () => null,
    status: 'success',
  }),
}))
// The saved view names the `all` filter, so every state below is listed.
jest.mock('../hooks/use-crm-saved-view', () => ({
  useCrmSavedView: () => ({
    state: { filters: mockFilters },
    setFilters: (next: Array<{ field: string; op: string; value: string }>) => {
      mockFilters = next
    },
  }),
}))
/** The view's clauses, as the section wrote them last; a re-render reads them back. */
let mockFilters: Array<{ field: string; op: string; value: string }> = [
  { field: 'status', op: 'equals', value: 'all' },
]
jest.mock('../hooks/use-crm-view-grid', () => ({
  useCrmViewGrid: (_views: unknown, columns: Array<{ field: string }>) => ({
    columns,
    columnOrder: columns.map((column) => column.field),
    columnVisibilityModel: {},
    onColumnVisibilityModelChange: jest.fn(),
    sortModel: [],
    onSortModelChange: jest.fn(),
  }),
}))
jest.mock('./crm-views-control', () => ({
  __esModule: true,
  default: () => null,
}))
jest.mock('./lead-surfaces-note', () => ({
  __esModule: true,
  default: () => null,
}))
jest.mock('./org-lead-surfaces-note', () => ({
  __esModule: true,
  default: () => null,
}))
jest.mock('./lead-history-card', () => ({
  leadSources: () => [],
  leadSourceLabel: (source: string) => source,
  leadTimeLabel: () => '',
}))
jest.mock('./lead-unqualify-dialog', () => ({
  LeadUnqualifyDialog: () => null,
}))
/*
 * The New lead drawer (AGL-3231) and the route it posts to: the drawer has
 * a spec of its own, and here it is the thing the button opens.
 */
jest.mock('./new-lead-drawer', () => ({
  __esModule: true,
  default: (props: { open: boolean }) =>
    props.open ? <div role="dialog">{'New lead drawer'}</div> : null,
}))
jest.mock('./use-crm-api', () => ({
  useCrmApi: () => jest.fn(),
}))
jest.mock('./lead-convert-dialog', () => ({
  LeadConvertDialog: (props: Record<string, unknown> & { open: boolean }) => {
    if (!props.open) return null
    opened.push(props)
    return <div role="dialog">{`Convert ${String(props['leadId'])}`}</div>
  },
}))

jest.mock('@aglyn/tenant-feature-instance', () => ({
  // The sharing follow-up (AGL-3336) and the bulk bar's manager check.
  useUser: () => ({ data: null }),
  useFirestoreDoc: () => ({ data: undefined, status: 'success', fromCache: false }),
  useFirestore: () => ({}),
  // The reader's reach: org-wide, so a site's search folds into its scope.
  useScopeTokens: () => ({ tokens: ['org'], orgWide: true, loaded: true }),
  // The org's field definitions and the like: none here.
  useFirestoreCollection: () => ({ data: [], status: 'success', fromCache: false }),
  // The campaigns placed on the site, for the Campaign filter and column
  // (AGL-3254) — and which site, and whether they were asked for at all.
  useSiteContainerOptions: (_kind: string, hostId: string | undefined, options?: { enabled?: boolean }) => {
    if (options?.enabled) mockCampaignReads.push(`site:${hostId}`)
    return {
      options: [
        { value: 'founder-icp1', label: 'Founder · ICP 1' },
        { value: 'founder-icp2', label: 'Founder · ICP 2' },
      ],
      truncated: false,
      ready: true,
    }
  },
  // Every campaign in the org, at the organization level: one more than any
  // one site carries, so an assertion can tell which list it was handed.
  useOrgContainerOptions: (_kind: string, orgId: string | null | undefined, options?: { enabled?: boolean }) => {
    if (options?.enabled) mockCampaignReads.push(`org:${orgId}`)
    return {
      options: [
        { value: 'founder-icp1', label: 'Founder · ICP 1', siteIds: ['site-2'] },
        { value: 'founder-icp2', label: 'Founder · ICP 2', siteIds: ['site-3'] },
        { value: 'org-launch', label: 'Org launch', siteIds: null },
      ],
      truncated: false,
      ready: true,
    }
  },
}))
/** Which campaign list each render enabled: `site:{hostId}` or `org:{orgId}`. */
const mockCampaignReads: string[] = []
/** The columns the grid was last handed, so a column's value can be read. */
let mockColumns: Array<{
  field: string
  valueGetter?: (value: unknown, row: unknown) => unknown
}> = []
/** Every collection path the section asked Firestore for. */
const mockPaths: string[] = []

jest.mock('firebase/firestore', () => ({
  collection: (_db: unknown, ...segments: string[]) => {
    mockPaths.push(segments.join('/'))
    return {}
  },
  where: () => ({}),
  query: () => ({}),
  orderBy: () => ({}),
  limit: () => ({}),
  startAfter: () => ({}),
  documentId: () => '__name__',
  doc: () => ({}),
  updateDoc: jest.fn(),
  deleteField: () => ({ op: 'delete' }),
  serverTimestamp: () => ({ op: 'serverTimestamp' }),
}))
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
  // The menu's Open lead item is a real link, which reads where it is.
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams(),
}))
jest.mock('@aglyn/shared-ui-snackstack', () => ({
  useSnackbar: () => ({ enqueueSnackbar: jest.fn() }),
}))
jest.mock('@aglyn/shared-ui-jsx', () => ({
  // The header's action slot and the footer are kept apart, so where a
  // control lands is something a test can read (AGL-3311).
  CardDisplay: ({
    children,
    actions,
    HeaderProps,
  }: {
    children: ReactNode
    actions?: ReactNode
    HeaderProps?: { action?: ReactNode }
  }) => (
    <div>
      <div data-slot="header-action">{HeaderProps?.action}</div>
      {children}
      {actions ? <div data-slot="footer">{actions}</div> : null}
    </div>
  ),
  MdiIcon: () => null,
}))
jest.mock('@aglyn/shared-ui-jsx/components/empty-state.component', () => ({
  __esModule: true,
  default: ({ label }: { label: string }) => <p>{label}</p>,
}))
/*
 * The grid, as a list: one item per row carrying the ACTIONS cell, which is
 * where the menu under test lives. Everything else about the grid is
 * MUI's.
 */
jest.mock('@aglyn/shared-ui-jsx/components/list-table.component', () => ({
  ListTable: (props: {
    rows: Array<{ $id: string; email: string }>
    columns: Array<{ field: string; renderCell?: (params: { row: unknown }) => ReactNode }>
    noRowsLabel?: string
  }) => {
    const { rows, columns } = props
    mockColumns = columns as typeof mockColumns
    // The filter model the grid was handed, and its change handler (AGL-3313).
    mockGrid = props as unknown as typeof mockGrid
    const actions = columns.find((column) => column.field === 'actions')
    return (
      <ul aria-label="Rows">
        {rows.length === 0 && props.noRowsLabel ? <p>{props.noRowsLabel}</p> : null}
        {rows.map((row) => (
          <li key={row.$id}>
            {row.email}
            {actions?.renderCell?.({ row })}
          </li>
        ))}
      </ul>
    )
  },
}))
/** The props the grid was last rendered with. */
let mockGrid: {
  filterMode?: string
  quickFilter?: boolean
  filterModel: { items: Array<Record<string, unknown>>; quickFilterValues?: unknown[] }
  onFilterModelChange: (model: {
    items: Array<Record<string, unknown>>
    quickFilterValues?: unknown[]
  }) => void
}
/** Types into the grid's quick search, as its toolbar box would. */
const typeSearch = (value: string) =>
  act(() =>
    mockGrid.onFilterModelChange({
      items: mockGrid.filterModel.items,
      quickFilterValues: value.split(' ').filter(Boolean),
    }),
  )
/** Picks a value for a column in the grid's Filters panel. */
const pickFilter = (field: string, value: string) =>
  act(() =>
    mockGrid.onFilterModelChange({
      items: [{ id: 'crm', field, operator: 'is', value }],
      quickFilterValues: mockGrid.filterModel.quickFilterValues,
    }),
  )
/** The choices a select column offers, by label. */
const choices = (field: string) =>
  (
    (mockColumns.find((column) => column.field === field) as unknown as {
      valueOptions?: Array<{ label: string }>
    })?.valueOptions ?? []
  ).map((option) => option.label)
/** The grid's rows, by address — not the filter chips, which are list items too. */
const gridRows = () =>
  within(screen.getByRole('list', { name: 'Rows' }))
    .queryAllByRole('listitem')
    .map((item) => item.textContent)

const BASE_PATH = '/acme/hosts/shop/crm'
const ORG = { $id: 'org-1', plan: 'pro' } as any

/** A lead as its writers store it: its site's scope and the list fields (AGL-3321). */
const lead = (id: string, email: string, fields: Record<string, unknown> = {}) => {
  const row = {
    $id: id,
    email,
    name: email.split('@')[0],
    lastSeenAtMs: 1_000,
    visibleTo: ['host:site-1'],
    ...fields,
  }
  return { ...row, ...crmLeadListFields(row) }
}

const LEADS = [
  lead('l-open', 'maya@example.com'),
  lead('l-converted', 'theo@example.com', {
    status: 'qualified',
    convertedContactId: 'c-theo',
  }),
  lead('l-unqualified', 'june@example.com', {
    status: 'unqualified',
    unqualifiedReason: 'Not a fit',
  }),
  lead('l-erasure', 'sam@example.com', { [CONTACT_ERASURE_REQUESTED_FIELD]: 1_700_000_000_000 }),
]

const renderSite = () =>
  render(
    <CrmLeadsSection hostId="site-1" entitled org={ORG} basePath={BASE_PATH} releaseFlag={{} as any} />,
  )

/** Opens a row's menu and answers its Convert… item. */
async function convertItem(email: string) {
  fireEvent.click(screen.getByRole('button', { name: `More actions for ${email}` }))
  return screen.findByRole('menuitem', { name: 'Convert…' })
}

beforeEach(() => {
  siteRows = LEADS
  orgRows = []
  mount = null
  opened.length = 0
  mockCampaignReads.length = 0
  mockColumns = []
  mockFilters = [{ field: 'status', op: 'equals', value: 'all' }]
})

describe('New lead on the Leads list (AGL-3231)', () => {
  it('opens the drawer from the card header', () => {
    renderSite()
    expect(screen.queryByRole('dialog')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'New lead' }))
    expect(screen.getByRole('dialog').textContent).toBe('New lead drawer')
  })
})

describe('the Leads card layout (AGL-3311, AGL-3313)', () => {
  it('puts Import CSV and New lead in the header, and hands every filter to the grid', () => {
    const { container } = renderSite()
    const header = container.querySelector('[data-slot="header-action"]') as HTMLElement
    expect(within(header).getByRole('button', { name: 'New lead' })).toBeTruthy()
    expect(within(header).getByRole('button', { name: 'Import CSV' })).toBeTruthy()
    // No bespoke dropdowns or search box: the grid's toolbar holds them.
    for (const name of ['Show', 'Email', 'Campaign', 'Lead source']) {
      expect(screen.queryByRole('combobox', { name })).toBeNull()
    }
    expect(screen.queryByRole('searchbox')).toBeNull()
    expect(mockGrid.filterMode).toBe('server')
    expect(mockGrid.quickFilter).toBe(true)
    // Each old dropdown is a select column of the grid's Filters panel.
    for (const field of ['status', 'emailState', 'campaignIds', 'leadSource']) {
      const column = mockColumns.find((entry) => entry.field === field) as unknown as {
        type?: string
        filterable?: boolean
      }
      expect([field, column?.type, column?.filterable]).toEqual([field, 'singleSelect', true])
    }
    expect(container.querySelector('[data-slot="footer"]')).toBeNull()
  })
})

describe('Convert… on the Leads row menu (AGL-2641)', () => {
  it('opens the conversion dialog for the row it was chosen on', async () => {
    renderSite()
    const item = await convertItem('maya@example.com')
    expect(item.getAttribute('aria-disabled')).not.toBe('true')
    fireEvent.click(item)

    expect(screen.getByRole('dialog').textContent).toBe('Convert l-open')
    expect(opened).toHaveLength(1)
    expect(opened[0]).toMatchObject({
      open: true,
      hostId: 'site-1',
      orgId: 'org-1',
      leadId: 'l-open',
      basePath: BASE_PATH,
    })
    expect((opened[0]['lead'] as Record<string, unknown>)['email']).toBe('maya@example.com')
  })

  it.each([
    ['theo@example.com', 'This lead was converted'],
    ['june@example.com', 'This lead was unqualified'],
    ['sam@example.com', 'An erasure is pending for this person'],
  ])('is disabled on %s, with the reason as the tooltip', async (email, reason) => {
    renderSite()
    const item = await convertItem(email)
    expect(item.getAttribute('aria-disabled')).toBe('true')
    // The tooltip anchors on the span around the inert item (Unqualify on a
    // converted lead gives the same reason, so the label is not unique).
    expect(screen.getAllByLabelText(reason).some((span) => span.contains(item))).toBe(true)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('keeps Open lead, Assign owner and Unqualify beside it', async () => {
    renderSite()
    fireEvent.click(screen.getByRole('button', { name: 'More actions for maya@example.com' }))
    const labels = (await screen.findAllByRole('menuitem')).map((item) => item.textContent)
    expect(labels).toEqual(['Open lead', 'Convert…', 'Assign owner', 'Unqualify'])
  })

  it('feeds the dialog the site that CAPTURED the lead, at the organization level', async () => {
    /*
     * The row used to carry a `hostId` — the site its document lived under —
     * and the conversion was filed as that site's capture. AGL-3275 made a
     * lead one org row that a whole consent group can hold, so there is no
     * single site it "lives under" any more; the conversion is filed as the
     * FIRST site that captured the person, off `capturedByHostIds`.
     */
    siteRows = []
    orgRows = [
      { ...lead('l-far', 'far@example.com'), leadId: 'l-far', capturedByHostIds: ['site-2'] },
      { ...lead('l-near', 'near@example.com'), leadId: 'l-near', capturedByHostIds: ['site-3'] },
    ]
    mount = {
      orgId: 'org-1',
      hosts: [
        { id: 'site-2', name: 'Second' },
        { id: 'site-3', name: 'Third' },
      ],
      hostsReady: true,
      orgSlug: 'acme',
      hostsPath: '/acme/hosts',
      createHostId: 'site-2',
      setCreateHostId: jest.fn(),
      siteName: (id: string) => id,
      siteSubdomain: () => null,
      siteHubHref: () => null,
    }
    render(
      <CrmLeadsSection hostId={null} entitled org={ORG} basePath="/acme/crm" releaseFlag={{} as any} />,
    )
    fireEvent.click(await convertItem('near@example.com'))

    expect(opened).toHaveLength(1)
    expect(opened[0]).toMatchObject({
      hostId: 'site-3',
      leadId: 'l-near',
      orgId: 'org-1',
      basePath: '/acme/crm',
    })
  })
})

describe("The grid's search and filters are on the query (AGL-3246, AGL-3313, AGL-3321)", () => {
  // Twelve leads at ten a page: eleven fillers seen more recently, then
  // Morgan, the oldest, on page two.
  const fillers = Array.from({ length: 11 }, (_, index) =>
    lead(`l-${index}`, `person${index}@example.com`, { lastSeenAtMs: 2_000 + index }),
  )
  const morgan = lead('l-morgan', 'morgan@example.com', {
    name: 'Morgan Lamphere',
    company: 'Lamphere Coffee',
    tags: ['sal-15'],
  })

  beforeEach(() => {
    siteRows = [...fillers, morgan]
  })

  it('finds a lead on page two by a word the query asks for', () => {
    renderSite()
    expect(screen.queryByText('morgan@example.com')).toBeNull()
    expect(screen.getByText('1–10 of more than 10')).toBeTruthy()

    typeSearch('Lamphere')
    expect(gridRows()).toEqual(['morgan@example.com'])
    expect(screen.getByText('1–1 of 1')).toBeTruthy()
    // Folded into the site's scope clause: one array clause answers both.
    expect(lastListQueryPlan()?.filters).toEqual([
      expect.objectContaining({ path: 'status' }),
      {
        path: 'scopedSearchTokens',
        op: 'array-contains-any',
        value: ['org~lamphere', 'host:site-1~lamphere'],
      },
    ].slice(1))

    typeSearch('')
    expect(gridRows()).toHaveLength(10)
    expect(screen.getByText('1–10 of more than 10')).toBeTruthy()
  })

  it('pages through what the query answered', () => {
    // A new query starting on page one is the pager's (`usePagedCollection`
    // restarts on a new plan); this is the page the query's answer turns to.
    renderSite()
    fireEvent.click(screen.getByRole('button', { name: 'Go to next page' }))
    expect(gridRows()).toEqual(['person0@example.com', 'morgan@example.com'])
    expect(screen.getByText('11–12 of 12')).toBeTruthy()
  })

  it('searches the first of two words, and says so', () => {
    renderSite()
    typeSearch('lamphere coffee')
    expect(gridRows()).toEqual(['morgan@example.com'])
    expect(screen.getByText(/Search matches one word at a time/)).toBeTruthy()
  })

  it('matches a tag, whatever the case, and says so when nothing matches', () => {
    renderSite()
    typeSearch('SAL-15')
    expect(gridRows()).toEqual(['morgan@example.com'])

    typeSearch('nobody')
    expect(gridRows()).toHaveLength(0)
    expect(screen.getByText('No leads match these filters')).toBeTruthy()
  })

  /**
   * Email (AGL-3245): a bounced lead is found by its verdict, beside the
   * status and the search, from the grid's Filters panel.
   */
  it('narrows to the leads whose address bounced', () => {
    siteRows = [
      ...fillers,
      lead('l-bounced', 'bounced@example.com', {
        emailState: { status: 'bounced', atMs: 1_000, source: 'sequence', detail: '550 5.1.1 no such user' },
      }),
    ]
    const { rerender } = renderSite()
    expect(choices('emailState')).toContain('Bounced')
    pickFilter('emailState', 'bounced')
    // The clause is the saved view's, in the shape the old dropdown stored,
    // and the status clause stays beside it.
    expect(mockFilters).toEqual([
      { field: 'emailState', op: 'equals', value: 'bounced' },
      { field: 'status', op: 'equals', value: 'all' },
    ])
    rerender(
      <CrmLeadsSection hostId="site-1" entitled org={ORG} basePath={BASE_PATH} releaseFlag={{} as any} />,
    )
    expect(gridRows()).toEqual(['bounced@example.com'])
    expect(screen.getByText('1–1 of 1')).toBeTruthy()
    // The chip names the clause, and removes it.
    const chip = screen.getByText('Email is Bounced').closest('[role="listitem"]') as HTMLElement
    fireEvent.click(within(chip).getByTestId('CancelIcon'))
    expect(mockFilters).toEqual([{ field: 'status', op: 'equals', value: 'all' }])
  })

  /**
   * Campaign (AGL-3254): the site's containers by name, the id in the
   * saved view as the old dropdown stored it, and only the leads filed
   * under it listed.
   */
  it('narrows to the leads filed under a campaign, by name', () => {
    siteRows = [
      ...fillers,
      lead('l-icp2', 'icp2@example.com', { campaignIds: ['founder-icp2'] }),
      lead('l-both', 'both@example.com', { campaignIds: ['founder-icp1', 'founder-icp2'] }),
    ]
    const { rerender } = renderSite()
    expect(choices('campaignIds')).toContain('Founder · ICP 2')
    pickFilter('campaignIds', 'founder-icp2')
    expect(mockFilters).toEqual([
      { field: 'campaignIds', op: 'contains', value: 'founder-icp2' },
      { field: 'status', op: 'equals', value: 'all' },
    ])
    rerender(
      <CrmLeadsSection hostId="site-1" entitled org={ORG} basePath={BASE_PATH} releaseFlag={{} as any} />,
    )
    expect(gridRows()).toEqual(['icp2@example.com', 'both@example.com'])
    expect(screen.getByText('1–2 of 2')).toBeTruthy()
    // Under a site the scope clause is the one array clause, so the campaign
    // is asked behind the site's scope tokens and stands in its place.
    expect(lastListQueryPlan()?.filters).toEqual([
      {
        path: 'scopedCampaignIds',
        op: 'array-contains-any',
        value: ['org~founder-icp2', 'host:site-1~founder-icp2'],
      },
    ])
  })
})

/**
 * SAVED VIEWS MADE WITH THE OLD DROPDOWNS (AGL-3313).
 *
 * A view stored before the dropdowns became grid columns holds clauses in
 * their shape. It must filter exactly as it did, and show in the panel.
 */
describe('a view saved with the old dropdowns', () => {
  const apollo = lead('l-apollo', 'apollo@example.com', { leadSource: 'Outbound · Apollo' })
  const none = lead('l-none', 'none@example.com')
  const worked = lead('l-worked', 'worked@example.com', {
    leadSource: 'Outbound · Apollo',
    status: 'qualified',
  })

  it('reads "no status clause" as Open, and a lead source clause as the panel\'s select', () => {
    siteRows = [apollo, none, worked]
    mockFilters = [{ field: 'leadSource', op: 'equals', value: 'Outbound · Apollo' }]
    renderSite()
    // Open, so the qualified lead is out; Apollo, so the bare one is out.
    expect(gridRows()).toEqual(['apollo@example.com'])
    expect(mockGrid.filterModel.items).toEqual([
      { id: 'list', field: 'leadSource', operator: 'is', value: 'Outbound · Apollo' },
    ])
    expect(screen.getByText('Status is Open (new or working)')).toBeTruthy()
  })

  it('keeps "No lead source" as the isEmpty clause it stored', () => {
    siteRows = [apollo, none]
    mockFilters = [
      { field: 'status', op: 'equals', value: 'all' },
      { field: 'leadSource', op: 'isEmpty', value: '' },
    ]
    renderSite()
    expect(gridRows()).toEqual(['none@example.com'])
    pickFilter('leadSource', 'Outbound · Apollo')
    expect(mockFilters).toEqual([
      { field: 'leadSource', op: 'equals', value: 'Outbound · Apollo' },
      { field: 'status', op: 'equals', value: 'all' },
    ])
  })
})

/**
 * WHICH COLLECTION THE LIST READS (AGL-3275).
 *
 * Asserted because it was not: the section's site branch kept reading
 * `hosts/{hostId}/leads` after the silo moved, and every test here still
 * passed — the `useFirestoreCollection` double never ran the factory, so no
 * assertion could reach the path. On production that shows a site its
 * pre-migration rows and nothing captured since, then nothing at all once the
 * backfill empties the path.
 */
describe('the collection the section reads', () => {
  beforeEach(() => {
    mockPaths.length = 0
  })

  it('reads the ORG collection under a site, narrowed to that site', () => {
    renderSite()
    expect(mockPaths).toContain('orgs/org-1/leads')
    expect(mockPaths.some((path) => path.startsWith('hosts/'))).toBe(false)
    expect(lastListQueryPlan()?.filters).toContainEqual({
      path: 'visibleTo',
      op: 'array-contains-any',
      value: ['org', 'host:site-1'],
    })
    // Newest seen first, the one order every lead carries.
    expect(lastListQueryPlan()?.orderBy).toEqual({ path: 'lastSeenAtMs', direction: 'desc' })
  })

  it('asks Open of the query as the two open statuses every lead stores', () => {
    mockFilters = []
    siteRows = [lead('l-fresh', 'fresh@example.com'), ...LEADS.slice(1)]
    renderSite()
    expect(lastListQueryPlan()?.filters).toContainEqual({
      path: 'status',
      op: 'in',
      value: ['new', 'working'],
    })
    expect(gridRows()).toEqual(['fresh@example.com', 'sam@example.com'])
  })
})

/**
 * CAMPAIGNS AT THE ORGANIZATION LEVEL.
 *
 * A lead is an org row and a campaign is an org container, so the org's
 * Leads page names and filters by campaign exactly as a site's does — from
 * every campaign in the org rather than the ones one site carries.
 */
describe('the Campaign column and filter at the organization level', () => {
  const orgMount = () => ({
    orgId: 'org-1',
    hosts: [
      { id: 'site-2', name: 'Second' },
      { id: 'site-3', name: 'Third' },
    ],
    hostsReady: true,
    orgSlug: 'acme',
    hostsPath: '/acme/hosts',
    createHostId: 'site-2',
    setCreateHostId: jest.fn(),
    siteName: (id: string) => id,
    siteSubdomain: () => null,
    siteHubHref: () => null,
  })
  const renderOrg = () =>
    render(
      <CrmLeadsSection hostId={null} entitled org={ORG} basePath="/acme/crm" releaseFlag={{} as any} />,
    )

  it("reads the org's campaigns, not a site's", () => {
    mount = orgMount()
    orgRows = [{ ...lead('l-a', 'a@example.com'), leadId: 'l-a' }]
    renderOrg()
    expect(mockCampaignReads).toContain('org:org-1')
    expect(mockCampaignReads.some((read) => read.startsWith('site:'))).toBe(false)
  })

  it('names the campaigns each lead is filed under, whichever site placed them', () => {
    mount = orgMount()
    const filed = {
      ...lead('l-a', 'a@example.com', { campaignIds: ['founder-icp1', 'org-launch'] }),
      leadId: 'l-a',
    }
    orgRows = [filed]
    renderOrg()
    const column = mockColumns.find((entry) => entry.field === 'campaignIds')
    expect(column).toBeTruthy()
    expect(column?.valueGetter?.(undefined, filed)).toBe('Founder · ICP 1, Org launch')
  })

  it('filters by any campaign in the org', () => {
    mount = orgMount()
    orgRows = [
      { ...lead('l-a', 'a@example.com', { campaignIds: ['org-launch'] }), leadId: 'l-a' },
      { ...lead('l-b', 'b@example.com'), leadId: 'l-b' },
    ]
    const { rerender } = renderOrg()
    expect(choices('campaignIds')).toContain('Org launch')
    pickFilter('campaignIds', 'org-launch')
    expect(mockFilters).toEqual([
      { field: 'campaignIds', op: 'contains', value: 'org-launch' },
      { field: 'status', op: 'equals', value: 'all' },
    ])
    rerender(
      <CrmLeadsSection hostId={null} entitled org={ORG} basePath="/acme/crm" releaseFlag={{} as any} />,
    )
    expect(gridRows()).toEqual(['a@example.com'])
  })
})
