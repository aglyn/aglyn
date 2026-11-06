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
 * The Data card names each dataset the way every other door onto it does
 * (`datasetDisplayName`): its `displayName`, else the `name` a dataset made
 * before AGL-536 carries. The rail's tabs and the open dataset's heading show
 * that name from the first render — the old Dataset select read `displayName`
 * alone and stood blank above the records it was listing.
 */

import { act, fireEvent, render, screen, within } from '@testing-library/react'
import {
  TransferLauncherContext,
  type TransferAccessTarget,
  type TransferAction,
  type TransferLauncher,
} from '@aglyn/aglyn'
import { type ReactNode, useMemo, useState } from 'react'
import { PageHeaderActionsContext } from '@aglyn/aglyn/app-utils/page-header-actions-context'
import { HostDatasetsCard } from './host-datasets-card.component'

const MODEL = { order: ['name'], fields: { name: { name: 'Name', type: 'text' } } }
// A pre-migration dataset: `name`, no `displayName`.
const TEAM = { $id: 'seed-team', name: 'Team', fields: ['name'], visibleTo: ['org'] }
const ZOO = { $id: 'ds-zoo', displayName: 'Zoo', model: MODEL, visibleTo: ['org'] }
let datasetDocs: Array<Record<string, unknown>> = []
const recordDocs = [{ $id: 'rec-1', values: { name: 'Avery Quinn' } }]
const FIRESTORE = {}
const DATA_SCOPE = { scope: ['orgs', 'org-1'], orgId: 'org-1' }

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
  useFirestoreDoc: () => ({ data: undefined, status: 'loading' }),
  useFirestore: () => FIRESTORE,
  useOrgDataScope: () => DATA_SCOPE,
  useScopeTokens: () => ({ tokens: ['org'], orgWide: true, loaded: true }),
  useUser: () => ({ data: { uid: 'uid-test' } }),
  useHostActivityLogger: () => jest.fn(),
  useFirestoreCollection: (build: () => unknown) => ({
    data: build() === 'datasets' ? datasetDocs : [],
    status: 'success',
    fromCache: false,
  }),
  usePagedCollection: (build: (pageLimit: number) => unknown) => ({
    rows: build(11) === 'records' ? recordDocs : [],
    hasMore: false,
    page: 0,
    setPage: jest.fn(),
    pageSize: 10,
    setPageSize: jest.fn(),
    status: 'success',
    fromCache: false,
  }),
}))

jest.mock('firebase/firestore', () => ({
  ...jest.requireActual('firebase/firestore'),
  collection: (_db: unknown, ...segments: string[]) => segments.join('/'),
  query: (path: string) => path.split('/').pop(),
  limit: (value: number) => value,
  where: () => 'where',
  doc: () => ({}),
  getCountFromServer: async () => ({ data: () => ({ count: 1 }) }),
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

const launcher = (): jest.Mocked<TransferLauncher> => ({
  openImport: jest.fn(),
  openExport: jest.fn(),
  close: jest.fn(),
  can: jest.fn((_action: TransferAction, _target: TransferAccessTarget) => true),
})

const mount = (transfer: TransferLauncher | null = null) =>
  render(
    <TransferLauncherContext.Provider value={transfer}>
      <HostDatasetsCard orgId="org-1" org={ORG} basePath="/acme/data" />
    </TransferLauncherContext.Provider>,
    { wrapper: WithPageHeader },
  )

/** The datasets the rail has a tab for, by the name each tab leads with. */
const tabNames = () =>
  within(screen.getByRole('tablist', { name: 'Datasets' }))
    .getAllByRole('tab')
    .map((tab) => tab.firstElementChild?.firstChild?.textContent ?? '')

/** Lets the record count's server aggregate land, so its update is inside `act`. */
const settle = () => act(async () => new Promise((resolve) => setTimeout(resolve, 0)))

describe('the Data card names the dataset it opens on', () => {
  it('names the dataset it opens on, from `name` when that is all it has', async () => {
    datasetDocs = [TEAM]
    const transfer = launcher()
    mount(transfer)
    await settle()
    expect(tabNames()).toEqual(['Team'])
    // The open dataset's heading, beside its actions.
    expect(screen.getAllByText('Team')).toHaveLength(2)
    fireEvent.click(screen.getAllByRole('button', { name: 'Import' }).find((one) => one.textContent === 'Import') as HTMLElement)
    expect(transfer.openImport).toHaveBeenCalledWith(expect.objectContaining({ title: 'Import into Team' }))
  })

  it('orders and lists the datasets by the names it shows', async () => {
    datasetDocs = [ZOO, TEAM]
    mount()
    await settle()
    expect(tabNames()).toEqual(['Team', 'Zoo'])
    // Each tab is the dataset's own address (AGL-4047).
    expect(screen.getAllByRole('tab').map((tab) => tab.getAttribute('href'))).toEqual([
      '/acme/data/seed-team',
      '/acme/data/ds-zoo',
    ])
  })
})
