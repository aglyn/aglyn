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
 * The Suppressions card can ADD an address, in a drawer.
 *
 * The card could show an entry and remove one, and there was no way to put
 * one on. So the request a merchant is most likely to receive in words rather
 * than through a link — "please stop emailing me", by reply or by phone — had
 * no button, which is a CAN-SPAM exposure and not only a missing feature.
 *
 * WHAT THIS FILE HAS TO CATCH:
 *
 *  - **A DRAWER, not a form stacked above the table.** Creating is a drawer
 *    across this console; a create form inlined over a list is the pattern
 *    being removed, so the assertion is that nothing is on screen until Add
 *    is pressed.
 *  - **THE ROUTE IS CALLED, with what was typed.** The document id is
 *    `sha256` of the normalized address and the browser must not compute it,
 *    so a card that wrote client-side would be the defect wearing a working
 *    feature's clothes.
 *  - **THE REFUSALS REACH THE OPERATOR.** A line that is not an address, and
 *    an address already on the list, are different answers and both are about
 *    somebody who asked to stop being emailed.
 *  - **A FAILED ADD DOES NOT CLEAR THE BOX.** Retyping a list of addresses
 *    because a request failed is how the second attempt loses one.
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import SuppressionsCard from './suppressions-card'

const FIRESTORE = {}

jest.mock('@aglyn/tenant-feature-instance', () => ({
  useFirestore: () => FIRESTORE,
  useUser: () => ({ data: { uid: 'uid-1', getIdToken: async () => 'tok' } }),
  usePagedCollection: () => ({
    rows: [],
    hasMore: false,
    page: 0,
    setPage: jest.fn(),
    pageSize: 10,
    setPageSize: jest.fn(),
    status: 'success',
    fromCache: false,
  }),
}))

jest.mock('@aglyn/aglyn', () => ({ pluginDocsHelp: () => undefined }))

jest.mock('firebase/firestore', () => ({
  collection: () => ({}),
  query: (base: any) => base,
  limit: () => undefined,
  orderBy: () => undefined,
  count: () => 'count',
  where: () => undefined,
  getAggregateFromServer: async () => ({ data: () => ({ total: 0 }) }),
  doc: () => ({}),
  deleteDoc: jest.fn(),
}))

const enqueueSnackbar = jest.fn()
jest.mock('@aglyn/shared-ui-snackstack', () => ({
  useSnackbar: () => ({ enqueueSnackbar }),
}))

/**
 * `CardDisplay` renders its header action here, unlike the double in
 * `suppressions-card.spec.tsx`. The Add button IS a header action, so a
 * double that dropped `HeaderProps` would make every case below unable to
 * find the control it is about.
 */
jest.mock('@aglyn/shared-ui-jsx', () => ({
  CardDisplay: ({
    children,
    HeaderProps,
  }: {
    children: ReactNode
    HeaderProps?: { action?: ReactNode }
  }) => (
    <div>
      {HeaderProps?.action}
      {children}
    </div>
  ),
  Container: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  MdiIcon: () => null,
  SrOnly: ({ children }: { children: ReactNode }) => <span>{children}</span>,
  useConfirmationContext: () => ({ confirm: jest.fn() }),
}))

/**
 * The drawer double renders its children only when `open`, which is the one
 * property every case below depends on. `NavigationDrawerComponent` is the
 * shared chrome; what is under test is when it is on screen and what it
 * posts, not how MUI paints a Drawer.
 */
jest.mock(
  '@aglyn/shared-ui-jsx/components/navigation-drawer.component',
  () => ({
    NavigationDrawerComponent: ({
      open,
      children,
      appBarLeft,
      appBarRight,
    }: {
      open: boolean
      children: ReactNode
      appBarLeft?: ReactNode
      appBarRight?: ReactNode
    }) =>
      open ? (
        <div data-testid="drawer">
          {appBarLeft}
          {appBarRight}
          {children}
        </div>
      ) : null,
  }),
)

const fetchMock = jest.fn()

beforeEach(() => {
  jest.clearAllMocks()
  global.fetch = fetchMock as unknown as typeof fetch
  fetchMock.mockResolvedValue({
    ok: true,
    json: async () => ({
      added: 1,
      results: [{ input: 'dana@example.com', added: true }],
    }),
  })
})

