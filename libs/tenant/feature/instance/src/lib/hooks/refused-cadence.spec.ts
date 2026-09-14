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
 * How often a refused listen is reopened once its retry budget is spent.
 *
 * Each open of a refused listen is one denial in the Firebase console's
 * graph, and refused listens bill reads (AGL-2944), so these specs measure
 * the cadence in listener opens per simulated hour.
 *
 * The policy, asserted below for all three listener hooks:
 *
 *  - The delay starts at a floor that depends on what the refusal is evidence
 *    of (AGL-1440): 2s while no listener has had a server answer since the
 *    streak began (the session may be dead, and a young session fault heals
 *    in seconds), 60s once one has (the session reads; this ref is refused).
 *  - It then grows with the streak's age — a tenth of it — to a five-minute
 *    ceiling (AGL-2945). The listen is never abandoned. A fixed 2s cadence
 *    cost 1,800 opens an hour per listener for as long as a tab stayed open
 *    on a dead session; that is what did not scale with users.
 *  - A person arriving reopens at once: the AGL-664 heal broadcast, the tab
 *    becoming visible, the window regaining focus. Arrivals cannot run the
 *    loop faster than one reopen per 2s after a refusal.
 *  - A hidden tab reopens nothing on a timer (AGL-2944).
 */

import { act, renderHook } from '@testing-library/react'
import { useFirestoreCollection } from './use-firestore-collection'
import { useFirestoreDoc } from './use-firestore-doc'
import { useDocData } from './helpers/use-doc'
import {
  REFUSED_RETRY_CEILING_MS,
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
  onSnapshot: (_target: unknown, ...rest: unknown[]) => {
    // Mirrors the real SDK overload: (target, onNext, onError?) or
    // (target, options, onNext, onError?). The listener hooks pass listen
    // options now, so a positional double would capture them as `onNext`
    // (AGL-2486).
    if (typeof rest[0] !== 'function') rest.shift()
    mockHandlers.push({
      onNext: rest[0] as (snap: unknown) => void,
      onError: rest[1] as () => void,
    })
    return jest.fn()
  },
  getDocsFromServer: jest.fn(),
}))

const RETRY_DELAY_MS = 400
const MAX_RETRIES = 5
const HOUR_MS = 60 * 60_000
/** Long enough to spend the fast budget and leave a 2s reopen pending. */
const FAST_BUDGET_MS = MAX_RETRIES * RETRY_DELAY_MS + SESSION_REFUSED_RETRY_DELAY_MS * 2

const denied = { code: 'permission-denied' }
const buildQuery = () => ({}) as never

/**
 * jsdom's tab is always `visible`. The getter makes it switchable, and every
 * test starts visible, so the cadence below is the one a page someone could
 * be looking at runs.
 */
let mockVisibility: DocumentVisibilityState = 'visible'
Object.defineProperty(document, 'visibilityState', {
  configurable: true,
  get: () => mockVisibility,
})
const setVisibility = (next: DocumentVisibilityState) => {
  mockVisibility = next
  document.dispatchEvent(new Event('visibilitychange'))
}
const focusWindow = () => window.dispatchEvent(new Event('focus'))

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

