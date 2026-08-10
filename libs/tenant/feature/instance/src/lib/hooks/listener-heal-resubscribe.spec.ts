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
 * Re-subscribe on session heal — the hard prerequisite for the AGL-1066
 * item-3 flip.
 *
 * The flip (gating `attempt = 0` on `!fromCache`) lets a refused listen reach
 * `status: 'error'`, and the error branch is terminal. Today a refused
 * listener recovers only because it never stops reopening; take that away and
 * the AGL-664 in-place re-auth — a dialog that takes as long as a human takes
 * to type a password — heals the session onto a console that has already
 * given up. Nothing remounts: `AuthenticatedLayout` deliberately holds the
 * tree open for a pending re-auth, a `stale` re-auth signs the same uid back
 * in, and `useDocData`'s deps are `[ref.firestore, ref.path]`.
 *
 * So: a heal broadcast, and every listener the server is refusing reopens on
 * it. All three hooks, driven identically — a recovery only two of them
 * perform is a recovery no consumer can rely on.
 *
 * The negative control matters as much as the positive one. A heal is a
 * RECOVERY FROM DENIAL, not any token event; Firebase refreshes the ID token
 * hourly, and a listener that reopened on that would be a storm. Healthy
 * listeners must ignore the broadcast outright.
 */

import { act, renderHook } from '@testing-library/react'
import { useFirestoreCollection } from './use-firestore-collection'
import { useFirestoreDoc } from './use-firestore-doc'
import { useDocData } from './helpers/use-doc'
import {
  reportFirestoreSessionHeal,
  setFirestoreSessionReporters,
} from './firestore-denial-reporter'

type Handler = {
  onNext: (snap: unknown) => void
  onError: (err?: { code?: string }) => void
}
let mockHandlers: Handler[] = []

jest.mock('firebase/firestore', () => ({
  onSnapshot: (
    _target: unknown,
    onNext: (snap: unknown) => void,
    onError: () => void,
  ) => {
    mockHandlers.push({ onNext, onError })
    return jest.fn()
  },
  getDocsFromServer: jest.fn(),
  serverTimestamp: jest.fn(),
  setDoc: jest.fn(),
  updateDoc: jest.fn(),
}))

const RETRY_DELAY_MS = 400
const MAX_RETRIES = 5
const REFUSED_RETRY_DELAY_MS = 2_000

const denied = { code: 'permission-denied' }

/** Enough of a `DocumentReference` for `useDocData`'s deps and the mock. */
const docRef = { firestore: {}, path: 'orgs/o/hosts/h' } as never
const buildQuery = () => ({}) as never

interface Observed {
  status: string
  fromCache: boolean
  serverDenied: boolean
  /** The row/field name currently on screen, or undefined when blank. */
  name: string | undefined
}

interface Subject {
  /** Renders the hook and normalises what the caller sees. */
  use: () => Observed
  /** A snapshot in that hook's shape; `live` means the server answered. */
  snapshot: (fromCache: boolean) => unknown
}

const collectionSnapshot = (fromCache: boolean) => ({
  empty: false,
  docs: [
    {
      id: fromCache ? 'stale' : 'live',
      data: () => ({ name: fromCache ? 'stale' : 'live' }),
    },
  ],
  metadata: { fromCache, hasPendingWrites: false },
})

const docSnapshot = (fromCache: boolean) => ({
  id: 'doc',
  exists: () => true,
  data: () => ({ name: fromCache ? 'stale' : 'live' }),
  metadata: { fromCache, hasPendingWrites: false },
})

const subjects: Array<[string, Subject]> = [
  [
    'useFirestoreCollection',
    {
      use: () => {
        const result = useFirestoreCollection<{ name: string }>(buildQuery, [])
        return { ...result, name: result.data[0]?.name }
      },
      snapshot: collectionSnapshot,
    },
  ],
  [
    'useFirestoreDoc',
    {
      use: () => {
        const result = useFirestoreDoc<{ name: string }>(() => docRef, [])
        return { ...result, name: result.data?.name }
      },
      snapshot: docSnapshot,
    },
  ],
  [
    'useDocData',
    {
      use: () => {
        const result = useDocData<{ name: string }>(docRef)
        return { ...result, name: result.data?.name }
      },
      snapshot: docSnapshot,
    },
  ],
]

