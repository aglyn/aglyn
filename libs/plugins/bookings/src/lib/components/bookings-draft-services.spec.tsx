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
 * A draft service on the Bookings page (AGL-3616). A draft writer makes a
 * service set up and offered nowhere; this page is where a person sees it
 * marked as a draft and activates it. A live service can be sent back to
 * draft, which takes it off the site without deleting it.
 */

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { updateDoc } from 'firebase/firestore'
import type { ReactNode } from 'react'
import BookingsConsolePage from './bookings-console-page'

/** Mutable so each spec picks the listener's verdict before rendering. */
const listener = {
  fromCache: false,
  status: 'success' as 'success' | 'error',
}

const serviceDocs = [
  {
    $id: 'svc-1',
    name: 'Consultation',
    durationMinutes: 45,
    priceUsd: 120,
    timezone: 'UTC',
    // The availability a stale seed would rebuild from.
    windows: { 1: [{ start: 540, end: 1020 }] },
  },
]
const collections: Record<string, Array<Record<string, unknown>>> = {
  services: serviceDocs,
  bookings: [],
}

/** The quota-enforcing create path, so a NEW service is distinguishable. */
const mockCreateResource = jest.fn().mockResolvedValue({ id: 'svc-new' })

jest.mock('@aglyn/tenant-feature-instance', () => ({
  useFirestore: () => ({}),
  useFirestoreCollection: (build: () => unknown) => ({
    data: collections[build() as string] ?? [],
    status: listener.status,
    fromCache: listener.fromCache,
  }),
  useHostResourceApi: () => mockCreateResource,
  // Present because the page reads it for the refund route's bearer token
  // (AGL-2315). A wholesale mock is a CLOSED WORLD: any export the component
  // tree reaches must be here or the render throws.
  useUser: () => ({ data: null }),
  // The REAL guard, not a stub. A stub would let the write through whatever
  // the page passed it, which is the one thing this spec disproves.
  writeGuardedBySeed: jest.requireActual('@aglyn/tenant-feature-instance')
    .writeGuardedBySeed,
}))

jest.mock('firebase/firestore', () => ({
  ...jest.requireActual('firebase/firestore'),
  collection: (_db: unknown, ...segments: string[]) =>
    segments[segments.length - 1],
  query: (name: string) => name,
  orderBy: () => undefined,
  limit: () => undefined,
  doc: () => ({}),
  setDoc: jest.fn().mockResolvedValue(undefined),
  updateDoc: jest.fn().mockResolvedValue(undefined),
}))

const enqueueSnackbar = jest.fn()
jest.mock('@aglyn/shared-ui-snackstack', () => ({
  useSnackbar: () => ({ enqueueSnackbar }),
}))
// The REAL barrel is spread in, and only the three things this file needs to
// control are replaced (AGL-2431). A factory that listed its exports was a
// closed world: the page renders whatever the barrel exports, so the first
// component to reach for a fourth — `HelpTip`, for a help affordance on the
// reminder line — got `undefined` and every test here died with "Element type
// is invalid" pointing at BookingsConsolePage, which is not where the fault
// was. A mock that has to be edited whenever the component under test grows
// is a mock that manufactures false reds.
jest.mock('@aglyn/shared-ui-jsx', () => ({
  ...jest.requireActual('@aglyn/shared-ui-jsx'),
  CardDisplay: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  MdiIcon: () => null,
  useConfirmationContext: () => ({
    confirm: jest.fn().mockResolvedValue(undefined),
  }),
}))

/** A plan that entitles bookings and clears the cap, so nothing is refused
 * for that reason instead of the one under test. */
const ORG = { plan: 'business' } as never

beforeEach(() => {
  jest.clearAllMocks()
  listener.fromCache = false
  listener.status = 'success'
})


const renderPage = () =>
  render(<BookingsConsolePage hostId="host-1" entitled org={ORG} />)

const rowOf = (name: string) => {
  let row: HTMLElement | null = screen.getByText(name)
  while (row && !within(row).queryAllByRole('button', { name: 'Edit' }).length) row = row.parentElement
  if (!row) throw new Error(`no row for ${name}`)
  return row
}

describe('a draft service on the Bookings page (AGL-3616)', () => {
  beforeEach(() => {
    collections['services'] = [
      { ...serviceDocs[0], $id: 'svc-draft', name: 'Drafted visit', status: 'draft' },
      { ...serviceDocs[0], $id: 'svc-live', name: 'Live visit', status: 'active' },
      { ...serviceDocs[0], $id: 'svc-old', name: 'Older visit' },
    ]
  })

  it('marks only the draft, and offers it Activate', () => {
    renderPage()
    expect(screen.getAllByText('Draft')).toHaveLength(1)
    expect(within(rowOf('Drafted visit')).getByText('Draft')).toBeTruthy()
    expect(within(rowOf('Drafted visit')).getByRole('button', { name: 'Activate' })).toBeTruthy()
    // A service made before the field existed is live, like one marked so.
    for (const name of ['Live visit', 'Older visit']) {
      expect(within(rowOf(name)).queryByRole('button', { name: 'Activate' })).toBeNull()
      expect(within(rowOf(name)).getByRole('button', { name: 'Deactivate' })).toBeTruthy()
    }
  })

  it('activates a draft with one field', async () => {
    renderPage()
    fireEvent.click(within(rowOf('Drafted visit')).getByRole('button', { name: 'Activate' }))
    await waitFor(() => expect(updateDoc).toHaveBeenCalledTimes(1))
    const [, payload] = (updateDoc as jest.Mock).mock.calls[0]
    expect(Object.keys(payload).sort()).toEqual(['status', 'updatedAt'])
    expect(payload.status).toBe('active')
    expect(enqueueSnackbar).toHaveBeenCalledWith('Drafted visit now takes bookings', expect.anything())
  })

  it('sends a live service back to draft', async () => {
    renderPage()
    fireEvent.click(within(rowOf('Older visit')).getByRole('button', { name: 'Deactivate' }))
    await waitFor(() => expect(updateDoc).toHaveBeenCalledTimes(1))
    expect((updateDoc as jest.Mock).mock.calls[0][1].status).toBe('draft')
  })

  it('creates a new service with no status, so it is live', async () => {
    renderPage()
    fireEvent.click(screen.getByRole('button', { name: 'Add service' }))
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Deep clean' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save service' }))
    await waitFor(() => expect(mockCreateResource).toHaveBeenCalledTimes(1))
    expect(mockCreateResource.mock.calls[0][0].data).not.toHaveProperty('status')
  })
})
