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
 * before AGL-536 carries. The Dataset select opens on the first dataset and
 * must show that dataset's name from the first render — it used to read
 * `displayName` alone and stood blank above the records it was listing.
 */

import { act, fireEvent, render, screen, within } from '@testing-library/react'
import {
  TransferLauncherContext,
  type TransferAccessTarget,
  type TransferAction,
  type TransferLauncher,
} from '@aglyn/aglyn'
import type { ReactNode } from 'react'
import { HostDatasetsCard } from './host-datasets-card.component'

const MODEL = { order: ['name'], fields: { name: { name: 'Name', type: 'text' } } }
// A pre-migration dataset: `name`, no `displayName`.
const TEAM = { $id: 'seed-team', name: 'Team', fields: ['name'], visibleTo: ['org'] }
const ZOO = { $id: 'ds-zoo', displayName: 'Zoo', model: MODEL, visibleTo: ['org'] }
let datasetDocs: Array<Record<string, unknown>> = []
const recordDocs = [{ $id: 'rec-1', values: { name: 'Avery Quinn' } }]
const FIRESTORE = {}
const DATA_SCOPE = { scope: ['orgs', 'org-1'], orgId: 'org-1' }

jest.mock('@aglyn/tenant-feature-instance', () => ({
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
  CardDisplay: ({ children }: { children: ReactNode }) => <div>{children}</div>,
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
      <HostDatasetsCard orgId="org-1" org={ORG} />
    </TransferLauncherContext.Provider>,
  )

/** Lets the record count's server aggregate land, so its update is inside `act`. */
const settle = () => act(async () => new Promise((resolve) => setTimeout(resolve, 0)))

describe('the Data card names the dataset it opens on', () => {
  it('shows the dataset’s name in the Dataset select on first open, from `name` when that is all it has', async () => {
    datasetDocs = [TEAM]
    const transfer = launcher()
    mount(transfer)
    await settle()
    expect(screen.getByRole('combobox', { name: 'Dataset' }).textContent).toBe('Team')
    fireEvent.click(screen.getAllByRole('button', { name: 'Import' }).find((one) => one.textContent === 'Import') as HTMLElement)
    expect(transfer.openImport).toHaveBeenCalledWith(expect.objectContaining({ title: 'Import into Team' }))
  })

  it('orders and lists the datasets by the names it shows', async () => {
    datasetDocs = [ZOO, TEAM]
    mount()
    await settle()
    const select = screen.getByRole('combobox', { name: 'Dataset' })
    expect(select.textContent).toBe('Team')
    fireEvent.mouseDown(select)
    expect(within(screen.getByRole('listbox')).getAllByRole('option').map((option) => option.textContent)).toEqual(['Team', 'Zoo'])
  })
})