describe.each(subjects)('%s heals on re-auth (AGL-1066)', (_name, subject) => {
  beforeEach(() => {
    mockHandlers = []
    jest.useFakeTimers()
    // The verdict is what is under test here, not the reporting.
    setFirestoreSessionReporters(null)
  })
  afterEach(() => jest.useRealTimers())

  const latest = () => mockHandlers[mockHandlers.length - 1]

  /**
   * One denial cycle as production experiences it under
   * `persistentLocalCache`: the cache answers, and only then does the server
   * refuse. Advances past the SLOW cadence so every cycle genuinely reopens.
   */
  const denyCycles = (count: number, err: { code?: string } = denied) =>
    act(() => {
      for (let i = 0; i < count; i += 1) {
        latest().onNext(subject.snapshot(true))
        latest().onError(err)
        jest.advanceTimersByTime(REFUSED_RETRY_DELAY_MS)
      }
    })

  /**
   * THE test. A listener refused well past its budget, a session that heals,
   * and a live page again — with no reload and no dependency change.
   *
   * Named for the mutation check: emptying `reportFirestoreSessionHeal` must
   * fail THIS.
   */
  it('re-subscribes when the session heals and serves a server snapshot', () => {
    const { result } = renderHook(subject.use)

    denyCycles(MAX_RETRIES * 2)
    expect(result.current.serverDenied).toBe(true)
    expect(result.current.fromCache).toBe(true)

    // Nothing is due: the last refusal scheduled the slow cadence, and the
    // clock has not moved since. Any listener opened below is the heal's.
    const opened = mockHandlers.length

    act(() => reportFirestoreSessionHeal())

    // Reopened on the broadcast itself — not on the next 2s tick. That
    // immediacy is the point: 38 AGL-1358 write guards refuse a save while
    // `fromCache` is true and can only learn otherwise from a reopened
    // listen the server answers.
    expect(mockHandlers).toHaveLength(opened + 1)

    act(() => latest().onNext(subject.snapshot(false)))
    expect(result.current.status).toBe('success')
    expect(result.current.fromCache).toBe(false)
    expect(result.current.serverDenied).toBe(false)
    expect(result.current.name).toBe('live')
  })

  /**
   * The negative control, and the one that would be a listener storm if it
   * were wrong. A healthy session refreshes its ID token roughly hourly; a
   * hook that reopened on any token event would tear down and rebuild every
   * listen in the console on a timer, for nothing.
   */
  it('does not re-subscribe on a healthy session', () => {
    const { result } = renderHook(subject.use)

    act(() => latest().onNext(subject.snapshot(true)))
    act(() => latest().onNext(subject.snapshot(false)))
    expect(result.current.serverDenied).toBe(false)
    expect(mockHandlers).toHaveLength(1)

    // Three heals — more than an hourly refresh could produce in a session —
    // and the open, working listener ignores every one of them.
    act(() => {
      reportFirestoreSessionHeal()
      reportFirestoreSessionHeal()
      reportFirestoreSessionHeal()
    })
    expect(mockHandlers).toHaveLength(1)

    act(() => jest.advanceTimersByTime(REFUSED_RETRY_DELAY_MS * 10))
    expect(mockHandlers).toHaveLength(1)
    expect(result.current.status).toBe('success')
    expect(result.current.name).toBe('live')
  })

  /**
   * The same control one step earlier: a token race that resolved leaves the
   * streak at zero, so a later heal finds nothing to recover. Otherwise
   * every sign-in would arm a reopen for the rest of the session.
   */
  it('does not re-subscribe after a token race that already resolved', () => {
    renderHook(subject.use)

    act(() => {
      for (let i = 0; i < MAX_RETRIES - 1; i += 1) {
        latest().onError(denied)
        jest.advanceTimersByTime(RETRY_DELAY_MS)
      }
      latest().onNext(subject.snapshot(false))
    })
    const opened = mockHandlers.length

    act(() => reportFirestoreSessionHeal())
    expect(mockHandlers).toHaveLength(opened)
  })

  /**
   * The blanking constraint, at the data layer. Two surfaces disappear if
   * content does: the besigner editors render "Not found" over the canvas
   * someone is mid-edit on, and the host setup Theme tab renders nothing. A
   * re-subscribe that cleared `data` would blank them on the way BACK from a
   * successful re-auth, which is the worst possible moment.
   */
  it('keeps the data on screen across the re-subscribe', () => {
    const { result } = renderHook(subject.use)

    denyCycles(MAX_RETRIES * 2)
    expect(result.current.name).toBe('stale')

    act(() => reportFirestoreSessionHeal())

    // Reopened, and nothing has answered yet — the cached content is still
    // rendered, exactly as it was a moment ago.
    expect(result.current.name).toBe('stale')
    expect(result.current.status).toBe('success')
  })

  /**
   * Offline must stay inert. A lost network fires no error callback at all,
   * and anything that does surface one carries `unavailable` — which never
   * counts toward the streak, so there is nothing for a heal to act on.
   */
  it('is inert offline', () => {
    const { result } = renderHook(subject.use)

    denyCycles(MAX_RETRIES * 3, { code: 'unavailable' })
    expect(result.current.serverDenied).toBe(false)
    const opened = mockHandlers.length

    act(() => reportFirestoreSessionHeal())
    expect(mockHandlers).toHaveLength(opened)
    expect(result.current.status).toBe('success')
  })

  /**
   * The state the flip creates, and the reason this exists at all: a
   * listener that spent its budget and went TERMINAL. No timer, no pending
   * reopen — today only a remount brings it back, and a re-auth is
   * specifically the case where nothing remounts.
   */
  it('resurrects a listener that already went terminal', () => {
    const { result } = renderHook(subject.use)

    // No cached emission to refund the budget: the no-cache path, which
    // reaches `status: 'error'` today and is what the flip generalises.
    act(() => {
      for (let i = 0; i <= MAX_RETRIES; i += 1) {
        latest().onError(denied)
        jest.advanceTimersByTime(RETRY_DELAY_MS)
      }
    })
    expect(result.current.status).toBe('error')

    const opened = mockHandlers.length
    act(() => jest.advanceTimersByTime(REFUSED_RETRY_DELAY_MS * 10))
    // Terminal really means terminal — nothing was ever going to reopen it.
    expect(mockHandlers).toHaveLength(opened)

    act(() => reportFirestoreSessionHeal())
    expect(mockHandlers).toHaveLength(opened + 1)

    act(() => latest().onNext(subject.snapshot(false)))
    expect(result.current.status).toBe('success')
    expect(result.current.fromCache).toBe(false)
    expect(result.current.name).toBe('live')
  })

  /**
   * A heal that turns out to be wishful thinking must not restart the fast
   * cadence. The 400ms → 2s backoff was tightened from 5s for the write
   * guards' sake and is the ceiling on how long a save stays refused after a
   * heal; nothing here may loosen it, and nothing here may undo it either.
   */
  it('falls back to the slow cadence when the heal did not take', () => {
    renderHook(subject.use)

    denyCycles(MAX_RETRIES * 2)
    act(() => reportFirestoreSessionHeal())
    const opened = mockHandlers.length

    act(() => {
      latest().onError(denied)
      jest.advanceTimersByTime(RETRY_DELAY_MS)
    })
    expect(mockHandlers).toHaveLength(opened)

    act(() => jest.advanceTimersByTime(REFUSED_RETRY_DELAY_MS))
    expect(mockHandlers).toHaveLength(opened + 1)
  })

  /** An unmounted listener has no business reopening on anything. */
  it('stops listening for heals once unmounted', () => {
    const { unmount } = renderHook(subject.use)

    denyCycles(MAX_RETRIES * 2)
    unmount()
    const opened = mockHandlers.length

    act(() => reportFirestoreSessionHeal())
    expect(mockHandlers).toHaveLength(opened)
  })
})

/**
 * The channel itself. A broadcast with nothing listening is the state every
 * app that is not the console is in permanently — the tenant runtime has no
 * client Firestore at all — and it must be a silent no-op rather than a
 * throw.
 */
describe('the heal channel (AGL-1066)', () => {
  it('is a no-op with no subscribers', () => {
    expect(() => reportFirestoreSessionHeal()).not.toThrow()
  })
})
