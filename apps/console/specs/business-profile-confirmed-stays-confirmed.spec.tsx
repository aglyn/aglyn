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
 * @jest-environment jsdom
 */

/**
 * Setup › Business profile: a later Update in the same page session saves
 * (AGL-4047).
 *
 * A card the server had confirmed went back to "unconfirmed" whenever the
 * client's online state went Offline for a moment, which a second console tab
 * handing over the shared cache does routinely. Its next Update was then held
 * for the guard's whole wait and refused with "We could not confirm your
 * business profile with the server yet", though the stored copy never changed
 * (production check, v1.22.2). A fall back to the cache after a confirmation
 * now keeps that confirmation for a while, so the press saves at once; one
 * that outlasts it is held, and saves when the server answers again.
 *
 * Rendered with the REAL listener hook, guard and kept press, over a scripted
 * `onSnapshot`, because the bug lived in how they hand `fromCache` to each
 * other.
 */

import {
  setSeedConfirmationKeptMs,
  setSeedConfirmWaitMs,
} from '@aglyn/tenant-feature-instance/hooks/helpers/listen-confirmation'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'

type Snapshot = {
  exists: () => boolean
  data: () => Record<string, unknown> | undefined
  id: string
  metadata: { fromCache: boolean; hasPendingWrites: boolean }
}
type Listener = (snapshot: Snapshot) => void

const mockListeners = new Map<string, Listener>()
const mockSetDoc = jest.fn().mockResolvedValue(undefined)
const mockEnqueueSnackbar = jest.fn()
const mockFirestore = {}

jest.mock('firebase/firestore', () => ({
  doc: (_db: unknown, ...path: string[]) => ({
    path: path.join('/'),
    id: path[path.length - 1],
    parent: { path: path.slice(0, -1).join('/') },
    firestore: mockFirestore,
  }),
  onSnapshot: (ref: { path: string }, ...rest: unknown[]) => {
    if (typeof rest[0] !== 'function') rest.shift()
    mockListeners.set(ref.path, rest[0] as Listener)
    return () => mockListeners.delete(ref.path)
  },
  setDoc: (...args: unknown[]) => mockSetDoc(...args),
  serverTimestamp: () => 'now',
  disableNetwork: () => Promise.resolve(),
  enableNetwork: () => Promise.resolve(),
}))
jest.mock('@aglyn/tenant-feature-instance', () => ({
  useFirestore: () => mockFirestore,
  useUser: () => ({ data: { uid: 'user-1' } }),
  // The REAL guard, which waits on the real listener's confirmation.
  writeGuardedBySeed: jest.requireActual('@aglyn/tenant-feature-instance').writeGuardedBySeed,
}))
jest.mock('../hooks/use-firestore-doc', () => ({
  __esModule: true,
  // The REAL listener hook, so `fromCache` comes from the snapshots below.
  default: jest.requireActual('@aglyn/tenant-feature-instance').useFirestoreDoc,
}))
jest.mock('@aglyn/shared-ui-jsx', () => ({
  ...jest.requireActual('@aglyn/shared-ui-jsx'),
  useLoading: () => ({ queueLoading: () => () => undefined }),
}))
jest.mock('@aglyn/shared-ui-snackstack', () => ({
  useSnackbar: () => ({ enqueueSnackbar: mockEnqueueSnackbar }),
}))
jest.mock('../constants/docs-links', () => ({ docsHelp: () => undefined }))

const BusinessProfileCard = require('../components/business-profile-card.component').default

const PROFILE = 'hosts/host-1/businessProfile'
const FIRST_STORED = {
  whatYouDo: 'Mobile dog grooming',
  services: ['Full groom'],
  audience: 'Busy owners',
  sources: { whatYouDo: 'owner', services: 'owner', audience: 'owner' },
}
let stored: Record<string, unknown> = FIRST_STORED

/** The profile's listener answers: from the cache, or from the server. */
const answer = (fromCache: boolean, hasPendingWrites = false) => {
  const path = [...mockListeners.keys()].find((key) => key.startsWith(PROFILE))
  if (!path) throw new Error('the profile is not being listened to')
  act(() =>
    mockListeners.get(path)!({
      exists: () => true,
      data: () => stored,
      id: 'profile',
      metadata: { fromCache, hasPendingWrites },
    }),
  )
}
/** What the last save stored, as the listener hands it back. */
const storeLastWrite = () => {
  const [, written] = mockSetDoc.mock.calls[mockSetDoc.mock.calls.length - 1]
  stored = { ...stored, whatYouDo: written.whatYouDo, sources: written.sources }
}

