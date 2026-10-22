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
 * AGL-3596: a DELETED site rendered in the console from the browser's cache.
 *
 * Reported from production after a hard refresh: the first site with a
 * subdomain was deleted, a second site took the same subdomain and was
 * deleted too, and `/…/hosts/<subdomain>/screens`, `/layouts` and `/ai-jobs`
 * all still rendered the FIRST site's id — its cached layout listed, a red
 * refusal toast over it, and AI jobs spinning forever. Server-side every
 * document involved was gone, so the subdomain → id answer could only have
 * come from the persistent IndexedDB cache.
 *
 * The cache here is modeled as a real second source: `getDocs` answers from
 * it (the deleted site, always), `getDocsFromServer` answers from the server
 * (whatever each test says). An implementation that reads the cache for any
 * part of the answer shows up as the deleted id in some frame.
 */
import { act, renderHook, waitFor } from '@testing-library/react'
import useHostResolution, { type HostResolution } from './use-host-resolution'

const mockGetDocs = jest.fn()
const mockGetDocsFromServer = jest.fn()

jest.mock('firebase/firestore', () => ({
  collection: (_firestore: unknown, ...segments: string[]) => ({
    path: segments.join('/'),
  }),
  query: (target: { path: string }) => target,
  where: () => ({}),
  limit: () => ({}),
  getDocs: (target: { path: string }) => mockGetDocs(target),
  getDocsFromServer: (target: { path: string }) =>
    mockGetDocsFromServer(target),
}))

const firestore = {} as never
const UID = 'uid-1'
const ORG = 'org-1'
const SUBDOMAIN = 'hillside-dog-grooming'
/** The first site with the subdomain, deleted — what the cache still names. */
const DELETED_ID = '3n8xbujR3b'
/** A site created on the same subdomain after the deletion. */
const NEW_ID = 'k7QpX2mLs9'

const snap = (docs: Array<{ id: string; data?: Record<string, unknown> }>) => ({
  empty: docs.length === 0,
  docs: docs.map((entry) => ({
    id: entry.id,
    get: (field: string) => entry.data?.[field],
  })),
})
const isProjection = (target: { path: string }) =>
  target.path.endsWith('/hostMemberships')
const denied = () =>
  Object.assign(new Error('Missing or insufficient permissions.'), {
    code: 'permission-denied',
  })
const offline = () =>
  Object.assign(new Error('Failed to get documents from server.'), {
    code: 'unavailable',
  })

/** The browser's cache: both reads still map the subdomain to the dead id. */
function cacheNamesTheDeletedSite() {
  mockGetDocs.mockImplementation(() =>
    Promise.resolve(snap([{ id: DELETED_ID, data: { orgId: ORG } }])),
  )
}

const RENDERED: Array<{ unmount: () => void }> = []

/** Records every frame, including pre-effect ones (see AGL-894's spec). */
function renderRecording() {
  const frames: HostResolution[] = []
  const view = renderHook(() => {
    const result = useHostResolution(firestore, SUBDOMAIN, UID, ORG)
    frames.push(result)
    return result
  })
  RENDERED.push(view)
  return { frames, ...view }
}

