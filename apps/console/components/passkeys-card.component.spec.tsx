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

/** What the card asked the user to confirm, and what it asked the API. */
let mockConfirmCalls: Array<Record<string, unknown>> = []
let mockConfirmAccepts = true
let mockRemoveCalls: unknown[][] = []
let mockRemoveThrows = false

jest.mock('@aglyn/tenant-feature-instance', () => ({
  useFirestore: () => mockFirestore,
  useUser: () => mockUser,
}))

jest.mock('@aglyn/shared-ui-jsx', () => ({
  CardDisplay: ({ children }: { children: React.ReactNode }) => (
    <section>{children}</section>
  ),
  // The real provider RESOLVES on confirm and REJECTS on cancel, which is
  // the semantic the card's `.then(true).catch(false)` depends on — a
  // double that always resolved would make the cancel case untestable.
  useConfirmationContext: () => ({
    confirm: (...args: unknown[]) => {
      mockConfirmCalls.push(args[0] as Record<string, unknown>)
      return mockConfirmAccepts
        ? Promise.resolve(undefined)
        : Promise.reject(new Error('cancelled'))
    },
  }),
}))

jest.mock('@aglyn/shared-ui-snackstack', () => ({
  useSnackbar: () => ({ enqueueSnackbar: jest.fn() }),
}))

jest.mock('../constants/docs-links', () => ({ docsHelp: () => undefined }))

jest.mock('../utils/passkeys', () => ({
  registerPasskey: jest.fn(),
  removePasskey: (...args: unknown[]) => {
    mockRemoveCalls.push(args)
    if (mockRemoveThrows) return Promise.reject(new Error('nope'))
    return Promise.resolve({ removed: true, label: 'x' })
  },
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
  mockConfirmCalls = []
  mockConfirmAccepts = true
  mockRemoveCalls = []
  mockRemoveThrows = false
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

/**
 * A passkey can be REVOKED from the console (AGL-1881).
 *
 * There was no delete path of any kind — not a button, not an endpoint. The
 * credential store is server-write-only, correctly, so its absence meant a
 * user whose laptop was stolen could not take that credential off their
 * account at all, and a credential the clone check had flagged was a
 * permanent dead entry the card labelled "Blocked".
 *
 * Three strings already promised the capability: this row's own "Blocked",
 * the sign-in failure copy ("remove it from Manage account → Security") and
 * the registration limit error ("Passkey limit reached — remove one
 * first."). Zach's standing rule is that a capability must be REACHABLE in
 * the console, not merely exist, so the endpoint alone would not have
 * closed this.
 */
describe('PasskeysCard removal (AGL-1881)', () => {
  const removeButtons = () =>
    screen.queryAllByRole('button', { name: 'Remove' })

  it('offers a Remove control on EVERY listed credential', async () => {
    render(<PasskeysCard />)
    await emit([{ label: 'iPhone' }, { label: 'YubiKey' }])
    // Per row, not a bulk action: the point is taking ONE stolen device off
    // while the others keep working.
    expect(removeButtons()).toHaveLength(2)
  })

  it('offers it on a BLOCKED credential — the row that most needs it', async () => {
    // A flagged credential is refused at sign-in now, so without a remove
    // control this row is a dead end the user cannot clear.
    render(<PasskeysCard />)
    await emit([{ label: 'MacBook', suspectedCloneAt: 1 }])
    expect(screen.getByText(/Blocked/)).toBeTruthy()
    expect(removeButtons()).toHaveLength(1)
  })

  it('confirms first, naming the credential and what is NOT affected', async () => {
    render(<PasskeysCard />)
    await emit([{ label: 'YubiKey' }])
    await act(async () => {
      fireEvent.click(removeButtons()[0])
    })
    expect(mockConfirmCalls).toHaveLength(1)
    expect(String(mockConfirmCalls[0]['title'])).toContain('YubiKey')
    // Removing a passkey is not a session revocation, and the dialog must
    // not let anyone think it is.
    expect(String(mockConfirmCalls[0]['description'])).toMatch(
      /password and other sign-in methods are not affected/,
    )
  })

  it('removes the credential the button belongs to, by ID', async () => {
    render(<PasskeysCard />)
    await emit([{ label: 'iPhone' }, { label: 'YubiKey' }])
    await act(async () => {
      fireEvent.click(removeButtons()[1])
    })
    // `pk-1`, not `pk-0`: a handler closing over the wrong row would delete
    // the wrong sign-in method, and both calls look identical otherwise.
    expect(mockRemoveCalls).toHaveLength(1)
    expect(mockRemoveCalls[0][1]).toBe('pk-1')
  })

  it('removes NOTHING when the confirmation is declined', async () => {
    mockConfirmAccepts = false
    render(<PasskeysCard />)
    await emit([{ label: 'YubiKey' }])
    await act(async () => {
      fireEvent.click(removeButtons()[0])
    })
    expect(mockRemoveCalls).toEqual([])
  })

  it('keeps the row when the server refuses', async () => {
    // Nothing is patched locally — the list is a live listen, so a removal
    // that failed server-side must not leave a UI that says it worked.
    mockRemoveThrows = true
    render(<PasskeysCard />)
    await emit([{ label: 'YubiKey' }])
    await act(async () => {
      fireEvent.click(removeButtons()[0])
    })
    expect(screen.getByText('YubiKey')).toBeTruthy()
    expect(removeButtons()).toHaveLength(1)
  })
})
