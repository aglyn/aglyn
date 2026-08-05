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
import { act, renderHook, waitFor } from '@testing-library/react'
import useHostResolution, {
  retryDelayMs,
  type HostResolution,
} from './use-host-resolution'

const mockGetDocs = jest.fn()
const mockGetDocsFromServer = jest.fn()

jest.mock('firebase/firestore', () => ({
  collection: () => ({}),
  query: () => ({}),
  where: () => ({}),
  limit: () => ({}),
  getDocs: (q: unknown) => mockGetDocs(q),
  getDocsFromServer: (q: unknown) => mockGetDocsFromServer(q),
}))

// A STABLE reference: the effect's deps include `firestore`.
const firestore = {} as never
const UID = 'uid-1'
const ORG = 'org-1'

const snap = (docs: Array<{ id: string; data?: Record<string, unknown> }>) => ({
  empty: docs.length === 0,
  docs: docs.map((d) => ({
    id: d.id,
    get: (field: string) => d.data?.[field],
  })),
})

/**
 * Render the hook while recording EVERY value it returns, including the render
 * frames that happen before effects flush. The AGL-894 bug lived entirely in
 * one such frame, so asserting only on the settled value cannot see it.
 */
function renderRecording(subdomain: string | null) {
  const frames: HostResolution[] = []
  const view = renderHook(
    (props: { subdomain: string | null }) => {
      const result = useHostResolution(firestore, props.subdomain, UID, ORG)
      frames.push(result)
      return result
    },
    { initialProps: { subdomain } },
  )
  RENDERED.push(view)
  return { frames, ...view }
}

/** Every hook rendered by a test, torn down in `afterEach`. */
const RENDERED: Array<{ unmount: () => void }> = []

/**
 * Drives the whole retry ladder to completion under fake timers.
 *
 * Shared so the two recovery tests below cannot drift apart, and because a
 * bare `advanceTimersByTimeAsync` inside each test let a FAILING test leave a
 * live hook and pending timers behind — the next test then failed on the
 * previous one's wreckage, which is exactly the cascade that makes a suite
 * impossible to read (AGL-1257 was a whole issue about that confusion).
 */
async function exhaustRetries() {
  await act(async () => {
    await jest.advanceTimersByTimeAsync(60_000)
  })
}

