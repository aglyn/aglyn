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
 * The Data page is a rail of datasets (AGL-4047): one tab per dataset at its
 * own address, a second line that tells two of one name apart, a search over
 * the names, groups and a Shared with filter once there are many, a window
 * that reaches every dataset, and a site page that refuses a link to a
 * dataset the site does not see.
 *
 * The stand-in applies the constraints the card really builds to the
 * documents, the way Firestore would. NO PRODUCTION DATA IS READ.
 */

import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { PageHeaderActionsContext } from '@aglyn/aglyn/app-utils/page-header-actions-context'
import { type ReactNode, useMemo, useState } from 'react'
import { HostDatasetsCard } from './host-datasets-card.component'

const field = (name: string) => ({ name, type: 'text' })
const SERVICES = { order: ['name', 'duration'], fields: { name: field('Name'), duration: field('Duration') } }
const ONE = { order: ['name'], fields: { name: field('Name') } }

const BAKERY_SERVICES = { $id: 'ds-bakery', displayName: 'Services', model: SERVICES, visibleTo: ['host:bakery'] }
const DOWNTOWN_SERVICES = { $id: 'ds-downtown', displayName: 'Services', model: ONE, visibleTo: ['host:downtown'] }
const PRODUCTS = {
  $id: 'ds-products',
  displayName: 'Products',
  model: ONE,
  visibleTo: ['org'],
  source: { listingId: 'listing-1', version: 3 },
  createdAt: { toDate: () => new Date(2026, 9, 2) },
}
const SITES = [
  { $id: 'bakery', name: 'Bakery', orgId: 'org-1' },
  { $id: 'downtown', name: 'Downtown', orgId: 'org-1' },
]

let datasets: Array<Record<string, any>>
let viewer: { tokens: string[]; orgWide: boolean; loaded: boolean }
/** Every query the card built over the datasets collection, in order. */
let datasetQueries: Array<Array<Record<string, any>>>
const answers = new Map<string, any[]>()
const docAnswers = new Map<string, any>()
const NO_RECORDS = {
  rows: [],
  hasMore: false,
  page: 0,
  setPage: () => undefined,
  pageSize: 10,
  setPageSize: () => undefined,
  status: 'success',
  fromCache: false,
}
const SITE_ANSWER = { data: [] as unknown[], status: 'success', fromCache: false }
const EMPTY_ANSWER = { data: [] as unknown[], status: 'success', fromCache: false }
const FIRESTORE = {}
/** An owner across every site, holding the data keys as the server stamps them. */
const OWNER = {
  role: 'owner',
  allHosts: true,
  resolvedPermissions: { 'data.manage': true, 'data.viewRecords': true, 'data.export': true },
}
/** What the records table's query was built as, each render; `null` when it reads none. */
let pagedBuilt: unknown[] = []
let pagedAnswer: Record<string, unknown> = NO_RECORDS
/** A dataset's records, by `datasetId/recordId`, for a record's own read. */
let storedRecords: Record<string, Record<string, unknown>> = {}
const USER = { data: { uid: 'uid-test' } }
const DATA_SCOPE = { scope: ['orgs', 'org-1'], orgId: 'org-1' }
const LOADING = { data: undefined, status: 'loading', fromCache: true }

/** The documents a built query matches, in document-id order, as far as its limit. */
const matching = (constraints: Array<Record<string, any>>) => {
  const clause = constraints.find((one) => one['field'] === 'visibleTo')
  const cap = constraints.find((one) => 'limit' in one)?.['limit'] ?? Infinity
  return datasets
    .filter((row) => !clause || (row['visibleTo'] ?? []).some((token: string) => clause['value'].includes(token)))
    .sort((a, b) => a['$id'].localeCompare(b['$id']))
    .slice(0, cap)
}

jest.mock('@aglyn/tenant-feature-instance', () => ({
  useFirestore: () => FIRESTORE,
  // Stable per document, like the real listener's answer.
  useFirestoreDoc: (build: () => { path: string } | null) => {
    const ref = build()
    if (!ref) return LOADING
    if (!docAnswers.has(ref.path)) {
      if (ref.path.includes('/records/')) {
        const [datasetId, , recordId] = ref.path.split('/').slice(-3)
        const row = storedRecords[`${datasetId}/${recordId}`]
        docAnswers.set(ref.path, { data: row, status: 'success', fromCache: false })
      } else if (ref.path.includes('/datasets/')) {
        const id = ref.path.split('/').at(-1)
        const row = datasets.find((one) => one['$id'] === id)
        const { $id: _id, ...data } = row ?? {}
        docAnswers.set(ref.path, { data: row ? data : undefined, status: 'success', fromCache: false })
      } else {
        docAnswers.set(ref.path, { data: OWNER, status: 'success', fromCache: false })
      }
    }
    return docAnswers.get(ref.path)
  },
  useOrgDataScope: () => DATA_SCOPE,
  useScopeTokens: () => viewer,
  useUser: () => USER,
  useHostActivityLogger: () => jest.fn(),
  useFirestoreCollection: (build: () => any) => {
    const built = build()
    if (String(built?.path ?? '') === 'hosts') return { ...SITE_ANSWER, data: SITES }
    if (!String(built?.path ?? '').endsWith('/datasets')) return EMPTY_ANSWER
    const key = JSON.stringify(built.constraints)
    if (!answers.has(key)) {
      datasetQueries.push(built.constraints)
      answers.set(key, matching(built.constraints))
    }
    return { data: answers.get(key), status: 'success', fromCache: false }
  },
  usePagedCollection: (build: (limit: number) => unknown) => {
    pagedBuilt.push(build(11))
    return pagedAnswer
  },
}))

