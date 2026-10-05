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
 * The redirects card's Import and Export, and the save checks it shares with
 * the importer.
 *
 * Import and Export sit in the card header and open the console's transfer
 * launcher on the `redirects` resource; outside the console shell there is
 * no launcher and no buttons. The duplicate check, the chain-loop walk and
 * the published-page warning moved into the model so the importer asks the
 * same questions — these hold the page's answers to them where they were.
 */

import { TransferLauncherContext, type TransferLauncher } from '@aglyn/aglyn'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { setDoc } from 'firebase/firestore'
import type { ReactNode } from 'react'
import RedirectsConsolePage from './redirects-console-page'

const redirectDocs = [
  { $id: 'r1', source: '/old', destination: '/new', statusCode: 302, kind: 'exact', enabled: true },
  { $id: 'r2', source: '/new', destination: '/newer', statusCode: 302, kind: 'exact', enabled: true },
]

const mockCreateResource = jest.fn().mockResolvedValue({ id: 'red-new' })

jest.mock('@aglyn/tenant-feature-instance', () => ({
  useFirestore: () => ({}),
  useFirestoreCollection: () => ({ data: redirectDocs, status: 'success', fromCache: false }),
  useFirestoreDoc: () => ({
    data: { $id: 'host-1', screens: { about: 'about' } },
    status: 'success',
    fromCache: false,
  }),
  useHostResourceApi: () => mockCreateResource,
  useUser: () => ({ data: { uid: 'uid-editor' } }),
  writeGuardedBySeed: jest.requireActual('@aglyn/tenant-feature-instance').writeGuardedBySeed,
  ceilingedWindow: jest.requireActual('@aglyn/tenant-feature-instance').ceilingedWindow,
  collectionCeiling: jest.requireActual('@aglyn/tenant-feature-instance').collectionCeiling,
}))

jest.mock('firebase/firestore', () => ({
  ...jest.requireActual('firebase/firestore'),
  collection: (_db: unknown, ...segments: string[]) => segments[segments.length - 1],
  doc: () => ({}),
  getDoc: jest.fn().mockResolvedValue({ get: () => ({}) }),
  getCountFromServer: jest.fn().mockResolvedValue({ data: () => ({ count: 2 }) }),
  setDoc: jest.fn().mockResolvedValue(undefined),
  updateDoc: jest.fn().mockResolvedValue(undefined),
}))

jest.mock('@aglyn/shared-util-http/authorized-token', () => ({
  authorizedFetch: jest.fn().mockResolvedValue({ ok: true }),
}))

const enqueueSnackbar = jest.fn()
jest.mock('@aglyn/shared-ui-snackstack', () => ({
  useSnackbar: () => ({ enqueueSnackbar }),
}))
jest.mock('@aglyn/shared-ui-jsx', () => ({
  // The header's action is drawn, so the card's own buttons can be pressed.
  CardDisplay: ({ children, HeaderProps }: { children: ReactNode; HeaderProps?: { action?: ReactNode } }) => (
    <div>
      <header>{HeaderProps?.action}</header>
      {children}
    </div>
  ),
  MdiIcon: () => null,
  useConfirmationContext: () => ({ confirm: jest.fn().mockResolvedValue(undefined) }),
}))

const ORG = { plan: 'business' } as never

function launcher(allowed: { import?: boolean; export?: boolean } = {}): TransferLauncher {
  return {
    openImport: jest.fn(),
    openExport: jest.fn(),
    close: jest.fn(),
    can: jest.fn((action) => allowed[action] ?? true),
  }
}

const renderPage = (transfer: TransferLauncher | null = null) =>
  render(
    <TransferLauncherContext.Provider value={transfer}>
      <RedirectsConsolePage hostId="host-1" entitled org={ORG} />
    </TransferLauncherContext.Provider>,
  )

/** Add a rule through the dialog. */
function addRule(source: string, destination: string) {
  fireEvent.click(screen.getByRole('button', { name: 'Add redirect' }))
  fireEvent.change(screen.getByLabelText('From path'), { target: { value: source } })
  fireEvent.change(screen.getByLabelText('To'), { target: { value: destination } })
  fireEvent.click(screen.getByRole('button', { name: 'Save redirect' }))
}

beforeEach(() => {
  jest.clearAllMocks()
})

describe('Import and Export on the redirects card', () => {
  it('shows neither outside the console shell', () => {
    renderPage(null)
    expect(screen.queryByRole('button', { name: 'Import' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Export' })).toBeNull()
  })

  it('opens the wizard and the dialog on the site’s redirects', () => {
    const transfer = launcher()
    renderPage(transfer)
    fireEvent.click(screen.getByRole('button', { name: 'Import' }))
    expect(transfer.openImport).toHaveBeenCalledWith({ resource: 'redirects', scope: 'host', hostId: 'host-1' })
    fireEvent.click(screen.getByRole('button', { name: 'Export' }))
    expect(transfer.openExport).toHaveBeenCalledWith({ resource: 'redirects', scope: 'host', hostId: 'host-1' })
  })

  it('offers a reader Export alone, and someone who may do neither nothing', () => {
    const reader = launcher({ import: false })
    const { unmount } = renderPage(reader)
    expect(screen.queryByRole('button', { name: 'Import' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Export' })).toBeTruthy()
    expect(reader.can).toHaveBeenCalledWith('import', { resource: 'redirects', scope: 'host', hostId: 'host-1' })
    unmount()
    renderPage(launcher({ import: false, export: false }))
    expect(screen.queryByRole('button', { name: 'Export' })).toBeNull()
  })
})

describe('the save checks the importer shares', () => {
  it('refuses a duplicate from-path', async () => {
    renderPage()
    addRule('/Old/', '/elsewhere')
    await waitFor(() =>
      expect(enqueueSnackbar).toHaveBeenCalledWith('A rule for /old already exists', expect.anything()),
    )
    expect(mockCreateResource).not.toHaveBeenCalled()
  })

  it('refuses a destination that chains back to the rule', async () => {
    renderPage()
    addRule('/newer', '/old')
    await waitFor(() =>
      expect(enqueueSnackbar).toHaveBeenCalledWith(
        'That destination chains back to this rule — a redirect loop',
        expect.anything(),
      ),
    )
    expect(mockCreateResource).not.toHaveBeenCalled()
  })

  it('warns about a published page, and saves', async () => {
    renderPage()
    addRule('/about', '/about-us')
    await waitFor(() => expect(mockCreateResource).toHaveBeenCalledTimes(1))
    expect(enqueueSnackbar).toHaveBeenCalledWith(
      '/about is a published page — the redirect takes precedence',
      expect.anything(),
    )
    expect(setDoc).not.toHaveBeenCalled()
  })
})
