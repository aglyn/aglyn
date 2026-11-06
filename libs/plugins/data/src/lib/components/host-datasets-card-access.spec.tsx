/**
 * @jest-environment jsdom
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
 * The Data card switches each control off with the reason named, for the dataset
 * in view (AGL-4047): a dataset on one site answers to that site, one shared
 * beyond it is out of a site-only member's reach to delete, and reading and
 * exporting records take their own keys. Shown, never hidden. A refused member
 * sends no read of the records at all.
 */

import { fireEvent, render, screen } from '@testing-library/react'
import { TransferLauncherContext, type TransferAccessTarget, type TransferAction, type TransferLauncher } from '@aglyn/aglyn'
import { type ReactNode, useMemo, useState } from 'react'
import { registerDataDeclarations } from '../declarations'
import { PageHeaderActionsContext } from '@aglyn/aglyn/app-utils/page-header-actions-context'
import { HostDatasetsCard } from './host-datasets-card.component'

let mockVisibleTo: string[] = ['org']
let mockMember: Record<string, unknown> | null = null
let mockRecordsAsked = 0
let mockCountsAsked = 0
const FIRESTORE = {}
const DATA_SCOPE = { scope: ['orgs', 'org-1'], orgId: 'org-1' }
const mockRecord = [{ $id: 'rec-1', values: { title: 'Row 1' } }]
const mockNoDocs: never[] = []
const mockDatasetLists = new Map<string, unknown[]>()
const mockDatasetsOn = (visibleTo: string[]) => {
  const key = visibleTo.join()
  if (!mockDatasetLists.has(key)) {
    mockDatasetLists.set(key, [
      {
        $id: 'ds-1',
        displayName: 'Products',
        model: { order: ['title'], fields: { title: { name: 'Title', type: 'text' } } },
        visibleTo,
      },
    ])
  }
  return mockDatasetLists.get(key)
}

/**
 * The page header the card publishes Add dataset and Add join collection into
 * (AGL-4047), drawn above the card as the console's layout draws it.
 */
function WithPageHeader(props: { children?: ReactNode }) {
  const [actions, setHeaderActions] = useState<ReactNode>(null)
  const value = useMemo(() => ({ setHeaderActions }), [])
  return (
    <PageHeaderActionsContext.Provider value={value}>
      <div data-testid="page-header">{actions}</div>
      {props.children}
    </PageHeaderActionsContext.Provider>
  )
}

/** The Data page's route (AGL-4047): the card reads the router to open a dataset's tab. */
const mockRouter = { push: jest.fn(), replace: jest.fn(), prefetch: jest.fn() }
jest.mock('next/navigation', () => ({
  useRouter: () => mockRouter,
  usePathname: () => '/acme/data',
  useSearchParams: () => new URLSearchParams(),
}))

jest.mock('@aglyn/tenant-feature-instance', () => ({
  useFirestoreDoc: (build: () => unknown) =>
    build() && mockMember ? { data: mockMember, status: 'success' } : { data: undefined, status: build() ? 'loading' : 'success' },
  useFirestore: () => FIRESTORE,
  useOrgDataScope: () => DATA_SCOPE,
  useScopeTokens: () => ({ tokens: ['org'], orgWide: true, loaded: true }),
  useUser: () => ({ data: { uid: 'uid-test' } }),
  useHostActivityLogger: () => jest.fn(),
  // Stable per placement, like the real hook: a fresh array per render churns the card's effects.
  useFirestoreCollection: (build: () => unknown) => ({
    data: build() === 'datasets' ? mockDatasetsOn(mockVisibleTo) : mockNoDocs,
    status: 'success',
    fromCache: false,
  }),
  usePagedCollection: (build: (pageLimit: number) => unknown) => {
    const asked = build(11) === 'records'
    if (asked) mockRecordsAsked += 1
    return {
      rows: asked ? mockRecord : mockNoDocs,
      hasMore: false,
      page: 0,
      setPage: jest.fn(),
      pageSize: 10,
      setPageSize: jest.fn(),
      status: 'success',
      fromCache: false,
    }
  },
}))

