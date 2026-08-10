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
 * The overlays card must not replace an overlay from a seed the server never
 * confirmed (AGL-1358).
 *
 * Editing spreads the whole stored row into `editor` and writes it back with
 * NO options argument at all — a full document replace — so a cached seed
 * reverts every field nobody touched. Including `stats`: the lifetime
 * impression, click and dismissal counters the org beacon increments. A save
 * here would roll live engagement numbers back to whenever that snapshot was
 * taken, and nothing anywhere would report it.
 *
 * The activity log lives inside the guard for the same reason the stock
 * adjustment's does: a logged "Updated overlay" whose write never happened
 * leaves the history disagreeing with the overlay it claims to explain.
 *
 * Both directions asserted; the positive control matters most, because this
 * guard stands in front of the ordinary save.
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { setDoc } from 'firebase/firestore'
import type { ReactNode } from 'react'
import HostOverlaysCard from './host-overlays-card.component'

/** Mutable so each spec picks the listener's verdict before rendering. */
const listener = {
  fromCache: false,
  status: 'success' as 'success' | 'error',
}

const overlayDocs = [
  {
    $id: 'ov-1',
    kind: 'bar',
    name: 'Spring sale',
    enabled: true,
    order: 0,
    bar: { text: 'Spring sale on now' },
    // The live counters a stale seed would roll backwards.
    stats: { impressions: 4210, clicks: 133, dismissals: 88 },
  },
]

jest.mock('@aglyn/tenant-feature-instance', () => ({
  useFirestore: () => ({}),
  useFirestoreCollection: () => ({
    data: overlayDocs,
    status: listener.status,
    fromCache: listener.fromCache,
  }),
  useHostActivityLogger: () => mockLogActivity,
  // The REAL guard, not a stub. A stub would let the write through whatever
  // the card passed it, which is the one thing this spec disproves.
  writeGuardedBySeed: jest.requireActual('@aglyn/tenant-feature-instance')
    .writeGuardedBySeed,
}))

const mockLogActivity = jest.fn()

jest.mock('firebase/firestore', () => ({
  ...jest.requireActual('firebase/firestore'),
  collection: () => 'overlays',
  query: (name: string) => name,
  limit: () => undefined,
  doc: () => ({}),
  deleteDoc: jest.fn(),
  setDoc: jest.fn().mockResolvedValue(undefined),
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

/** A plan that entitles overlays, so nothing is refused for that reason. */
const ORG = { plan: 'business' } as never

beforeEach(() => {
  jest.clearAllMocks()
  listener.fromCache = false
  listener.status = 'success'
})

/** Open the stored row's editor and press Save. */
function editFirstOverlayAndSave() {
  fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
  fireEvent.click(screen.getByRole('button', { name: 'Save' }))
}

describe('HostOverlaysCard (AGL-1358)', () => {
  it('REFUSES to replace an overlay seeded from an unconfirmed read', async () => {
    listener.fromCache = true
    render(<HostOverlaysCard hostId="host-1" org={ORG} />)

    editFirstOverlayAndSave()

    // Settled, so this cannot pass merely by asserting too early.
    await waitFor(() => expect(enqueueSnackbar).toHaveBeenCalled())
    expect(setDoc).not.toHaveBeenCalled()
    // …and no history entry claiming an update that never landed.
    expect(mockLogActivity).not.toHaveBeenCalled()
    const [message] = enqueueSnackbar.mock.calls[0]
    expect(message).toEqual(expect.stringContaining('overlay'))
    expect(message).toEqual(expect.stringMatching(/reload/i))
    // The editor stays open with what was typed.
    expect(
      (screen.getByDisplayValue('Spring sale on now') as HTMLInputElement)
        .value,
    ).toEqual('Spring sale on now')
  })

  it('SAVES normally once the server has confirmed the seed', async () => {
    render(<HostOverlaysCard hostId="host-1" org={ORG} />)

    editFirstOverlayAndSave()

    await waitFor(() => expect(setDoc).toHaveBeenCalledTimes(1))
    const call = (setDoc as jest.Mock).mock.calls[0]
    // No options argument at all — a full replace, which is why the guard is
    // the only thing standing between a stale seed and those counters.
    expect(call).toHaveLength(2)
    expect(call[1].stats.impressions).toBe(4210)
    expect(mockLogActivity).toHaveBeenCalledTimes(1)
  })

  it('REFUSES when the overlays read failed, and says so differently', async () => {
    listener.status = 'error'
    render(<HostOverlaysCard hostId="host-1" org={ORG} />)

    editFirstOverlayAndSave()

    await waitFor(() => expect(enqueueSnackbar).toHaveBeenCalled())
    expect(setDoc).not.toHaveBeenCalled()
    expect(enqueueSnackbar.mock.calls[0][0]).toEqual(
      expect.stringMatching(/could not be loaded/i),
    )
  })

  /**
   * A NEW overlay starts from `EMPTY_BAR` at a fresh uid and can overwrite
   * nothing, so guarding it would refuse a save that was never unsafe — and
   * the first snapshot of any listener is `fromCache: true`, so that is the
   * common case rather than a corner.
   */
  it('still creates a NEW overlay while the listener is unconfirmed', async () => {
    listener.fromCache = true
    render(<HostOverlaysCard hostId="host-1" org={ORG} />)

    fireEvent.click(screen.getByRole('button', { name: 'New bar' }))
    fireEvent.change(screen.getAllByLabelText(/^Text/)[0], {
      target: { value: 'Brand new bar' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(setDoc).toHaveBeenCalledTimes(1))
  })
})