describe('useHostResolution (AGL-894)', () => {
  beforeEach(() => {
    mockGetDocs.mockReset()
    mockGetDocsFromServer.mockReset()
    jest.useFakeTimers()
  })

  afterEach(() => {
    // Unmount FIRST: tearing a hook down while its retry timers are pending
    // is what stops one test's in-flight work reaching the next.
    while (RENDERED.length) RENDERED.pop()?.unmount()
    jest.useRealTimers()
  })

  it('never reports a settled miss for a subdomain it has not resolved yet', async () => {
    // The projection read never settles during this test, so any `ready` seen
    // for "demo" can only have come from stale state, not from a real answer.
    mockGetDocs.mockReturnValue(new Promise(() => undefined))

    // Start OFF a host route (e.g. the staff console): ready, no host.
    const { frames, rerender } = renderRecording(null)
    expect(frames.at(-1)).toMatchObject({
      hostId: null,
      ready: true,
      error: false,
    })

    // Client-side navigation onto a host route — what picking a site in the
    // switcher does. Guards must see a spinner, never `ready` without a host.
    frames.length = 0
    rerender({ subdomain: 'demo' })

    // `ready && !hostId` is precisely the shape HostGuard turns into a 404.
    expect(
      frames.filter((frame) => frame.ready && !frame.hostId),
    ).toHaveLength(0)
    expect(frames.every((frame) => frame.error === false)).toBe(true)
  })

  it('resolves the host id from the membership projection', async () => {
    mockGetDocs.mockResolvedValue(snap([{ id: 'host-1' }]))

    const { result } = renderRecording('demo')

    await waitFor(() =>
      expect(result.current).toMatchObject({
        hostId: 'host-1',
        ready: true,
        error: false,
      }),
    )
  })

  it('drops a previous host id the moment the subdomain changes', async () => {
    mockGetDocs.mockResolvedValue(snap([{ id: 'host-1' }]))
    const { result, frames, rerender } = renderRecording('demo')
    await waitFor(() => expect(result.current.hostId).toBe('host-1'))

    // Switching sites must not leave the old host id addressable for a render:
    // consumers build Firestore refs from it and would read the wrong site.
    mockGetDocs.mockReturnValue(new Promise(() => undefined))
    frames.length = 0
    rerender({ subdomain: 'other-site' })

    expect(frames.some((frame) => frame.hostId === 'host-1')).toBe(false)
    expect(frames.filter((frame) => frame.ready)).toHaveLength(0)
  })

  it('settles a real miss so the guard can 404 an unknown subdomain', async () => {
    // Projection empty, authoritative empty, server confirm empty (AGL-813).
    mockGetDocs.mockResolvedValue(snap([]))
    mockGetDocsFromServer.mockResolvedValue(snap([]))

    const { result } = renderRecording('nope')

    await waitFor(() =>
      expect(result.current).toMatchObject({
        hostId: null,
        ready: true,
        error: false,
      }),
    )
  })

  it('resolves off a host route without touching Firestore', () => {
    const { result } = renderRecording(null)

    expect(result.current).toMatchObject({
      hostId: null,
      ready: true,
      error: false,
    })
    expect(mockGetDocs).not.toHaveBeenCalled()
  })

  /**
   * AGL-1200: a cold load of an `(editor)` deep link showed "Couldn't load
   * this workspace's sites", and Try again reloaded into the identical
   * failure — permanently. The same URL reached by in-app navigation worked.
   *
   * Two defects, and the second is the one that made it permanent:
   *
   * 1. the retry budget was flat 400 ms × 8, spending every attempt inside
   *    the first 3.2 s of page load — exactly when a cold Firestore
   *    connection makes `getDocsFromServer` throw `unavailable`, and longer
   *    on a heavy route like the besigner;
   * 2. `error` was terminal. The effect's deps do not change once it latches,
   *    so nothing re-ran, and the guard's recovery action was a full page
   *    reload — which recreates the cold-load conditions it is recovering
   *    from.
   */
  describe('cold-load recovery (AGL-1200)', () => {
    it('spreads retries over a cold start instead of spending them all at once', () => {
      // The flat schedule this replaces covered 3.2 s in nine requests. The
      // point is a WIDER window with FEWER requests: what is being waited on
      // is a warm-up, not a coin flip, so hammering buys nothing.
      const schedule = [0, 1, 2, 3, 4, 5].map(retryDelayMs)
      expect(schedule).toEqual([400, 800, 1600, 3200, 3200, 3200])

      // 12.4 s, against the 3.2 s the flat schedule covered.
      const budget = schedule.reduce((total, delay) => total + delay, 0)
      expect(budget).toBe(12_400)
      expect(budget).toBeGreaterThan(3 * 3200)
      // The cap matters as much as the growth: unbounded doubling would put
      // the last attempt minutes out, behind a spinner.
      expect(Math.max(...schedule)).toBe(3200)
    })

    it('REGRESSION — retry() re-runs resolution and clears the error', async () => {
      // Every read fails, the way a cold connection does.
      mockGetDocs.mockRejectedValue(new Error('unavailable'))
      mockGetDocsFromServer.mockRejectedValue(new Error('unavailable'))

      const { result } = renderRecording('demo')
      await exhaustRetries()
      expect(result.current).toMatchObject({ error: true, ready: true })

      // The connection comes up — which is what actually happens a second or
      // two later. Before the fix nothing re-read: the deps were unchanged
      // and Try again reloaded the page instead.
      mockGetDocs.mockResolvedValue(snap([{ id: 'host-1' }]))
      await act(async () => {
        result.current.retry()
      })
      await exhaustRetries()

      expect(result.current).toMatchObject({
        hostId: 'host-1',
        ready: true,
        error: false,
      })
    })

    it('CONTROL — retry() surfaces a still-failing read as an error again', async () => {
      // Without this, a `retry` that simply cleared the flag would pass the
      // test above while leaving the user on a broken page that claims to be
      // fine.
      mockGetDocs.mockRejectedValue(new Error('unavailable'))
      mockGetDocsFromServer.mockRejectedValue(new Error('unavailable'))

      const { result } = renderRecording('demo')
      await exhaustRetries()
      expect(result.current.error).toBe(true)

      await act(async () => {
        result.current.retry()
      })
      await exhaustRetries()

      expect(result.current.error).toBe(true)
      expect(result.current.hostId).toBeNull()
    })

    it('keeps retry stable across renders so a button handler does not churn', () => {
      mockGetDocs.mockReturnValue(new Promise(() => undefined))
      const { result, rerender } = renderRecording('demo')
      const first = result.current.retry
      rerender({ subdomain: 'demo' })
      expect(result.current.retry).toBe(first)
    })
  })
})
