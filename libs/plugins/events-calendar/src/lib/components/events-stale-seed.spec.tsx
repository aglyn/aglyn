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
 * The events console must not rewrite an event from a seed the server never
 * confirmed (AGL-1358).
 *
 * Editing copies a whole stored event into `draft` and ONE `setDoc` writes
 * all of it back under `merge: true`, which protects nothing. `status` is the
 * field that costs the most: a cached seed can unpublish a live, indexed
 * event — or republish one that was pulled down — from the Save button of an
 * unrelated edit. `endsAtMs` is rewritten on every save whether or not anyone
 * touched the schedule.
 *
 * This page is the only site in the issue whose listener could not report
 * staleness at all: `useHostEvents` is a hand-rolled `onSnapshot` with a
 * retry, and it discarded `snapshot.metadata`. It reports `fromCache` and
 * `unreadable` now, and both are exercised here from the SDK callbacks rather
 * than from a stubbed hook — the retry budget is drained for real, because
 * `unreadable` deliberately stays false while retries remain: those are the
 * transient post-sign-in denial the retry exists to absorb.
 *
 * Both directions asserted. The positive control matters most: this guard
 * stands in front of the ordinary save.
 */

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { setFirestoreSessionReporters } from '@aglyn/tenant-feature-instance'
import { setDoc } from 'firebase/firestore'
import type { ReactNode } from 'react'
import EventsConsolePage from './events-console-page'

/** Mutable so each spec picks the snapshot's verdict before rendering. */
const listener = {
  fromCache: false,
  /**
   * `error` fails every subscribe attempt, so the read never succeeds.
   * `stale` is production's shape: the persistent cache answers, and only
   * then does the server refuse the listen (AGL-1066).
   */
  mode: 'ok' as 'ok' | 'error' | 'stale',
}

const eventDocs = [
  {
    $id: 'evt-1',
    title: 'Launch party',
    startsAtMs: Date.parse('2026-09-01T18:00:00Z'),
    endsAtMs: Date.parse('2026-09-01T21:00:00Z'),
    location: 'The Warehouse',
    organizer: 'Ada',
    description: 'Doors at six',
    // The field a stale seed would flip on a live, indexed event.
    status: 'published',
  },
]

/**
 * Stable across renders on purpose. `useHostEvents` keys its subscribe effect
 * on the Firestore instance, and the real provider hands back one instance —
 * a mock returning a fresh `{}` each render resubscribes forever.
 */
const firestoreStub = {}

jest.mock('@aglyn/tenant-feature-instance', () => ({
  useFirestore: () => firestoreStub,
  useConsoleHostRoute: () => ({ orgSlug: 'acme' }),
  // The REAL guard, not a stub. A stub would let the write through whatever
  // the page passed it, which is the one thing this spec disproves.
  writeGuardedBySeed: jest.requireActual('@aglyn/tenant-feature-instance')
    .writeGuardedBySeed,
  // Also real: the listener is the shared hook now (AGL-1066), and it is the
  // thing that reads `metadata.fromCache` off the snapshot below. Stubbing it
  // would move the signal under test into the mock.
  useFirestoreCollection: jest.requireActual('@aglyn/tenant-feature-instance')
    .useFirestoreCollection,
  setFirestoreSessionReporters: jest.requireActual(
    '@aglyn/tenant-feature-instance',
  ).setFirestoreSessionReporters,
}))

// The listener under test is the page's own `onSnapshot`, so this drives the
// SDK callbacks directly rather than stubbing a hook — `metadata.fromCache`
// is the signal the guard reads, and it has to come from a real snapshot
// shape to prove the hook forwards it.
jest.mock('firebase/firestore', () => ({
  ...jest.requireActual('firebase/firestore'),
  collection: (_db: unknown, ...segments: string[]) =>
    segments[segments.length - 1],
  query: (name: string) => name,
  limit: () => undefined,
  doc: () => ({}),
  onSnapshot: (
    _query: unknown,
    next: (snapshot: unknown) => void,
    onError: (error: unknown) => void,
  ) => {
    const snapshot = (fromCache: boolean) => ({
      docs: eventDocs.map((record) => ({
        id: record.$id,
        data: () => record,
      })),
      metadata: { fromCache, hasPendingWrites: false },
    })
    if (listener.mode === 'error') {
      onError(new Error('permission-denied'))
    } else if (listener.mode === 'stale') {
      // The order that defeats the retry budget: cache first, refusal second.
      next(snapshot(true))
      onError({ code: 'permission-denied' })
    } else {
      next(snapshot(listener.fromCache))
    }
    return () => undefined
  },
  setDoc: jest.fn().mockResolvedValue(undefined),
  updateDoc: jest.fn().mockResolvedValue(undefined),
}))

const enqueueSnackbar = jest.fn()
jest.mock('@aglyn/shared-ui-snackstack', () => ({
  useSnackbar: () => ({ enqueueSnackbar }),
}))
jest.mock('@aglyn/shared-ui-jsx', () => ({
  AppLink: ({ children }: { children: ReactNode }) => <span>{children}</span>,
  CardDisplay: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  MdiIcon: () => null,
  useConfirmationContext: () => ({
    confirm: jest.fn().mockResolvedValue(undefined),
  }),
}))

beforeEach(() => {
  jest.clearAllMocks()
  listener.fromCache = false
  listener.mode = 'ok'
})

const renderPage = () => render(<EventsConsolePage hostId="host-1" entitled />)

/** Open the stored row's editor and press the dialog's save. */
function editFirstEventAndSave() {
  fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
  fireEvent.click(screen.getByRole('button', { name: 'Save event' }))
}

