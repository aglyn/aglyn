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
 * AGL-1260: the org-membership listen must survive its own death.
 *
 * Firestore TERMINATES a listener on error, and the provider's error handler
 * used to be `() => setLoading(false)` — no data, no listener, no error
 * surface. Host routes rendered that terminal state as an indefinite spinner,
 * because `hostReady` waits on `currentOrg` and nothing was ever going to
 * produce one. This pins the replacement contract:
 *  - a denied listen RESUBSCRIBES on the shared backoff schedule (AGL-1200's
 *    doubling one, not a flat burst spent inside the cold-load window);
 *  - only an exhausted budget latches `error` — a transient denial never
 *    flashes an error screen;
 *  - `retry()` re-runs the listen and a success actually recovers.
 */
import { act, fireEvent, render, screen } from '@testing-library/react'
import { OrgScopeProvider, useOrgScope } from '../hooks/use-org-scope'
import { MAX_RETRIES, retryDelayMs } from '../hooks/use-host-resolution'

/** Every listen opened, in order; tests drive delivery/failure explicitly. */
const mockListeners: Array<{
  next: (snapshot: unknown) => void
  error: (error: unknown) => void
  unsubscribed: boolean
}> = []

jest.mock('firebase/firestore', () => ({
  collection: jest.fn(),
  doc: jest.fn(),
  // The orgSlugs read never runs here (no workspace subdomain in jsdom), but
  // a resolved promise keeps it inert if that ever changes.
  getDoc: jest.fn(() => new Promise(() => undefined)),
  limit: jest.fn(),
  query: jest.fn(),
  onSnapshot: (
    _query: unknown,
    _options: unknown,
    next: (snapshot: unknown) => void,
    error: (error: unknown) => void,
  ) => {
    const entry = { next, error, unsubscribed: false }
    mockListeners.push(entry)
    return () => {
      entry.unsubscribed = true
    }
  },
}))

jest.mock('@aglyn/tenant-feature-instance', () => {
  // Stable identities, as reactfire provides: the membership effect keys on
  // `firestore`, so a fresh object per render would silently restart the
  // listen (and its retry budget) on every state change.
  const firestore = {}
  const user = { data: { uid: 'user-1' } }
  return {
    useFirestore: () => firestore,
    useUser: () => user,
  }
})

jest.mock('next/navigation', () => ({
  useParams: () => ({}),
}))

function Probe() {
  const { orgs, loading, error, retry } = useOrgScope()
  return (
    <>
      <span data-testid="state">
        {error ? 'error' : loading ? 'loading' : 'ready'}
      </span>
      <span data-testid="orgs">{orgs.map((org) => org.$id).join(',')}</span>
      <button onClick={retry}>{'Retry'}</button>
    </>
  )
}

const denied = () =>
  Object.assign(new Error('permission denied'), { code: 'permission-denied' })

const snapshotWith = (ids: string[]) => ({
  metadata: { fromCache: false },
  docChanges: () => ids.map(() => ({})),
  docs: ids.map((id) => ({ id, data: () => ({ slug: id }) })),
})

const state = () => screen.getByTestId('state').textContent

function newest() {
  const listener = mockListeners[mockListeners.length - 1]
  if (!listener) throw new Error('no listen is open')
  return listener
}

/** Fails the newest listen, then advances past its scheduled resubscribe. */
function failAndAdvance(attempt: number) {
  act(() => newest().error(denied()))
  act(() => jest.advanceTimersByTime(retryDelayMs(attempt)))
}

/** Drives the listen through its whole budget into the latched error. */
function exhaust() {
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
    failAndAdvance(attempt)
  }
}

describe('org membership listen retry (AGL-1260)', () => {
  beforeEach(() => {
    jest.useFakeTimers()
    mockListeners.length = 0
  })
  afterEach(() => jest.useRealTimers())

  it('REGRESSION — a denied listen resubscribes; the budget, then error', () => {
    render(
      <OrgScopeProvider>
        <Probe />
      </OrgScopeProvider>,
    )
    expect(mockListeners.length).toBe(1)
    expect(state()).toBe('loading')

    for (let attempt = 0; attempt < MAX_RETRIES; attempt += 1) {
      failAndAdvance(attempt)
      // Still inside the budget: a resubscribe, not an error. Before the fix
      // this loop failed on the very first pass — the listener died and the
      // count stayed at 1 forever.
      expect(mockListeners.length).toBe(attempt + 2)
      expect(state()).toBe('loading')
    }
    act(() => newest().error(denied()))
    expect(state()).toBe('error')
    // The budget is the budget: nothing further is scheduled after the latch.
    act(() => jest.advanceTimersByTime(60_000))
    expect(mockListeners.length).toBe(MAX_RETRIES + 1)
  })

  it('backs off — no resubscribe before the scheduled delay', () => {
    render(
      <OrgScopeProvider>
        <Probe />
      </OrgScopeProvider>,
    )
    act(() => newest().error(denied()))
    act(() => jest.advanceTimersByTime(retryDelayMs(0) - 1))
    expect(mockListeners.length).toBe(1)
    act(() => jest.advanceTimersByTime(1))
    expect(mockListeners.length).toBe(2)
  })

  it('retry() re-runs the listen and a success recovers', () => {
    render(
      <OrgScopeProvider>
        <Probe />
      </OrgScopeProvider>,
    )
    exhaust()
    expect(state()).toBe('error')

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    // A retry in flight is loading again, not still the stale error.
    expect(state()).toBe('loading')
    act(() => newest().next(snapshotWith(['org-1'])))
    expect(state()).toBe('ready')
    expect(screen.getByTestId('orgs').textContent).toBe('org-1')
  })

  it('a delivered snapshot re-arms the budget for a later outage', () => {
    render(
      <OrgScopeProvider>
        <Probe />
      </OrgScopeProvider>,
    )
    // Burn most of the budget, then succeed.
    for (let attempt = 0; attempt < MAX_RETRIES; attempt += 1) {
      failAndAdvance(attempt)
    }
    act(() => newest().next(snapshotWith(['org-1'])))
    expect(state()).toBe('ready')
    // The next outage gets the FULL budget again — without the re-arm, the
    // first failure after a recovery would latch the error immediately.
    failAndAdvance(0)
    expect(state()).toBe('ready')
    expect(mockListeners.length).toBe(MAX_RETRIES + 2)
  })
})