jest.mock('firebase/firestore', () => ({
  ...jest.requireActual('firebase/firestore'),
  collection: (_db: unknown, ...segments: string[]) => segments.join('/'),
  query: (path: string) => path.split('/').pop(),
  limit: (value: number) => value,
  where: () => 'where',
  doc: (_db: unknown, ...segments: string[]) => segments.join('/'),
  getCountFromServer: async (path: string) => {
    if (String(path).endsWith('records')) mockCountsAsked += 1
    return { data: () => ({ count: 1 }) }
  },
  getDocs: jest.fn().mockResolvedValue({ docs: [] }),
  deleteDoc: jest.fn(),
  setDoc: jest.fn(),
  writeBatch: () => ({ set: jest.fn(), update: jest.fn(), commit: jest.fn() }),
}))

jest.mock('@aglyn/shared-ui-snackstack', () => ({ useSnackbar: () => ({ enqueueSnackbar: jest.fn() }) }))
jest.mock('@aglyn/shared-ui-jsx', () => ({
  CardDisplay: ({ children, header, HeaderProps }: any) => (
    <div>
      {header}
      {HeaderProps?.action}
      {HeaderProps?.subheader}
      {children}
    </div>
  ),
  GridItems: ({ items }: any) => (
    <div>
      {items.map((item: any, index: number) => (
        <div key={index}>{item.children}</div>
      ))}
    </div>
  ),
  AppLink: ({ children, href, componentVariant: _variant, ...rest }: any) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
  MdiIcon: () => null,
  useConfirmationContext: () => ({ confirm: jest.fn() }),
}))

const ORG = { $id: 'org-1', plan: 'scale' } as any
const HERE = 'host-h'
const THIS_SITE = [`host:${HERE}`]

const launcher = (): jest.Mocked<TransferLauncher> => ({
  openImport: jest.fn(),
  openExport: jest.fn(),
  close: jest.fn(),
  // Answers as the shell does: this dataset's own answer on importing, and the permissions otherwise.
  can: jest.fn((action: TransferAction, target: TransferAccessTarget) =>
    action === 'import' ? target.importAllowed !== false : mockMember?.['resolvedPermissions'] === undefined || (mockMember['resolvedPermissions'] as Record<string, unknown>)['data.export'] !== false,
  ),
})

const mount = () =>
  render(
    <TransferLauncherContext.Provider value={launcher()}>
      <HostDatasetsCard orgId="org-1" org={ORG} />
    </TransferLauncherContext.Provider>,
    { wrapper: WithPageHeader },
  )

/** The card's own text button; the grid's toolbar carries an icon button named Export too. */
const button = (name: string) =>
  screen.queryAllByRole('button', { name, hidden: true }).find((element) => element.textContent === name) as HTMLButtonElement | undefined
const off = (name: string) => button(name)?.disabled === true

beforeAll(() => registerDataDeclarations())

beforeEach(() => {
  mockVisibleTo = THIS_SITE
  mockMember = null
  mockRecordsAsked = 0
  mockCountsAsked = 0
})