/** Mark the session as reading: another listener's server answer lands. */
const serverAnswersAnotherListener = () => {
  act(() => {
    denyPending()
    jest.advanceTimersByTime(1)
    reportFirestoreServerRead()
  })
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
])('refused cadence via %s (AGL-1440, AGL-2945)', (_name, mount) => {
  beforeEach(() => {
    mockHandlers = []
    answeredCount = 0
    mockVisibility = 'visible'
    jest.useFakeTimers()
    resetFirestoreServerReadEvidence()
  })
  afterEach(() => {
    jest.useRealTimers()
    setFirestoreSessionReporters(null)
    resetFirestoreServerReadEvidence()
  })

  /**
   * A young session fault is the late-token / App Check hiccup shape, which
   * heals in seconds — so the first seconds of a streak keep reopening every
   * 2s, and a recovery nobody announced is picked up almost at once.
   */
  it('a young session-wide fault reopens every 2s', () => {
    mount()
    // 6 opens in the fast budget, then one every 2s until the streak is 20s old.
    const opens = measureOpens(20_000)
    expect(opens).toBeGreaterThanOrEqual(12)
    expect(opens).toBeLessThanOrEqual(17)
  })

  /**
   * THE AGL-2945 measurement. A session-wide fault in a tab left open used to
   * cost ~1,800 opens an hour per listener, forever. It now backs off with
   * its age: ~70 in the first hour, then one every five minutes — and it
   * keeps asking, so the page still comes back on its own.
   */
  it('a session-wide fault backs off with its age to one open per 5 minutes, never stopping', () => {
    mount()
    const firstHour = measureOpens(HOUR_MS)
    expect(firstHour).toBeGreaterThan(55)
    expect(firstHour).toBeLessThan(85)

    const secondHour = measureOpens(HOUR_MS) - firstHour
    expect(secondHour).toBeGreaterThanOrEqual(10)
    expect(secondHour).toBeLessThanOrEqual(14)

    const waited = waitForNextOpen(REFUSED_RETRY_CEILING_MS + 1000)
    expect(waited).toBeGreaterThan(0)
    expect(waited).toBeLessThanOrEqual(REFUSED_RETRY_CEILING_MS + 100)
  })

  /**
   * A rules-denied listener in a session that demonstrably reads — the
   * AGL-1440 shape: console chrome served normally, one bad ref. It starts at
   * 60s rather than 2s, then backs off with its age the same way.
   */
  it('a rules denial in a healthy session costs ~35 opens in its first hour, then 12', () => {
    mount()
    serverAnswersAnotherListener()

    const firstHour = measureOpens(HOUR_MS)
    expect(firstHour).toBeGreaterThan(27)
    expect(firstHour).toBeLessThan(43)

    const secondHour = measureOpens(HOUR_MS) - firstHour
    expect(secondHour).toBeGreaterThanOrEqual(10)
    expect(secondHour).toBeLessThanOrEqual(14)
  })

  /**
   * Stale evidence must not count. A server answer from BEFORE this streak
   * began says nothing about why THIS listen is refused now — the session
   * may have died in between, and the safe direction is the session floor.
   */
  it('evidence from before the streak began keeps the 2s floor', () => {
    act(() => {
      reportFirestoreServerRead()
      jest.advanceTimersByTime(1)
    })
    mount()
    expect(measureOpens(20_000)).toBeGreaterThanOrEqual(12)
  })

  /**
   * The heal broadcast must stay instant at any cadence. Backing off is safe
   * precisely because a resolved AGL-664 re-auth does not wait for the next
   * tick of anything.
   */
  it('a heal broadcast reopens immediately even at the slow cadence', () => {
    mount()
    serverAnswersAnotherListener()
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
   * Evidence arriving MID-streak raises the floor from the next retry — the
   * policy is consulted per retry, not frozen at the first refusal. This is
   * the AGL-1143 SSO shape: everything denied at first, then the session
   * heals for most listens, and the refs that stay denied must stop paying 2s.
   */
  it('evidence arriving mid-streak slows the loop from the next retry', () => {
    mount()
    // Budget spent with no evidence: the 2s session floor is in force.
    measureOpens(FAST_BUDGET_MS)

    act(() => reportFirestoreServerRead())
    // The pending 2s timer predates the evidence; let it fire and refuse it
    // — the retry IT schedules is the first to consult the policy with the
    // evidence on record.
    expect(
      waitForNextOpen(SESSION_REFUSED_RETRY_DELAY_MS * 2),
    ).toBeGreaterThan(0)
    act(() => denyPending())

    // The next reopen arrives on the rules floor: after far more than a
    // session window, within one 60s window. Slowed, not stopped.
    const waited = waitForNextOpen(
      RULES_REFUSED_RETRY_DELAY_MS + SESSION_REFUSED_RETRY_DELAY_MS,
    )
    expect(waited).toBeGreaterThan(RULES_REFUSED_RETRY_DELAY_MS - 500)
    expect(waited).toBeLessThanOrEqual(RULES_REFUSED_RETRY_DELAY_MS + 500)
  })

  /**
   * Put a session-wide fault well into its backoff, then stand at a known
   * phase: the latest open has just been refused and a long reopen is
   * pending. Returns the open count at that moment.
   */
  const backOffForHalfAnHour = (): number => {
    measureOpens(HOUR_MS / 2)
    expect(waitForNextOpen(REFUSED_RETRY_CEILING_MS + 1000)).toBeGreaterThan(0)
    act(() => denyPending())
    return mockHandlers.length
  }

  /**
   * A person coming back to the window is the recovery the old 2s timer was
   * standing in for. Focus reopens a backed-off listen at once, instead of
   * leaving them in front of a refused page for minutes.
   */
  it('the window regaining focus reopens a backed-off listen at once', () => {
    mount()
    const opened = backOffForHalfAnHour()

    act(() => jest.advanceTimersByTime(SESSION_REFUSED_RETRY_DELAY_MS + 100))
    expect(mockHandlers).toHaveLength(opened)

    act(() => focusWindow())
    expect(mockHandlers).toHaveLength(opened + 1)
  })

  /**
   * Arrivals are held to one reopen, no sooner than 2s after the refusal
   * that scheduled it — so a window flickering between focus and blur can
   * never run the loop faster than the fixed cadence this replaced.
   */
  it('focus churn earns one reopen, no sooner than 2s after the refusal', () => {
    mount()
    const opened = backOffForHalfAnHour()

    act(() => {
      for (let i = 0; i < 10; i += 1) {
        focusWindow()
        jest.advanceTimersByTime(150)
      }
    })
    expect(mockHandlers).toHaveLength(opened)

    act(() => jest.advanceTimersByTime(SESSION_REFUSED_RETRY_DELAY_MS))
    expect(mockHandlers).toHaveLength(opened + 1)

    act(() => {
      focusWindow()
      focusWindow()
    })
    expect(mockHandlers).toHaveLength(opened + 1)
  })

  /**
   * Hide a tab whose session-wide fault has a 2s reopen pending. Returns the
   * open count at that point: every open after it is one the hidden tab paid.
   */
  const hideRefusedTab = (): number => {
    measureOpens(FAST_BUDGET_MS)
    act(() => setVisibility('hidden'))
    return mockHandlers.length
  }

  /**
   * THE AGL-2944 measurement. A dead session in a tab nobody is looking at
   * used to reopen every listener every 2s for as long as the tab stayed
   * open. Hidden — including a reopen that was already pending when it hid —
   * it reopens nothing; the moment it is visible it reopens at once. If the
   * session is still refused, the hour it spent hidden counts toward the
   * backoff: the next reopen waits the five-minute ceiling.
   */
  it('a hidden tab reopens nothing until it is visible, then reopens at once', () => {
    mount()
    const opened = hideRefusedTab()

    measureOpens(HOUR_MS)
    expect(mockHandlers).toHaveLength(opened)

    act(() => setVisibility('visible'))
    expect(mockHandlers).toHaveLength(opened + 1)

    act(() => denyPending())
    const waited = waitForNextOpen(REFUSED_RETRY_CEILING_MS + 1000)
    expect(waited).toBeGreaterThan(REFUSED_RETRY_CEILING_MS - 1000)
    expect(waited).toBeLessThanOrEqual(REFUSED_RETRY_CEILING_MS + 100)
  })

  /**
   * A resolved re-auth does not wait for anyone to look: the heal broadcast
   * reopens a hidden tab immediately, and the visibility wait it replaced is
   * gone — becoming visible afterwards does not open a second listen.
   */
  it('the heal broadcast reopens a hidden tab at once, and only once', () => {
    mount()
    const opened = hideRefusedTab()

    act(() => reportFirestoreSessionHeal())
    expect(mockHandlers).toHaveLength(opened + 1)

    act(() => setVisibility('visible'))
    expect(mockHandlers).toHaveLength(opened + 1)
  })

  /** An unmounted hook leaves no wake behind to reopen it. */
  it('an unmounted hook does not reopen when its tab becomes visible or focused', () => {
    const { unmount } = mount()
    const opened = hideRefusedTab()

    unmount()
    act(() => {
      setVisibility('visible')
      focusWindow()
    })
    expect(mockHandlers).toHaveLength(opened)
  })
})
