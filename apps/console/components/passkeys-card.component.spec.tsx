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
 * AGL-1380: what the passkeys card is allowed to SAY about an account's
 * credentials.
 *
 * The `onSnapshot` error callback answered a failed listen with
 * `setRows([])` — the same value a user with no passkeys has. So a denied or
 * dropped listen told someone with registered credentials that they had
 * none, offered them the setup CTA, and hid any credential already flagged
 * `suspectedCloneAt` ("Blocked — possible credential copy") behind the same
 * empty state. That last one is the row nobody should be able to miss.
 *
 * The MIDDLE case is the one that matters and the one that fails against the
 * old component: pending already rendered nothing, and a genuinely-empty
 * success already said "No passkeys yet" correctly.
 */

import { act, fireEvent, render, screen } from '@testing-library/react'

/** The snapshot callbacks the card handed to `onSnapshot`, per subscribe. */
let onNext: ((snapshot: unknown) => void) | null = null
let onError: ((error: unknown) => void) | null = null
let subscribeCount = 0

jest.mock('firebase/firestore', () => ({
  collection: () => ({}),
  onSnapshot: (
    _ref: unknown,
    next: (snapshot: unknown) => void,
    error: (err: unknown) => void,
  ) => {
    subscribeCount += 1
    onNext = next
    onError = error
    return () => undefined
  },
}))

// One stable instance, as the real provider hands out. A fresh `{}` per call
// makes it a changing effect dependency, which re-runs the subscribe effect
// on every render and resets the very state each case is asserting.
const mockFirestore = {}
const mockUser = { data: { uid: 'uid-1' } }

jest.mock('@aglyn/tenant-feature-instance', () => ({
  useFirestore: () => mockFirestore,
  useUser: () => mockUser,
}))

jest.mock('@aglyn/shared-ui-jsx', () => ({
  CardDisplay: ({ children }: { children: React.ReactNode }) => (
    <section>{children}</section>
  ),
}))

jest.mock('@aglyn/shared-ui-snackstack', () => ({
  useSnackbar: () => ({ enqueueSnackbar: jest.fn() }),
}))

jest.mock('../constants/docs-links', () => ({ docsHelp: () => undefined }))

jest.mock('../utils/passkeys', () => ({
  registerPasskey: jest.fn(),
  usePasskeysSupported: () => true,
  PasskeyRequestError: class extends Error {},
}))

import { PasskeysCard } from './passkeys-card.component'

/**
 * Deliver a snapshot the way the SDK would. Wrapped in `act` because these
 * fire outside React's event system — without it the state update lands but
 * nothing re-renders, and every assertion reads the first paint.
 */
const emit = async (docs: Array<Record<string, unknown>>) =>
  act(async () => {
    onNext?.({
      docs: docs.map((data, index) => ({
        id: `pk-${index}`,
        data: () => data,
      })),
    })
  })

/** Fail the listen the way the SDK would. */
const fail = async (message: string) =>
  act(async () => {
    onError?.(new Error(message))
  })

beforeEach(() => {
  onNext = null
  onError = null
  subscribeCount = 0
})

describe('PasskeysCard credential claims (AGL-1380)', () => {
  it('claims nothing before the first snapshot arrives', () => {
    render(<PasskeysCard />)

    expect(screen.queryByText('No passkeys yet.')).toBeNull()
    expect(screen.queryByText(/We couldn.t load your passkeys/)).toBeNull()
  })

  it('reports a failed listen as a failure, not as "No passkeys yet."', async () => {
    // THE MIDDLE CASE. `setRows([])` in the error path made this render
    // identically to an account with no credentials at all.
    render(<PasskeysCard />)

    await fail('permission-denied')

    expect(screen.getByText(/We couldn.t load your passkeys/)).toBeTruthy()
    expect(screen.queryByText('No passkeys yet.')).toBeNull()
  })

  it('offers a Retry that re-subscribes', async () => {
    render(<PasskeysCard />)
    await fail('permission-denied')
    const before = subscribeCount

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))

    expect(subscribeCount).toBe(before + 1)
  })

  it('does not bury a cloned-credential warning behind a failed read', async () => {
    // The consequence that makes this security rather than cosmetic: the
    // empty state swallowed the one row the user must act on.
    render(<PasskeysCard />)
    await emit([{ label: 'MacBook', suspectedCloneAt: { seconds: 1 } }])
    expect(screen.getByText(/Blocked — possible credential copy/)).toBeTruthy()

    // A later failure must not erase what we already know.
    await fail('listen dropped')

    expect(screen.getByText('MacBook')).toBeTruthy()
    expect(screen.queryByText('No passkeys yet.')).toBeNull()
  })

  it('still says "No passkeys yet." on a genuinely empty success', async () => {
    // The claim is not banned, it is earned.
    render(<PasskeysCard />)

    await emit([])

    expect(screen.getByText('No passkeys yet.')).toBeTruthy()
    expect(screen.queryByText(/We couldn.t load your passkeys/)).toBeNull()
  })

  it('lists the passkeys a successful snapshot carries', async () => {
    render(<PasskeysCard />)
    await emit([{ label: 'iPhone' }, { label: 'YubiKey' }])

    expect(screen.getByText('iPhone')).toBeTruthy()
    expect(screen.getByText('YubiKey')).toBeTruthy()
    expect(screen.queryByText('No passkeys yet.')).toBeNull()
  })
})
