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
 * The Data page never says "none" before the server has answered (AGL-4047).
 *
 * Measured in production: a site with five datasets showed the empty state
 * "Create a dataset, like Products…" for about 16 s of a cold load. The card
 * read the list as answered whenever its rows were not `undefined`, but the
 * listener hands back `[]` from its first render, before any snapshot, and a
 * cold cache answers `[]` unconfirmed. Each answer below is the one the real
 * `useFirestoreCollection` gives at that moment.
 */

import { act, render, screen } from '@testing-library/react'
import { PageHeaderActionsContext } from '@aglyn/aglyn/app-utils/page-header-actions-context'
import { type ReactNode, useMemo, useState } from 'react'
import { datasetNameLower } from '../model/datasets'
import { HostDatasetsCard } from './host-datasets-card.component'

const EMPTY_STATE = /Create a dataset, like Products/
const LOADING_LABEL = 'Loading datasets'

type Answer = { data: unknown[]; status: 'loading' | 'success' | 'error'; fromCache: boolean }
/** What the hook returns before any snapshot: rows `[]`, never `undefined`. */
const BEFORE_ANY_SNAPSHOT: Answer = { data: [], status: 'loading', fromCache: true }
const CACHED_EMPTY: Answer = { data: [], status: 'success', fromCache: true }
const SERVER_EMPTY: Answer = { data: [], status: 'success', fromCache: false }
const REFUSED: Answer = { data: [], status: 'error', fromCache: true }
const PRODUCTS = {
  $id: 'ds-products',
  displayName: 'Products',
  nameLower: datasetNameLower('Products'),
  model: { order: ['name'], fields: { name: { name: 'Name', type: 'text' } } },
  visibleTo: ['org'],
}

let listAnswer: Answer
let viewer: { tokens: string[]; orgWide: boolean; loaded: boolean }
const LOADING_DOC = { data: undefined, status: 'loading', fromCache: true }
const OWNER = {
  role: 'owner',
  allHosts: true,
  resolvedPermissions: { 'data.manage': true, 'data.viewRecords': true, 'data.export': true },
}
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
const FIRESTORE = {}
const USER = { data: { uid: 'uid-test' } }
const DATA_SCOPE = { scope: ['orgs', 'org-1'], orgId: 'org-1' }

