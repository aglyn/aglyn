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
 * And a fourth (AGL-2790): ON A PLAN WITHOUT THE CRM SUITE the section is
 * read-only. The row menu offers Open lead alone, a row's status is a chip
 * with no select behind it, there is no import, and the suite's notice says
 * why with the way to the plans — while the same rows on a plan with the
 * suite keep every act.
 *
 * The grid is a plain list that renders the status and actions cells; the
 * row menu is real, the dialog a stub that records what it was opened for.
 */

import { CONTACT_ERASURE_REQUESTED_FIELD } from '@aglyn/aglyn'
import { fireEvent, render, screen, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import { CrmLeadsSection } from './leads-section'

/** The site's leads, under a site; the merged window, at the org level. */
let siteRows: Array<Record<string, unknown>> = []
let orgRows: Array<Record<string, unknown>> = []
/** `null` under a site; the org hub's mount at the organization level. */
let mount: Record<string, unknown> | null = null
/** Every set of props the convert dialog was opened with. */
const opened: Array<Record<string, unknown>> = []

jest.mock('../hooks/use-crm-org-mount', () => ({
  useCrmOrgMount: () => mount,
}))
jest.mock('../hooks/use-crm-scope', () => ({
  useCrmScope: (props: { hostId: string | null }) => ({
    orgId: 'org-1',
    ready: true,
    level: props.hostId ? 'site' : 'org',
    hostId: props.hostId ?? null,
    visibleTo: null,
  }),
}))
jest.mock('../hooks/use-org-leads', () => ({
  useOrgLeads: () => ({ data: orgRows, status: 'success', truncated: false }),
}))
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
    state: { filters: [{ field: 'status', op: 'equals', value: 'all' }] },
    setFilters: jest.fn(),
  }),
}))
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
// The import drawer opens reads of its own; here it is the button that is or is not drawn.
jest.mock('./lead-import-drawer', () => ({
  LeadImportButton: () => <button type="button">{'Import CSV'}</button>,
}))
jest.mock('./lead-unqualify-dialog', () => ({
  LeadUnqualifyDialog: () => null,
}))
jest.mock('./lead-convert-dialog', () => ({
  LeadConvertDialog: (props: Record<string, unknown> & { open: boolean }) => {
    if (!props.open) return null
    opened.push(props)
    return <div role="dialog">{`Convert ${String(props['leadId'])}`}</div>
  },
}))

jest.mock('@aglyn/tenant-feature-instance', () => ({
  useFirestore: () => ({}),
  useFirestoreCollection: () => ({ data: siteRows, status: 'success', fromCache: false }),
}))
jest.mock('firebase/firestore', () => ({
  collection: () => ({}),
  query: () => ({}),
  orderBy: () => ({}),
  limit: () => ({}),
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
  // The suite notice links to the org's plans, which it reads off the route.
  useParams: () => ({ orgSlug: 'acme' }),
}))
jest.mock('@aglyn/shared-ui-snackstack', () => ({
  useSnackbar: () => ({ enqueueSnackbar: jest.fn() }),
}))
jest.mock('@aglyn/shared-ui-jsx', () => ({
  CardDisplay: ({ children, actions }: { children: ReactNode; actions?: ReactNode }) => (
    <div>
      {actions}
      {children}
    </div>
  ),
  MdiIcon: () => null,
  AppLink: ({ children, href }: { children: ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}))
jest.mock('@aglyn/shared-ui-jsx/components/list-pagination.component', () => ({
  ListPagination: () => null,
}))
jest.mock('@aglyn/shared-ui-jsx/components/empty-state.component', () => ({
  __esModule: true,
  default: ({ label }: { label: string }) => <p>{label}</p>,
}))
/*
 * The grid, as a list: one item per row carrying the STATUS and ACTIONS
 * cells, which is where what is under test lives. Everything else about the
 * grid is MUI's.
 */
jest.mock('@aglyn/shared-ui-jsx/components/list-table.component', () => ({
  ListTable: ({
    rows,
    columns,
  }: {
    rows: Array<{ $id: string; email: string }>
    columns: Array<{ field: string; renderCell?: (params: { row: unknown }) => ReactNode }>
  }) => {
    const cell = (field: string) => columns.find((column) => column.field === field)
    return (
      <ul>
        {rows.map((row) => (
          <li key={row.$id}>
            {row.email}
            <span data-testid={`status-${row.$id}`}>{cell('status')?.renderCell?.({ row })}</span>
            {cell('actions')?.renderCell?.({ row })}
          </li>
        ))}
      </ul>
    )
  },
}))

const BASE_PATH = '/acme/hosts/shop/crm'
const ORG = { $id: 'org-1', plan: 'pro' } as any
const FREE_ORG = { $id: 'org-1', plan: 'free' } as any

const lead = (id: string, email: string, fields: Record<string, unknown> = {}) => ({
  $id: id,
  email,
  name: email.split('@')[0],
  lastSeenAtMs: 1_000,
  ...fields,
})

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

const renderSite = (org = ORG) =>
  render(
    <CrmLeadsSection hostId="site-1" entitled org={org} basePath={BASE_PATH} releaseFlag={{} as any} />,
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

  it('feeds the dialog the ROW’S site at the organization level', async () => {
    siteRows = []
    orgRows = [
      { ...lead('site-2/l-far', 'far@example.com'), leadId: 'l-far', hostId: 'site-2' },
      { ...lead('site-3/l-near', 'near@example.com'), leadId: 'l-near', hostId: 'site-3' },
    ]
    mount = {
      orgId: 'org-1',
      hosts: [
        { id: 'site-2', name: 'Second' },
        { id: 'site-3', name: 'Third' },
      ],
      hostsReady: true,
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

describe('the Leads section on a plan without the CRM suite (AGL-2790)', () => {
  it('offers Open lead alone on the row menu', async () => {
    renderSite(FREE_ORG)
    fireEvent.click(screen.getByRole('button', { name: 'More actions for maya@example.com' }))
    const labels = (await screen.findAllByRole('menuitem')).map((item) => item.textContent)
    expect(labels).toEqual(['Open lead'])
  })

  it('draws each status as a chip, with no select to change it', () => {
    renderSite(FREE_ORG)
    for (const id of ['l-open', 'l-unqualified', 'l-erasure']) {
      expect(within(screen.getByTestId(`status-${id}`)).queryByRole('combobox')).toBeNull()
    }
  })

  it('offers no import, keeps the export, and says why under the notice with the way to the plans', () => {
    renderSite(FREE_ORG)
    expect(screen.queryByRole('button', { name: 'Import CSV' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Export CSV' })).toBeTruthy()
    const notice = screen.getByRole('alert')
    expect(notice.textContent).toContain('Leads are read-only on your plan.')
    expect(notice.textContent).toContain('part of the CRM suite. Included from Starter.')
    expect(
      within(notice).getByRole('link', { name: 'View plans' }).getAttribute('href'),
    ).toMatch(/^\/acme\/billing/)
  })

  it('CONTROL: with the suite the same rows carry a status select and the import, and no notice', () => {
    renderSite()
    expect(within(screen.getByTestId('status-l-open')).getByRole('combobox')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Import CSV' })).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()
  })
})