describe('useHostResolution answers from the server only (AGL-3596)', () => {
  beforeEach(() => {
    jest.useFakeTimers()
    mockGetDocs.mockReset()
    mockGetDocsFromServer.mockReset()
    cacheNamesTheDeletedSite()
  })

  afterEach(() => {
    while (RENDERED.length) RENDERED.pop()?.unmount()
    jest.useRealTimers()
  })

  it('holds the spinner while only the cache has answered', async () => {
    // The server has not answered yet; the cache answered instantly.
    mockGetDocsFromServer.mockReturnValue(new Promise(() => undefined))

    const { frames } = renderRecording()
    await act(async () => {
      await jest.advanceTimersByTimeAsync(5_000)
    })

    expect(frames.some((frame) => frame.hostId === DELETED_ID)).toBe(false)
    expect(frames.every((frame) => !frame.ready && !frame.hostId)).toBe(true)
    // The cache is not consulted at all — not even as a first guess.
    expect(mockGetDocs).not.toHaveBeenCalled()
  })

  it('REGRESSION — a site the server says is gone settles as a miss, never the cached id', async () => {
    // Server-side: the membership projection and the host are both deleted.
    mockGetDocsFromServer.mockResolvedValue(snap([]))

    const { result, frames } = renderRecording()

    await waitFor(() =>
      expect(result.current).toMatchObject({
        hostId: null,
        ready: true,
        error: false,
      }),
    )
    // `ready && !hostId && !error` is the guard's "This site doesn't exist
    // anymore". The deleted id never appears in between.
    expect(frames.some((frame) => frame.hostId === DELETED_ID)).toBe(false)
  })

  it('a refused projection read with no authoritative match is a miss too', async () => {
    // The rules refuse the membership read for a removed member; the
    // membership-scoped hosts query then finds nothing on the server.
    mockGetDocsFromServer.mockImplementation((target: { path: string }) =>
      isProjection(target) ? Promise.reject(denied()) : Promise.resolve(snap([])),
    )

    const { result, frames } = renderRecording()

    await waitFor(() =>
      expect(result.current).toMatchObject({
        hostId: null,
        ready: true,
        error: false,
      }),
    )
    expect(frames.some((frame) => frame.hostId === DELETED_ID)).toBe(false)
  })

  it('REGRESSION — a recreated subdomain resolves to the NEW site even with the old mapping cached', async () => {
    mockGetDocsFromServer.mockImplementation((target: { path: string }) =>
      Promise.resolve(
        isProjection(target)
          ? snap([{ id: NEW_ID }])
          : snap([{ id: NEW_ID, data: { orgId: ORG } }]),
      ),
    )

    const { result, frames } = renderRecording()

    await waitFor(() =>
      expect(result.current).toMatchObject({
        hostId: NEW_ID,
        ready: true,
        error: false,
      }),
    )
    // Not for a single frame: a page mounted against the old id opens
    // listeners on the deleted site, which is the toast storm.
    expect(frames.some((frame) => frame.hostId === DELETED_ID)).toBe(false)
  })

  it('a recreated legacy site with no projection resolves from the server hosts query', async () => {
    mockGetDocsFromServer.mockImplementation((target: { path: string }) =>
      Promise.resolve(
        isProjection(target)
          ? snap([])
          : snap([{ id: NEW_ID, data: { orgId: ORG } }]),
      ),
    )

    const { result, frames } = renderRecording()

    await waitFor(() => expect(result.current.hostId).toBe(NEW_ID))
    expect(frames.some((frame) => frame.hostId === DELETED_ID)).toBe(false)
  })

  it('offline: retries, then errors with no host — never falls back to the cache', async () => {
    mockGetDocsFromServer.mockRejectedValue(offline())

    const { result, frames } = renderRecording()
    await act(async () => {
      await jest.advanceTimersByTimeAsync(60_000)
    })

    // The guard's "Check your connection" + Try again, not the cached site.
    expect(result.current).toMatchObject({
      hostId: null,
      ready: true,
      error: true,
      authError: false,
    })
    expect(frames.some((frame) => frame.hostId === DELETED_ID)).toBe(false)
    expect(mockGetDocs).not.toHaveBeenCalled()
  })

  it('CONTROL — a live site still resolves (the fix is not "resolve nothing")', async () => {
    mockGetDocsFromServer.mockResolvedValue(snap([{ id: 'host-live' }]))
    mockGetDocs.mockResolvedValue(snap([{ id: 'host-live' }]))

    const { result } = renderRecording()

    await waitFor(() =>
      expect(result.current).toMatchObject({
        hostId: 'host-live',
        ready: true,
        error: false,
      }),
    )
  })
})