const openDrawer = () => {
  render(<SuppressionsCard hostId="host-1" />)
  fireEvent.click(screen.getByRole('button', { name: 'Add' }))
}

const type = (label: RegExp, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } })

describe('adding a suppression by hand', () => {
  it('shows nothing until Add is pressed', () => {
    render(<SuppressionsCard hostId="host-1" />)
    // The inline-form pattern would have the box on screen already.
    expect(screen.queryByTestId('drawer')).toBeNull()
    expect(screen.getByRole('button', { name: 'Add' })).toBeTruthy()
  })

  it('opens a DRAWER, not a form above the table', () => {
    openDrawer()
    expect(screen.getByTestId('drawer')).toBeTruthy()
    expect(screen.getByText('Stop emailing an address')).toBeTruthy()
  })

  it('posts what was typed to the route rather than writing from the browser', async () => {
    openDrawer()
    type(/email addresses/i, 'dana@example.com')
    type(/note/i, 'asked by phone')
    fireEvent.click(
      screen.getByRole('button', { name: 'Add to suppression list' }),
    )

    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/email/suppression-add')
    expect(init.method).toBe('POST')
    // The signed-in user, or the route answers 401.
    expect(init.headers.Authorization).toBe('Bearer tok')
    expect(JSON.parse(init.body)).toEqual({
      hostId: 'host-1',
      emails: 'dana@example.com',
      note: 'asked by phone',
    })
  })

  it('cannot be submitted with an empty box', () => {
    openDrawer()
    const submit = screen.getByRole('button', {
      name: 'Add to suppression list',
    }) as HTMLButtonElement
    expect(submit.disabled).toBe(true)
    fireEvent.click(submit)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('closes and clears once the address is on the list', async () => {
    openDrawer()
    type(/email addresses/i, 'dana@example.com')
    fireEvent.click(
      screen.getByRole('button', { name: 'Add to suppression list' }),
    )

    await waitFor(() => expect(screen.queryByTestId('drawer')).toBeNull())
    expect(enqueueSnackbar).toHaveBeenCalledWith(
      'Added to the suppression list',
      expect.objectContaining({ variant: 'success' }),
    )
  })

  it('NAMES the lines that were not addresses', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        added: 1,
        results: [
          { input: 'dana@example.com', added: true },
          { input: 'not an address', added: false, refusal: 'not-an-address' },
        ],
      }),
    })
    openDrawer()
    type(/email addresses/i, 'dana@example.com\nnot an address')
    fireEvent.click(
      screen.getByRole('button', { name: 'Add to suppression list' }),
    )

    // A count with no names leaves the operator to work out which line failed,
    // and the line that failed is somebody who asked to stop being emailed.
    await waitFor(() =>
      expect(enqueueSnackbar).toHaveBeenCalledWith(
        expect.stringContaining('not an address'),
        expect.objectContaining({ variant: 'warning' }),
      ),
    )
  })

  it('says so when the address was already suppressed', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        added: 0,
        results: [
          {
            input: 'dana@example.com',
            added: false,
            refusal: 'already-suppressed',
          },
        ],
      }),
    })
    openDrawer()
    type(/email addresses/i, 'dana@example.com')
    fireEvent.click(
      screen.getByRole('button', { name: 'Add to suppression list' }),
    )

    await waitFor(() =>
      expect(enqueueSnackbar).toHaveBeenCalledWith(
        'Already on the suppression list',
        expect.objectContaining({ variant: 'info' }),
      ),
    )
    // Nothing changed, so the drawer stays open rather than reporting success
    // by closing.
    expect(screen.getByTestId('drawer')).toBeTruthy()
  })

  it('keeps what was typed when the request fails', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      json: async () => ({ error: 'Not a site admin or editor' }),
    })
    openDrawer()
    type(/email addresses/i, 'dana@example.com\nsam@example.com')
    fireEvent.click(
      screen.getByRole('button', { name: 'Add to suppression list' }),
    )

    await waitFor(() =>
      expect(enqueueSnackbar).toHaveBeenCalledWith(
        'Not a site admin or editor',
        expect.objectContaining({ variant: 'error' }),
      ),
    )
    // Retyping a list because a request failed is how the second attempt
    // loses one.
    expect(
      (screen.getByLabelText(/email addresses/i) as HTMLTextAreaElement).value,
    ).toBe('dana@example.com\nsam@example.com')
  })
})
