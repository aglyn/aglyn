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
 * The refused cadence splits on session-vs-ref evidence (AGL-1440).
 *
 * AGL-1440 measured 366K rules denies in 30 days for a platform with two
 * human users. The arithmetic behind it: a listener the rules will NEVER
 * serve — a sentinel id, a scoped collaborator's off-limits collection —
 * reopened every 2s by the AGL-1066 refusal loop is 1,800 denials an hour,
 * 43,200 a day, for as long as the tab stays open. The 2s cadence exists to
 * heal a SESSION fault (AGL-664 re-auth, late token attach), and for a
 * session fault it is right; for a rules denial it re-asks a settled
 * question at 0.5 Hz forever.
 *
 * The discriminator is the one `session-health` already trusts: a genuinely
 * dead session has no server answer to offer. If any listener has been
 * answered by the server since this one's refusal streak began, the session
 * reads and this refusal is about the ref — `refusedRetryDelayMs` then backs
 * off to 60s. These specs measure the cadence in listener opens per
 * simulated hour, because each open of a rules-denied listen is exactly one
 * denial in the Firebase console's graph — the issue's unit.
 *
 * What must NOT change, and is asserted below: a session-wide fault (no
 * server answer anywhere) keeps the 2s heal cadence exactly — that cadence
 * is how a recovery nobody announced comes back, and its ceiling is the 38
 * AGL-1358 write guards. And the heal broadcast reopens instantly at either
 * cadence.
 */

import { act, renderHook } from '@testing-library/react'
import { useFirestoreCollection } from './use-firestore-collection'
import { useFirestoreDoc } from './use-firestore-doc'
import { useDocData } from './helpers/use-doc'
import {
  reportFirestoreSessionHeal,
  reportFirestoreServerRead,
  resetFirestoreServerReadEvidence,
  RULES_REFUSED_RETRY_DELAY_MS,
  SESSION_REFUSED_RETRY_DELAY_MS,
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
}))

const RETRY_DELAY_MS = 400
const MAX_RETRIES = 5
const HOUR_MS = 60 * 60_000
const TEN_MINUTES_MS = 10 * 60_000

const denied = { code: 'permission-denied' }
const buildQuery = () => ({}) as never
/**
 * Stable identity, deliberately at module scope: `useDocData`'s effect deps
 * are `[ref.firestore, ref.path]`, so an inline literal would re-run the
 * effect (and reset its retry state) on every render.
 */
const docRef = { firestore: {}, path: 'hosts/x' } as never

/**
 * Every open is answered with a refusal exactly once — the counter is what
 * lets a test interleave its own time steps without double-answering a
 * handler, which would inject retries the hook never scheduled.
 */
let answeredCount = 0
const denyPending = () => {
  while (answeredCount < mockHandlers.length) {
    mockHandlers[answeredCount].onError(denied)
    answeredCount += 1
  }
}

/**
 * Run the mounted listener under permanent refusal for `durationMs` of fake
 * time and return how many listens were opened in total. Whatever cadence
 * the hook schedules is the cadence being measured.
 */
const measureOpens = (durationMs: number): number => {
  act(() => {
    denyPending()
    const STEP_MS = 100
    for (let elapsed = 0; elapsed < durationMs; elapsed += STEP_MS) {
      jest.advanceTimersByTime(STEP_MS)
      denyPending()
    }
  })
  return mockHandlers.length
}

/**
 * Advance fake time in 100ms steps until the hook opens another listen, up
 * to `maxMs`. Returns how long that took, or -1 if nothing opened — phase-
 * insensitive, so a test asserting on a cadence does not depend on where
 * inside the previous window it happens to be standing.
 */
const waitForNextOpen = (maxMs: number): number => {
  const count = mockHandlers.length
  let waited = 0
  act(() => {
    while (waited < maxMs && mockHandlers.length === count) {
      jest.advanceTimersByTime(100)
      waited += 100
    }
  })
  return mockHandlers.length > count ? waited : -1
}

