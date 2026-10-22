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
 * AGL-3718: every host page sat on HostGuard's spinner while resolution asked
 * the server, and the answer was dropped whenever the route left the site, so
 * Site → Sites list → the same site paid the whole wait again. A projection
 * miss also paid two serial round trips.
 *
 * The cache is modeled as in the AGL-3596 spec: `getDocs` would name a
 * deleted site, and nothing here may ever read it.
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
const SITE = 'juniper-clay-studio'
const SITE_ID = 'ShncUPxyz1'

const snap = (docs: Array<{ id: string; data?: Record<string, unknown> }>) => ({
  empty: docs.length === 0,
  docs: docs.map((entry) => ({
    id: entry.id,
    get: (field: string) => entry.data?.[field],
  })),
})
const isProjection = (target: { path: string }) =>
  target.path.endsWith('/hostMemberships')
const offline = () =>
  Object.assign(new Error('Failed to get documents from server.'), {
    code: 'unavailable',
  })
const never = () => new Promise(() => undefined)

const RENDERED: Array<{ unmount: () => void }> = []

interface Props {
  subdomain: string | null
  orgId?: string
}

/** Records every frame, including pre-effect ones (see AGL-894's spec). */
function renderRecording(initial: Props) {
  const frames: HostResolution[] = []
  const view = renderHook(
    (props: Props) => {
      const result = useHostResolution(
        firestore,
        props.subdomain,
        UID,
        props.orgId ?? ORG,
      )
      frames.push(result)
      return result
    },
    { initialProps: initial },
  )
  RENDERED.push(view)
  return { frames, ...view }
}

/** Open the site once so the server has named it to this tab. */
async function openSiteOnce() {
  mockGetDocsFromServer.mockResolvedValue(snap([{ id: SITE_ID }]))
  const view = renderRecording({ subdomain: SITE })
  await waitFor(() => expect(view.result.current.hostId).toBe(SITE_ID))
  // Leave the site — the Sites list is a route with no `[host]`.
  view.rerender({ subdomain: null })
  await waitFor(() => expect(view.result.current.ready).toBe(true))
  mockGetDocsFromServer.mockReset()
  view.frames.length = 0
  return view
}

describe('useHostResolution re-entry (AGL-3718)', () => {
  beforeEach(() => {
    jest.useFakeTimers()
    mockGetDocs.mockReset()
    mockGetDocsFromServer.mockReset()
  })

  afterEach(() => {
    while (RENDERED.length) RENDERED.pop()?.unmount()
    jest.useRealTimers()
  })

  it('REGRESSION — coming back to a site the server already named renders at once', async () => {
    const view = await openSiteOnce()
    // The server is slow to answer the re-check; the page must not wait on it.
    mockGetDocsFromServer.mockImplementation(never)

    view.rerender({ subdomain: SITE })

    // Not one spinner frame: the very first render back on the site is ready.
    expect(view.frames.length).toBeGreaterThan(0)
    expect(
      view.frames.every((frame) => frame.ready && frame.hostId === SITE_ID),
    ).toBe(true)
    // Still re-asked the server, never the cache.
    expect(mockGetDocsFromServer).toHaveBeenCalled()
    expect(mockGetDocs).not.toHaveBeenCalled()
  })

  it('a re-check that names a different site replaces the remembered answer', async () => {
    const view = await openSiteOnce()
    mockGetDocsFromServer.mockResolvedValue(snap([{ id: 'recreated-id' }]))

    view.rerender({ subdomain: SITE })

    await waitFor(() => expect(view.result.current.hostId).toBe('recreated-id'))
  })

  it('a re-check that finds the site gone settles the miss the guard reports', async () => {
    const view = await openSiteOnce()
    mockGetDocsFromServer.mockResolvedValue(snap([]))

    view.rerender({ subdomain: SITE })

    await waitFor(() =>
      expect(view.result.current).toMatchObject({
        hostId: null,
        ready: true,
        error: false,
      }),
    )
  })

  it('a re-check that cannot reach the server keeps the page, without retrying or erroring', async () => {
    const view = await openSiteOnce()
    mockGetDocsFromServer.mockRejectedValue(offline())

    view.rerender({ subdomain: SITE })
    await act(async () => {
      await jest.advanceTimersByTimeAsync(60_000)
    })

    expect(view.result.current).toMatchObject({
      hostId: SITE_ID,
      ready: true,
      error: false,
    })
    // One pass (projection + authoritative), no backoff ladder behind it.
    expect(mockGetDocsFromServer).toHaveBeenCalledTimes(2)
  })

  it('retry() forgets every answer, so Try again and the gone-site recheck ask the server', async () => {
    const view = await openSiteOnce()
    mockGetDocsFromServer.mockResolvedValue(snap([{ id: SITE_ID }]))
    view.rerender({ subdomain: SITE })
    await waitFor(() => expect(view.result.current.hostId).toBe(SITE_ID))

    mockGetDocsFromServer.mockImplementation(never)
    view.frames.length = 0
    await act(async () => {
      view.result.current.retry()
    })

    // Back to the spinner until the server answers, as before AGL-3718.
    expect(view.result.current).toMatchObject({ hostId: null, ready: false })
  })

  it('an answer for one org is not used for another', async () => {
    const view = await openSiteOnce()
    mockGetDocsFromServer.mockImplementation(never)

    view.rerender({ subdomain: SITE, orgId: 'org-2' })

    expect(view.frames.some((frame) => frame.ready)).toBe(false)
    expect(view.frames.some((frame) => frame.hostId === SITE_ID)).toBe(false)
  })

  it('a projection miss does not wait for the projection before asking the authoritative query', async () => {
    let answerProjection: (value: unknown) => void = () => undefined
    mockGetDocsFromServer.mockImplementation((target: { path: string }) =>
      isProjection(target)
        ? new Promise((resolve) => {
            answerProjection = resolve
          })
        : Promise.resolve(snap([{ id: SITE_ID, data: { orgId: ORG } }])),
    )

    const { result } = renderRecording({ subdomain: SITE })

    // Both reads are in flight before the projection has said anything.
    expect(mockGetDocsFromServer).toHaveBeenCalledTimes(2)
    expect(result.current.ready).toBe(false)

    await act(async () => {
      answerProjection(snap([]))
    })
    await waitFor(() => expect(result.current.hostId).toBe(SITE_ID))
  })

  it('CONTROL — a first visit still holds the spinner for the server', () => {
    mockGetDocsFromServer.mockImplementation(never)

    const { frames } = renderRecording({ subdomain: SITE })

    expect(frames.every((frame) => !frame.ready && !frame.hostId)).toBe(true)
  })
})
