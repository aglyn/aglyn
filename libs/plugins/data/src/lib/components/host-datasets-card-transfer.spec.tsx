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
 * The Data card's Import and Export (AGL-3530) open the console's import
 * wizard and export dialog on the selected dataset, through the core
 * launcher: no file is read, matched or written in the browser any more.
 * Outside the console shell there is no launcher, and no Import or Export.
 */

import { fireEvent, render, screen } from '@testing-library/react'
import { TransferLauncherContext, type TransferLauncher } from '@aglyn/aglyn'
import type { ReactNode } from 'react'
import { HostDatasetsCard } from './host-datasets-card.component'

const datasetDocs = [
  {
    $id: 'ds-1',
    displayName: 'Products',
    model: { order: ['title'], fields: { title: { name: 'Title', type: 'text' } } },
    visibleTo: ['org'],
  },
]
const recordDocs = [{ $id: 'rec-1', values: { title: 'Row 1' } }]
const FIRESTORE = {}
const DATA_SCOPE = { scope: ['orgs', 'org-1'], orgId: 'org-1' }
const logActivity = jest.fn()

jest.mock('@aglyn/tenant-feature-instance', () => ({
  useFirestore: () => FIRESTORE,
  useOrgDataScope: () => DATA_SCOPE,
  useScopeTokens: () => ({ tokens: ['org'], orgWide: true, loaded: true }),
  useUser: () => ({ data: { uid: 'uid-test' } }),
  useHostActivityLogger: () => logActivity,
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
})

/**
 * The card's own text button. The records grid's toolbar carries an icon
 * button named Export too — the grid's download of the rows on screen.
 */
const textButton = (name: string) =>
  screen.queryAllByRole('button', { name }).find((element) => element.textContent === name) ?? null

const mount = (transfer: TransferLauncher | null) =>
  render(
    <TransferLauncherContext.Provider value={transfer}>
      <HostDatasetsCard orgId="org-1" org={ORG} />
    </TransferLauncherContext.Provider>,
  )

beforeEach(() => jest.clearAllMocks())

describe('the Data card opens the transfer framework on the selected dataset', () => {
  it('Import opens the wizard on the dataset, and Done refreshes the count and logs it', () => {
    const transfer = launcher()
    mount(transfer)
    fireEvent.click(textButton('Import') as HTMLElement)
    expect(transfer.openImport).toHaveBeenCalledTimes(1)
    const launch = transfer.openImport.mock.calls[0][0]
    expect(launch).toMatchObject({ resource: 'data.dataset:ds-1', scope: 'org', title: 'Import into Products' })
    launch.onFinished?.()
    expect(logActivity).toHaveBeenCalledWith('Imported records', { type: 'content', id: 'ds-1', name: 'Products' })
  })

  it('Export opens the field-picking dialog on the dataset, with no filter while none is applied', () => {
    const transfer = launcher()
    mount(transfer)
    fireEvent.click(textButton('Export') as HTMLElement)
    expect(transfer.openExport).toHaveBeenCalledWith({
      resource: 'data.dataset:ds-1',
      scope: 'org',
      title: 'Export Products',
    })
  })

  it('offers neither outside the console shell, and never the old paste dialog or format buttons', () => {
    mount(null)
    expect(textButton('Import')).toBeNull()
    expect(textButton('Export')).toBeNull()
    expect(textButton('CSV')).toBeNull()
    expect(textButton('JSON')).toBeNull()
    expect(screen.queryByText('Import records')).toBeNull()
  })
})
