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
 * The bookings console must not rewrite a service from a seed the server
 * never confirmed (AGL-1358).
 *
 * Editing copies a whole stored service into `draft` and writes every field
 * of it back under `merge: true`, which protects nothing. `windows` is the
 * one that matters: the weekly availability map, rebuilt in full on every
 * save, so a cached seed re-opens slots that were closed and closes ones
 * customers can already book — and `priceUsd` goes back to whatever that
 * snapshot charged.
 *
 * Both directions asserted. The positive control matters most: this guard
 * stands in front of the ordinary save.
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { setDoc } from 'firebase/firestore'
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
jest.mock('@aglyn/shared-ui-jsx', () => ({
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

/** Open the stored row's editor and press the dialog's save. */
function editFirstServiceAndSave() {
  fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
  fireEvent.click(screen.getByRole('button', { name: 'Save service' }))
}

describe('BookingsConsolePage (AGL-1358)', () => {
  it('REFUSES to rewrite a service seeded from an unconfirmed read', async () => {
    listener.fromCache = true
    renderPage()

    editFirstServiceAndSave()

    // Settled, so this cannot pass merely by asserting too early.
    await waitFor(() => expect(enqueueSnackbar).toHaveBeenCalled())
    expect(setDoc).not.toHaveBeenCalled()
    const [message] = enqueueSnackbar.mock.calls[0]
    expect(message).toEqual(expect.stringContaining('service'))
    expect(message).toEqual(expect.stringMatching(/reload/i))
    // …and the dialog is still open with what was being edited.
    expect((screen.getByLabelText('Name') as HTMLInputElement).value).toEqual(
      'Consultation',
    )
  })

  it('SAVES normally once the server has confirmed the seed', async () => {
    renderPage()

    editFirstServiceAndSave()

    await waitFor(() => expect(setDoc).toHaveBeenCalledTimes(1))
    const [, payload] = (setDoc as jest.Mock).mock.calls[0]
    expect(payload.priceUsd).toBe(120)
    // The whole availability map is rebuilt into the payload every time.
    expect(payload.windows[1]).toEqual([{ start: 540, end: 1020 }])
  })

  it('REFUSES when the services read failed, and says so differently', async () => {
    listener.status = 'error'
    renderPage()

    editFirstServiceAndSave()

    await waitFor(() => expect(enqueueSnackbar).toHaveBeenCalled())
    expect(setDoc).not.toHaveBeenCalled()
    expect(enqueueSnackbar.mock.calls[0][0]).toEqual(
      expect.stringMatching(/could not be loaded/i),
    )
  })

  /**
   * A NEW service is built from blanks and goes through the quota-enforcing
   * resources API at a fresh uid, so it can overwrite nothing — and the first
   * snapshot of any listener is `fromCache: true`, so guarding it would
   * refuse a save that was never unsafe. Asserted, not assumed.
   */
  it('still creates a NEW service while the listener is unconfirmed', async () => {
    listener.fromCache = true
    renderPage()

    fireEvent.click(screen.getByRole('button', { name: 'Add service' }))
    fireEvent.change(screen.getByLabelText('Name'), {
      target: { value: 'Deep clean' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save service' }))

    await waitFor(() => expect(mockCreateResource).toHaveBeenCalledTimes(1))
    expect(setDoc).not.toHaveBeenCalled()
  })
})