jest.mock('@aglyn/tenant-feature-instance', () => ({
  useFirestore: () => FIRESTORE,
  useFirestoreDoc: (build: () => { path: string } | null) => {
    const ref = build()
    if (!ref) return LOADING_DOC
    if (ref.path.includes('/datasets/')) return LOADING_DOC
    return { data: OWNER, status: 'success', fromCache: false }
  },
  useOrgDataScope: () => DATA_SCOPE,
  useScopeTokens: () => viewer,
  useUser: () => USER,
  useHostActivityLogger: () => jest.fn(),
  useFirestoreCollection: (build: () => any) => {
    const built = build()
    if (String(built?.path ?? '').endsWith('/datasets')) return listAnswer
    // The real hook with no query: nothing read, still loading.
    if (!built) return BEFORE_ANY_SNAPSHOT
    return SERVER_EMPTY
  },
  usePagedCollection: () => NO_RECORDS,
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
  getCountFromServer: async () => ({ data: () => ({ count: 0 }) }),
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
jest.mock('next/navigation', () => ({
  useRouter: () => mockRouter,
  usePathname: () => '/acme/hosts/bakery/data',
  useSearchParams: () => new URLSearchParams(),
}))

function WithPageHeader(props: { children?: ReactNode }) {
  const [, setHeaderActions] = useState<ReactNode>(null)
  const value = useMemo(() => ({ setHeaderActions }), [])
  return <PageHeaderActionsContext.Provider value={value}>{props.children}</PageHeaderActionsContext.Provider>
}

const ORG = { $id: 'org-1', plan: 'scale' } as any

beforeEach(() => {
  jest.clearAllMocks()
  viewer = { tokens: ['org'], orgWide: true, loaded: true }
  listAnswer = BEFORE_ANY_SNAPSHOT
})

/** A site's Data page, as the console mounts it. */
const mount = async () => {
  const result = render(<HostDatasetsCard hostId="bakery" org={ORG} basePath="/acme/hosts/bakery/data" />, {
    wrapper: WithPageHeader,
  })
  await act(async () => {
    await Promise.resolve()
  })
  return result
}

describe('a site’s Data page while its list loads', () => {
  it('shows loading, not the empty state, before any snapshot', async () => {
    await mount()
    expect(screen.queryByText(EMPTY_STATE)).toBeNull()
    expect(screen.getByRole('progressbar', { name: LOADING_LABEL })).toBeTruthy()
  })

  it('shows loading while the viewer’s scope is still out', async () => {
    viewer = { tokens: ['org'], orgWide: true, loaded: false }
    await mount()
    expect(screen.queryByText(EMPTY_STATE)).toBeNull()
    expect(screen.getByRole('progressbar', { name: LOADING_LABEL })).toBeTruthy()
  })

  it('shows loading while an empty answer from the cache is unconfirmed', async () => {
    listAnswer = CACHED_EMPTY
    await mount()
    expect(screen.queryByText(EMPTY_STATE)).toBeNull()
    expect(screen.getByRole('progressbar', { name: LOADING_LABEL })).toBeTruthy()
  })

  it('shows the empty state once the server has answered empty', async () => {
    listAnswer = SERVER_EMPTY
    await mount()
    expect(screen.getByText(EMPTY_STATE)).toBeTruthy()
    expect(screen.queryByRole('progressbar', { name: LOADING_LABEL })).toBeNull()
  })

  it('shows rows the cache already holds, without waiting', async () => {
    listAnswer = { data: [PRODUCTS], status: 'success', fromCache: true }
    await mount()
    expect(screen.getByRole('tab', { name: /Products/ })).toBeTruthy()
    expect(screen.queryByText(EMPTY_STATE)).toBeNull()
  })

  it('says the list could not load, never that there are none, when it is refused', async () => {
    listAnswer = REFUSED
    await mount()
    expect(screen.queryByText(EMPTY_STATE)).toBeNull()
    expect(screen.getByText('We couldn’t load your datasets. This does not mean there are none.')).toBeTruthy()
  })
})

/**
 * The Datasets card, the rail beside the panel, has a loading state of its own
 * (AGL-4047). The 11/10 re-check found it blank, with no spinner, until its
 * rows arrived, while the panel beside it already said loading.
 */
describe('the Datasets card while its list loads', () => {
  const RAIL_LOADING = 'Loading the dataset list'

  it('shows its own loading before any snapshot', async () => {
    await mount()
    expect(screen.getByRole('progressbar', { name: RAIL_LOADING })).toBeTruthy()
  })

  it('shows its own loading while an empty answer from the cache is unconfirmed', async () => {
    listAnswer = CACHED_EMPTY
    await mount()
    expect(screen.getByRole('progressbar', { name: RAIL_LOADING })).toBeTruthy()
  })

  it('stops loading once the server has answered empty, and the empty state is the panel’s', async () => {
    listAnswer = SERVER_EMPTY
    await mount()
    expect(screen.queryByRole('progressbar', { name: RAIL_LOADING })).toBeNull()
    expect(screen.getByText(EMPTY_STATE)).toBeTruthy()
  })

  it('shows rows the cache already holds instead of loading', async () => {
    listAnswer = { data: [PRODUCTS], status: 'success', fromCache: true }
    await mount()
    expect(screen.getByRole('tab', { name: /Products/ })).toBeTruthy()
    expect(screen.queryByRole('progressbar', { name: RAIL_LOADING })).toBeNull()
  })

  it('does not say loading when the list is refused', async () => {
    listAnswer = REFUSED
    await mount()
    expect(screen.queryByRole('progressbar', { name: RAIL_LOADING })).toBeNull()
  })
})