jest.mock('firebase/firestore', () => ({
  collection: (_db: unknown, ...segments: string[]) => segments.join('/'),
  query: (path: string, ...constraints: unknown[]) => ({ path, constraints }),
  where: (field: string, op: string, value: unknown) => ({ field, op, value }),
  limit: (value: number) => ({ limit: value }),
  orderBy: (field: unknown) => ({ orderBy: field }),
  documentId: () => '__name__',
  startAt: (value: unknown) => ({ startAt: value }),
  endAt: (value: unknown) => ({ endAt: value }),
  doc: (_db: unknown, ...segments: string[]) => ({ path: segments.join('/') }),
  deleteField: () => undefined,
  getCountFromServer: async () => ({ data: () => ({ count: 8 }) }),
  getDoc: async () => ({ exists: () => false }),
  getDocs: async () => ({ docs: [] }),
  deleteDoc: jest.fn(),
  setDoc: jest.fn(),
  writeBatch: () => ({ set: jest.fn(), update: jest.fn(), commit: jest.fn() }),
}))

jest.mock('@aglyn/shared-util-http/authorized-token', () => ({ authorizedFetch: jest.fn() }))
jest.mock('@aglyn/shared-ui-snackstack', () => ({ useSnackbar: () => ({ enqueueSnackbar: jest.fn() }) }))
jest.mock('@aglyn/shared-ui-jsx', () => ({
  CardDisplay: ({ children, header, HeaderProps }: any) => (
    <div>
      {header ? <h2>{header}</h2> : null}
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

const mockRouter = { push: jest.fn(), replace: jest.fn(), prefetch: jest.fn() }
let mockPathname = '/acme/data'
jest.mock('next/navigation', () => ({
  useRouter: () => mockRouter,
  usePathname: () => mockPathname,
  useSearchParams: () => new URLSearchParams(),
}))

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

const ORG_WIDE = { tokens: ['org'], orgWide: true, loaded: true }
const ORG = { $id: 'org-1', plan: 'scale' } as any

beforeEach(() => {
  jest.clearAllMocks()
  answers.clear()
  docAnswers.clear()
  datasetQueries = []
  pagedBuilt = []
  pagedAnswer = NO_RECORDS
  storedRecords = { 'ds-bakery/r1': { values: { name: 'Custom cakes', duration: '45 min' } } }
  datasets = [BAKERY_SERVICES, DOWNTOWN_SERVICES, PRODUCTS]
  viewer = ORG_WIDE
  mockPathname = '/acme/data'
})

const mount = async (props: Record<string, unknown> = {}) => {
  const basePath = (props['basePath'] as string | undefined) ?? '/acme/data'
  const segments = (props['segments'] as string[] | undefined) ?? []
  mockPathname = segments.length ? `${basePath}/${segments.join('/')}` : basePath
  const result = render(<HostDatasetsCard orgId="org-1" org={ORG} basePath={basePath} {...props} />, {
    wrapper: WithPageHeader,
  })
  await act(async () => {
    await Promise.resolve()
  })
  return result
}

const tabs = () => within(screen.getByRole('tablist', { name: 'Datasets' })).queryAllByRole('tab')
/** Each tab as `name | second line`. */
const rail = () =>
  tabs().map((tab) => {
    const label = tab.firstElementChild as HTMLElement
    return `${label.firstChild?.textContent ?? ''} | ${label.lastElementChild?.textContent ?? ''}`
  })
/** The open dataset's heading: the panel's, not the rail card's own "Datasets". */
const heading = () =>
  screen
    .queryAllByRole('heading', { level: 2 })
    .map((one) => one.textContent)
    .find((text) => text !== 'Datasets')

describe('one tab per dataset, at its own address', () => {
  it('tells two of one name apart by who they are shared with and how many fields they have', async () => {
    await mount({ segments: ['ds-bakery'] })
    expect(rail()).toEqual([
      'Products | All sites · 1 field',
      'Services | Bakery only · 2 fields',
      'Services | Downtown only · 1 field',
    ])
    expect(tabs().map((tab) => tab.getAttribute('href'))).toEqual([
      '/acme/data/ds-products',
      '/acme/data/ds-bakery',
      '/acme/data/ds-downtown',
    ])
    // The open tab is lit, as the Settings rail lights its section.
    expect(tabs()[1]?.getAttribute('aria-selected')).toBe('true')
  })

  it('opens the dataset the address names, with its facts and today’s actions', async () => {
    await mount({ segments: ['ds-products'] })
    expect(heading()).toBe('Products')
    for (const fact of ['Shared with', 'All sites', 'Fields', 'Records', 'Source', 'Marketplace, version 3', 'Created', 'Oct 2, 2026']) {
      expect(screen.getAllByText(fact).length).toBeGreaterThan(0)
    }
    for (const action of ['Add record', 'Schema', 'Delete']) {
      expect(screen.getByRole('button', { name: action })).toBeTruthy()
    }
    // Add dataset and Add join collection are the page's, in its header.
    const header = within(screen.getByTestId('page-header'))
    expect(header.getByRole('button', { name: 'Add dataset' })).toBeTruthy()
    expect(header.getByRole('button', { name: 'Add join collection' })).toBeTruthy()
  })

  it('moves the bare page to the first dataset, so a tab is always lit', async () => {
    await mount()
    expect(mockRouter.replace).toHaveBeenCalledWith('/acme/data/ds-products')
  })

  it('says a dataset that does not exist cannot be opened', async () => {
    await mount({ segments: ['ds-gone'] })
    expect(screen.getByText('This dataset doesn’t exist, or you can’t open it.')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Schema' })).toBeNull()
  })
})

describe('the search', () => {
  it('narrows the rail to the names that start with what was typed', async () => {
    await mount({ segments: ['ds-bakery'] })
    fireEvent.change(screen.getByRole('textbox', { name: 'Search datasets by name' }), { target: { value: ' SERV' } })
    expect(rail().map((one) => one.split(' | ')[0])).toEqual(['Services', 'Services'])
    fireEvent.change(screen.getByRole('textbox', { name: 'Search datasets by name' }), { target: { value: 'vices' } })
    expect(tabs()).toHaveLength(0)
    expect(screen.getByText('No datasets match.')).toBeTruthy()
    // The open dataset stays open; the search only narrows the rail.
    expect(heading()).toBe('Services')
  })

  it('asks no new query of Firestore while the names are matched among the loaded ones', async () => {
    await mount({ segments: ['ds-bakery'] })
    const before = datasetQueries.length
    fireEvent.change(screen.getByRole('textbox', { name: 'Search datasets by name' }), { target: { value: 'pro' } })
    expect(datasetQueries.length).toBe(before)
  })
})

describe('many datasets', () => {
  const many = () => [
    ...Array.from({ length: 6 }, (_, at) => ({ $id: `b-${at}`, displayName: `Bakery list ${at}`, model: ONE, visibleTo: ['host:bakery'] })),
    ...Array.from({ length: 5 }, (_, at) => ({ $id: `d-${at}`, displayName: `Downtown list ${at}`, model: SERVICES, visibleTo: ['host:downtown'] })),
  ]

  it('groups the rail by who each dataset is shared with, and names the first fields instead', async () => {
    datasets = many()
    const { container } = await mount({ segments: ['b-0'] })
    expect(
      Array.from(container.querySelectorAll<HTMLElement>('[data-hub-section-group]')).map((group) => group.dataset['hubSectionGroup']),
    ).toEqual(['Bakery only (6)', 'Downtown only (5)'])
    expect(rail()[6]).toBe('Downtown list 0 | 2 fields · Name, Duration')
  })

  it('offers the Shared with filter on the workspace page, as a query clause for the site picked', async () => {
    datasets = many()
    await mount({ segments: ['b-0'] })
    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Shared with' }))
    fireEvent.click(screen.getByRole('option', { name: 'Downtown' }))
    expect(datasetQueries.at(-1)).toEqual([
      { field: 'visibleTo', op: 'array-contains-any', value: ['org', 'host:downtown'] },
      { orderBy: '__name__' },
      { limit: 101 },
    ])
    expect(rail().map((one) => one.split(' | ')[0])).toEqual(Array.from({ length: 5 }, (_, at) => `Downtown list ${at}`))
  })

  it('offers no Shared with filter on a site page, which lists that site’s already', async () => {
    datasets = many()
    await mount({ hostId: 'bakery', orgId: undefined, basePath: '/acme/hosts/bakery/data', segments: ['b-0'] })
    expect(screen.queryByRole('combobox', { name: 'Shared with' })).toBeNull()
  })

  it('reaches every dataset past the first hundred', async () => {
    datasets = Array.from({ length: 150 }, (_, at) => ({
      $id: `ds-${String(at).padStart(3, '0')}`,
      displayName: `List ${at}`,
      model: ONE,
      visibleTo: ['org'],
    }))
    await mount({ segments: ['ds-000'] })
    expect(tabs()).toHaveLength(100)
    fireEvent.click(screen.getByRole('button', { name: 'Show more datasets' }))
    expect(datasetQueries.at(-1)).toContainEqual({ limit: 201 })
    expect(tabs()).toHaveLength(150)
    expect(screen.queryByRole('button', { name: 'Show more datasets' })).toBeNull()
  })

  it('opens a dataset past the loaded window by its own read', async () => {
    datasets = Array.from({ length: 150 }, (_, at) => ({
      $id: `ds-${String(at).padStart(3, '0')}`,
      displayName: `List ${at}`,
      model: ONE,
      visibleTo: ['org'],
    }))
    await mount({ segments: ['ds-140'] })
    expect(heading()).toBe('List 140')
  })
})

describe('a site page shows what the site sees', () => {
  it('refuses a link to a dataset the site does not see, and offers none of its actions', async () => {
    await mount({ hostId: 'bakery', orgId: undefined, basePath: '/acme/hosts/bakery/data', segments: ['ds-downtown'] })
    expect(screen.getByText('This dataset isn’t shared with this site.')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Schema' })).toBeNull()
    expect(rail().map((one) => one.split(' | ')[0])).toEqual(['Products', 'Services'])
  })

  it('THE CONTROL: opens one it does see', async () => {
    await mount({ hostId: 'bakery', orgId: undefined, basePath: '/acme/hosts/bakery/data', segments: ['ds-bakery'] })
    expect(heading()).toBe('Services')
    expect(screen.queryByText('This dataset isn’t shared with this site.')).toBeNull()
  })
})

describe('a record opens on its own page (AGL-4047)', () => {
  it('shows the record beneath its dataset: a way back, its fields and today’s record actions', async () => {
    await mount({ segments: ['ds-bakery', 'records', 'r1'] })
    expect(screen.getByRole('link', { name: 'Services' }).getAttribute('href')).toBe('/acme/data/ds-bakery')
    expect(screen.getByText('Custom cakes', { selector: 'span' })).toBeTruthy()
    for (const shown of ['Record ID', 'r1', 'Dataset', 'Services · Bakery only', 'Name', 'Duration', '45 min']) {
      expect(screen.getAllByText(shown).length).toBeGreaterThan(0)
    }
    expect(screen.getByRole('button', { name: 'Edit record' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Delete' })).toBeTruthy()
    // The dataset's tab stays lit beneath it.
    expect(tabs()[1]?.getAttribute('aria-selected')).toBe('true')
    // A record's page reads that record, and no page of the table.
    expect(pagedBuilt.at(-1)).toBeNull()
  })

  it('opens from the table instead of the View record dialog', async () => {
    pagedAnswer = { ...NO_RECORDS, rows: [{ $id: 'r1', values: { name: 'Custom cakes', duration: '45 min' } }] }
    await mount({ segments: ['ds-bakery'] })
    fireEvent.click(screen.getByRole('button', { name: 'View' }))
    expect(mockRouter.push).toHaveBeenCalledWith('/acme/data/ds-bakery/records/r1')
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('returns to the dataset once the record is deleted', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => undefined)
    await mount({ segments: ['ds-bakery', 'records', 'r1'] })
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(mockRouter.push).toHaveBeenCalledWith('/acme/data/ds-bakery'))
  })

  it('says a record that does not exist cannot be opened', async () => {
    await mount({ segments: ['ds-bakery', 'records', 'gone'] })
    expect(screen.getByText('This record doesn’t exist, or you can’t open it.')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Edit record' })).toBeNull()
  })

  it('refuses a record of a dataset the site does not see', async () => {
    storedRecords = { 'ds-downtown/r9': { values: { name: 'Downtown secret' } } }
    await mount({
      hostId: 'bakery',
      orgId: undefined,
      basePath: '/acme/hosts/bakery/data',
      segments: ['ds-downtown', 'records', 'r9'],
    })
    expect(screen.getByText('This dataset isn’t shared with this site.')).toBeTruthy()
    expect(screen.queryByText('Downtown secret')).toBeNull()
  })

  it('THE CONTROL: the same deep link opens on the workspace page', async () => {
    storedRecords = { 'ds-downtown/r9': { values: { name: 'Downtown secret' } } }
    await mount({ segments: ['ds-downtown', 'records', 'r9'] })
    expect(screen.getAllByText('Downtown secret').length).toBeGreaterThan(0)
  })
})