describe('EventsConsolePage (AGL-1358)', () => {
  it('REFUSES to rewrite an event seeded from an unconfirmed read', async () => {
    listener.fromCache = true
    renderPage()

    editFirstEventAndSave()

    // Settled, so this cannot pass merely by asserting too early.
    await waitFor(() => expect(enqueueSnackbar).toHaveBeenCalled())
    expect(setDoc).not.toHaveBeenCalled()
    const [message] = enqueueSnackbar.mock.calls[0]
    expect(message).toEqual(expect.stringContaining('event'))
    expect(message).toEqual(expect.stringMatching(/reload/i))
    // …and the dialog is still open with what was being edited.
    expect((screen.getByLabelText('Title') as HTMLInputElement).value).toEqual(
      'Launch party',
    )
  })

  it('SAVES normally once the server has confirmed the seed', async () => {
    renderPage()

    editFirstEventAndSave()

    await waitFor(() => expect(setDoc).toHaveBeenCalledTimes(1))
    const [, payload] = (setDoc as jest.Mock).mock.calls[0]
    // The publish state rides in the payload on every save.
    expect(payload.status).toBe('published')
    expect(payload.title).toBe('Launch party')
  })

  /**
   * `unreadable` gets no refusal test, and the reason survived the hook swap.
   *
   * This page used to carry its own `onSnapshot` with `attempt = 0` in the
   * SUCCESS handler — a fourth copy of the AGL-1066 defect. A listen that
   * keeps serving cached snapshots while failing refills the retry budget on
   * every snapshot, so the exhausted branch was never reached and the
   * dangerous state (populated editor over a read that stopped working) could
   * never raise `unreadable`. Asserting that here hung the suite, because the
   * retry loop was genuinely unbounded in that state.
   *
   * The hand-rolled copy is gone: this is `useFirestoreCollection` now. The
   * defect is not fixed by that — the shared hook has the same ungated reset,
   * deliberately, because flipping it blanks besigner canvases and outlives
   * no re-auth. What the shared hook adds is the corrected verdict on
   * `serverDenied`, and a bounded retry cadence so the doomed loop no longer
   * spins at 400ms. When `status` is eventually flipped, THIS is the test
   * that gains a refusal case.
   *
   * What `unreadable` can report is a read that never succeeded at all — and
   * then there are no rows, so there is no editor to save from. That is
   * asserted instead, along with the create still working, because a create
   * at a fresh uid can overwrite nothing however bad the read was.
   *
   * So `fromCache` is the signal carrying this guard, exactly as the issue
   * says. `unreadable` is kept because it costs nothing and a rendering
   * condition is not something a write should lean on for its safety.
   */
  it('has no editor to refuse when the read never succeeded, and still creates', async () => {
    jest.useFakeTimers()
    try {
      listener.mode = 'error'
      renderPage()
      // Five retries at 400ms, plus the attempt that spends the budget.
      await act(async () => {
        jest.advanceTimersByTime(400 * 6)
      })

      // No rows, so the edit path is unreachable through the UI.
      expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull()

      fireEvent.click(screen.getByRole('button', { name: 'Add event' }))
      fireEvent.change(screen.getByLabelText('Title'), {
        target: { value: 'Open house' },
      })
      fireEvent.change(screen.getByLabelText('Starts'), {
        target: { value: '2026-10-01T10:00' },
      })
      fireEvent.click(screen.getByRole('button', { name: 'Save event' }))
      await act(async () => {
        await Promise.resolve()
      })

      expect(setDoc).toHaveBeenCalledTimes(1)
    } finally {
      jest.useRealTimers()
    }
  })

  /**
   * One `setDoc` serves create and edit, so the guard is conditioned on
   * `draft.id`. A NEW event is built from blanks at a fresh uid and can
   * overwrite nothing — and the first snapshot of any listener is
   * `fromCache: true`, so an unconditional guard would refuse every create.
   */
  /**
   * What replacing the hand-rolled listener actually bought (AGL-1066).
   *
   * The old hook discarded the fault entirely: it retried at 400ms forever
   * and told nobody, so this page could sit over a dead session indefinitely
   * without contributing a single denial to `session-health` — the AGL-1063
   * banner could never be raised from here. The shared hook reports the
   * streak once it outlives the budget, and only for a refusal.
   *
   * This is also the first time the cached-then-refused state is assertable
   * on this page at all. It used to hang the suite.
   */
  it('now reports the refusal that the hand-rolled listener swallowed', async () => {
    const onDenied = jest.fn()
    const onServerRead = jest.fn()
    setFirestoreSessionReporters({ onDenied, onServerRead })
    jest.useFakeTimers()
    try {
      listener.mode = 'stale'
      renderPage()

      // The first subscribe already refused once; four more at 400ms spend
      // the streak. Bounded on purpose — the loop this drives is the one
      // that used to be unbounded.
      await act(async () => {
        jest.advanceTimersByTime(400 * 4)
      })

      expect(onDenied).toHaveBeenCalled()
      // ...and never on the strength of a cached emission, of which there
      // were five.
      expect(onServerRead).not.toHaveBeenCalled()
    } finally {
      jest.useRealTimers()
      setFirestoreSessionReporters(null)
    }
  })

  it('still creates a NEW event while the listener is unconfirmed', async () => {
    listener.fromCache = true
    renderPage()

    fireEvent.click(screen.getByRole('button', { name: 'Add event' }))
    fireEvent.change(screen.getByLabelText('Title'), {
      target: { value: 'Open house' },
    })
    fireEvent.change(screen.getByLabelText('Starts'), {
      target: { value: '2026-10-01T10:00' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save event' }))

    await waitFor(() => expect(setDoc).toHaveBeenCalledTimes(1))
  })
})
