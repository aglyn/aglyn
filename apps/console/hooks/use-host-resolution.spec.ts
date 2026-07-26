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
import { renderHook, waitFor } from '@testing-library/react'
import useHostResolution, { type HostResolution } from './use-host-resolution'

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
  return { frames, ...view }
}

describe('useHostResolution (AGL-894)', () => {
  beforeEach(() => {
    mockGetDocs.mockReset()
    mockGetDocsFromServer.mockReset()
  })

  it('never reports a settled miss for a subdomain it has not resolved yet', async () => {
    // The projection read never settles during this test, so any `ready` seen
    // for "demo" can only have come from stale state, not from a real answer.
    mockGetDocs.mockReturnValue(new Promise(() => undefined))

    // Start OFF a host route (e.g. the staff console): ready, no host.
    const { frames, rerender } = renderRecording(null)
    expect(frames.at(-1)).toEqual({ hostId: null, ready: true, error: false })

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
      expect(result.current).toEqual({
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
      expect(result.current).toEqual({
        hostId: null,
        ready: true,
        error: false,
      }),
    )
  })

  it('resolves off a host route without touching Firestore', () => {
    const { result } = renderRecording(null)

    expect(result.current).toEqual({ hostId: null, ready: true, error: false })
    expect(mockGetDocs).not.toHaveBeenCalled()
  })
})