describe('writing, by where the dataset sits', () => {
  it('an editor of the whole workspace has everything on', () => {
    mockMember = { role: 'editor', allHosts: true }
    mount()
    for (const name of ['Add record', 'Schema', 'Import', 'Export', 'Delete', 'Add dataset']) {
      expect(button(name)).toBeDefined()
      expect(off(name)).toBe(false)
    }
  })

  it('an editor narrowed on its one site has its writes off, and may still add a new dataset', () => {
    mockMember = { role: 'editor', allHosts: true, hostAccess: { [HERE]: 'viewer' } }
    mount()
    for (const name of ['Add record', 'Import', 'Delete']) expect(off(name)).toBe(true)
    expect(off('Add dataset')).toBe(false)
  })

  it('that editor still opens Schema for the sharing, which a narrowing leaves: the schema itself is off, with the reason', () => {
    mockMember = { role: 'editor', allHosts: true, hostAccess: { [HERE]: 'viewer' } }
    mount()
    expect(off('Schema')).toBe(false)
    fireEvent.click(button('Schema') as HTMLElement)
    expect(button('Save sharing')).toBeDefined()
    expect(button('Save schema')).toBeUndefined()
    expect(screen.getByText(/Manage this site’s data/)).toBeTruthy()
    // Switched off by the fieldset around them, which is what `:disabled` reads.
    expect(screen.getByLabelText('Plural name').matches(':disabled')).toBe(true)
    expect(button('Add field')?.matches(':disabled')).toBe(true)
  })

  it('that editor has them on where they keep the key, or on a dataset shared wider', () => {
    mockMember = { role: 'editor', allHosts: true, hostAccess: { [HERE]: 'viewer' }, siteNarrowing: { 'data.siteManage': false } }
    const first = mount()
    expect(off('Schema')).toBe(false)
    first.unmount()
    mockVisibleTo = ['org']
    mockMember = { role: 'editor', allHosts: true, hostAccess: { [HERE]: 'viewer' } }
    mount()
    expect(off('Schema')).toBe(false)
  })

  it('a site Editor on the viewer role writes this site’s dataset, and adds no new one', () => {
    mockMember = { role: 'viewer', allHosts: false, hostAccess: { [HERE]: 'editor' } }
    mount()
    for (const name of ['Add record', 'Schema', 'Import', 'Delete']) expect(off(name)).toBe(false)
    expect(off('Add dataset')).toBe(true)
  })

  it('a site Author on the viewer role does not', () => {
    mockMember = { role: 'viewer', allHosts: false, hostAccess: { [HERE]: 'author' } }
    mount()
    for (const name of ['Add record', 'Schema', 'Delete']) expect(off(name)).toBe(true)
  })
})

describe('deleting what the workspace shares', () => {
  it.each([
    ['every site', ['org']],
    ['two sites', [...THIS_SITE, 'host:2']],
  ])('%s: a site-only holder of the key has Delete off, and keeps editing', (_placement, visibleTo) => {
    mockVisibleTo = visibleTo
    mockMember = { role: 'editor', allHosts: false, hostAccess: { [HERE]: 'editor' } }
    mount()
    expect(off('Delete')).toBe(true)
    expect(off('Schema')).toBe(false)
  })
})

describe('reading and exporting', () => {
  it('without "View dataset records" no record is asked for, and the card says which permission', () => {
    mockMember = { role: 'editor', allHosts: true, resolvedPermissions: { 'data.viewRecords': false, 'data.export': false } }
    mount()
    expect(mockRecordsAsked).toBe(0)
    expect(mockCountsAsked).toBe(0)
    expect(screen.getByText(/View dataset records/)).toBeTruthy()
    expect(screen.queryByRole('grid')).toBeNull()
    expect(off('Export')).toBe(true)
  })

  it('without "Export data" the records still show, and Export is shown off', () => {
    mockMember = { role: 'viewer', allHosts: true, resolvedPermissions: { 'data.export': false } }
    mount()
    expect(mockRecordsAsked).toBeGreaterThan(0)
    expect(screen.queryByText(/View dataset records/)).toBeNull()
    expect(off('Export')).toBe(true)
  })

  it('reads as ever for a member nobody refused, stamped or not', () => {
    mockMember = { role: 'viewer', allHosts: true }
    mount()
    expect(mockRecordsAsked).toBeGreaterThan(0)
    expect(off('Export')).toBe(false)
  })
})

describe('until the membership lands', () => {
  it('blocks nothing, and asks the workspace about importing', () => {
    mockMember = null
    mount()
    expect(off('Schema')).toBe(false)
    expect(off('Delete')).toBe(false)
  })
})