const box = () =>
  screen.getByLabelText('What the business does', { selector: 'textarea' }) as HTMLTextAreaElement
const update = () => screen.getByRole('button', { name: /^(Update|Saving…|Submitting\.\.\.)$/ })
const refused = () =>
  mockEnqueueSnackbar.mock.calls.some(([message]) => String(message).includes('could not confirm')) ||
  screen.queryByText(/could not confirm/) !== null

/** A confirmed card, one save made and echoed back as a write still pending. */
async function confirmedAndSavedOnce() {
  render(<BusinessProfileCard orgId="org-1" hostId="host-1" />)
  await screen.findByLabelText('What the business does', { selector: 'textarea' })
  answer(true)
  answer(false)

  fireEvent.change(box(), { target: { value: 'Mobile dog grooming, north Austin' } })
  fireEvent.click(update())
  await waitFor(() => expect(mockSetDoc).toHaveBeenCalledTimes(1))
  await waitFor(() =>
    expect(mockEnqueueSnackbar).toHaveBeenCalledWith('Business profile saved', { variant: 'success' }),
  )
  storeLastWrite()
  // The local write's own echo, then the server's acknowledgement.
  answer(false, true)
  answer(false)
}

describe('Business profile: a later Update in the same page session (AGL-4047)', () => {
  beforeEach(() => {
    mockListeners.clear()
    stored = FIRST_STORED
    mockSetDoc.mockClear()
    mockEnqueueSnackbar.mockClear()
    // The guard's wait, short enough that a refusal lands inside the test.
    setSeedConfirmWaitMs(300)
  })
  afterEach(() => {
    setSeedConfirmWaitMs()
    setSeedConfirmationKeptMs()
  })

  it.each([
    ['a cache-only snapshot', false],
    ['a cache-only snapshot still carrying a pending write', true],
  ])('saves at once after %s, with no refusal', async (_name, hasPendingWrites) => {
    await confirmedAndSavedOnce()

    // Another tab hands over the shared cache: the client goes Offline for
    // a moment and the confirmed view reads from the cache again.
    answer(true, hasPendingWrites)

    fireEvent.change(box(), { target: { value: 'Mobile dog grooming, all of Austin' } })
    fireEvent.click(update())
    await waitFor(() => expect(mockSetDoc).toHaveBeenCalledTimes(2))
    expect(mockSetDoc.mock.calls[1][1].whatYouDo).toBe('Mobile dog grooming, all of Austin')
    await waitFor(() =>
      expect(mockEnqueueSnackbar).toHaveBeenLastCalledWith('Business profile saved', { variant: 'success' }),
    )
    // Past the guard's wait: still no refusal anywhere.
    await act(() => new Promise((resolve) => setTimeout(resolve, 400)))
    expect(refused()).toBe(false)
    expect(screen.queryByText(/Checking your business profile/)).toBeNull()
  })

  it('holds a press once the kept confirmation lapses, and saves when the server answers', async () => {
    setSeedConfirmationKeptMs(0)
    await confirmedAndSavedOnce()
    answer(true)

    fireEvent.change(box(), { target: { value: 'Mobile dog grooming, all of Austin' } })
    expect(screen.getByText('Checking your business profile with the server…')).toBeTruthy()
    fireEvent.click(update())
    await waitFor(() => expect(update().textContent).toBe('Saving…'))
    expect(mockSetDoc).toHaveBeenCalledTimes(1)

    answer(false)
    await waitFor(() => expect(mockSetDoc).toHaveBeenCalledTimes(2))
    expect(refused()).toBe(false)
  })

  it('still refuses, and writes nothing, when the server never answers again', async () => {
    setSeedConfirmationKeptMs(0)
    await confirmedAndSavedOnce()
    answer(true)

    fireEvent.change(box(), { target: { value: 'Mobile dog grooming, all of Austin' } })
    fireEvent.click(update())
    await waitFor(() => expect(refused()).toBe(true))
    expect(mockSetDoc).toHaveBeenCalledTimes(1)
    expect(box().value).toBe('Mobile dog grooming, all of Austin')
  })
})