describe.each([
  [
    'useFirestoreCollection',
    () =>
      renderHook(() =>
        useFirestoreCollection(buildQuery, [], { idField: '$id' }),
      ),
  ],
  [
    'useFirestoreDoc',
    () => renderHook(() => useFirestoreDoc(buildQuery, [], { idField: '$id' })),
  ],
  ['useDocData', () => renderHook(() => useDocData(docRef))],
])('refused cadence via %s (AGL-1440)', (_name, mount) => {
  beforeEach(() => {
    mockHandlers = []
    answeredCount = 0
    jest.useFakeTimers()
    resetFirestoreServerReadEvidence()
  })
  afterEach(() => {
    jest.useRealTimers()
    setFirestoreSessionReporters(null)
    resetFirestoreServerReadEvidence()
  })

  /**
   * THE measurement. A rules-denied listener in a session that demonstrably
   * reads — the AGL-1440 shape: console chrome served normally, one bad ref.
   *
   * Before the split this measured ~1,800 opens an hour (6 fast retries,
   * then one every 2s, forever). Now: 6 fast retries, then one per 60s —
   * ~65/hour, a 27x reduction — and the loop is still never abandoned.
   */
  it('a rules denial in a healthy session costs ~65 denials/hour, not ~1,800', () => {
    mount()
    act(() => {
      // The listen's first refusal starts the streak...
      denyPending()
      jest.advanceTimersByTime(1)
      // ...and another listener's server answer lands after it: the session
      // reads, so this refusal is about the ref.
      reportFirestoreServerRead()
    })

    const opens = measureOpens(HOUR_MS)

    // Initial open + 5 fast retries + one slow open per 60s window. The old
    // cadence measures ~1,800 on this exact loop; the bounds are generous so
    // a step off-by-one cannot flake, while staying 20x under the old number.
    expect(opens).toBeGreaterThan(HOUR_MS / RULES_REFUSED_RETRY_DELAY_MS - 3)
    expect(opens).toBeLessThan(90)
  })

  /**
   * The invariant that must survive: a session-wide fault — NO server answer
   * anywhere — keeps the 2s heal cadence exactly. This is what brings a page
   * back after a recovery nobody announced, and the AGL-1358 write guards
   * put a ceiling on it. Slowing THIS would be the real regression.
   */
  it('a session-wide fault keeps the 2s heal cadence', () => {
    mount()
    const opens = measureOpens(TEN_MINUTES_MS)

    const expected =
      1 + MAX_RETRIES + (TEN_MINUTES_MS - MAX_RETRIES * RETRY_DELAY_MS) /
        SESSION_REFUSED_RETRY_DELAY_MS
    expect(opens).toBeGreaterThan(expected - 5)
    expect(opens).toBeLessThan(expected + 5)
  })

  /**
   * Stale evidence must not count. A server answer from BEFORE this streak
   * began says nothing about why THIS listen is refused now — the session
   * may have died in between, and the safe direction is the heal cadence.
   */
  it('evidence from before the streak began does not slow the heal', () => {
    act(() => {
      reportFirestoreServerRead()
      jest.advanceTimersByTime(1)
    })
    mount()
    const opens = measureOpens(TEN_MINUTES_MS)
    expect(opens).toBeGreaterThan(
      TEN_MINUTES_MS / SESSION_REFUSED_RETRY_DELAY_MS - 5,
    )
  })

  /**
   * The heal broadcast must stay instant at the slow cadence. Backing off a
   * rules denial is safe precisely because a resolved AGL-664 re-auth does
   * not wait for the next tick of anything.
   */
  it('a heal broadcast reopens immediately even at the slow cadence', () => {
    mount()
    act(() => {
      denyPending()
      jest.advanceTimersByTime(1)
      reportFirestoreServerRead()
    })
    // Spend the fast budget so the slow cadence is in force...
    measureOpens(MAX_RETRIES * RETRY_DELAY_MS * 2)
    // ...then stand at a KNOWN phase: refuse the next slow open, which
    // schedules a fresh 60s window from this moment.
    expect(waitForNextOpen(RULES_REFUSED_RETRY_DELAY_MS + 1000)).toBeGreaterThan(0)
    act(() => denyPending())
    const opened = mockHandlers.length

    // Nothing reopens well inside the fresh slow window...
    act(() => jest.advanceTimersByTime(SESSION_REFUSED_RETRY_DELAY_MS * 2))
    expect(mockHandlers).toHaveLength(opened)

    // ...but a heal reopens NOW, not at the next 60s tick.
    act(() => reportFirestoreSessionHeal())
    expect(mockHandlers).toHaveLength(opened + 1)
  })

  /**
   * Evidence arriving MID-streak moves the next scheduled reopen to the slow
   * cadence — the policy is consulted per retry, not frozen at the first
   * refusal. This is the AGL-1143 SSO shape: everything denied at first,
   * then the session heals for most listens, and the refs that stay denied
   * must stop paying 2s.
   */
  it('evidence arriving mid-streak slows the loop from the next retry', () => {
    mount()
    // Budget spent with no evidence: the 2s session cadence is in force.
    measureOpens(
      MAX_RETRIES * RETRY_DELAY_MS + SESSION_REFUSED_RETRY_DELAY_MS * 2,
    )

    act(() => reportFirestoreServerRead())
    // The pending 2s timer predates the evidence; let it fire and refuse it
    // — the retry IT schedules is the first to consult the policy with the
    // evidence on record.
    expect(
      waitForNextOpen(SESSION_REFUSED_RETRY_DELAY_MS * 2),
    ).toBeGreaterThan(0)
    act(() => denyPending())

    // The next reopen arrives on the slow cadence: after far more than a
    // session window, within one slow window. Slowed, not stopped.
    const waited = waitForNextOpen(
      RULES_REFUSED_RETRY_DELAY_MS + SESSION_REFUSED_RETRY_DELAY_MS,
    )
    expect(waited).toBeGreaterThan(RULES_REFUSED_RETRY_DELAY_MS - 500)
    expect(waited).toBeLessThanOrEqual(RULES_REFUSED_RETRY_DELAY_MS + 500)
  })
})
