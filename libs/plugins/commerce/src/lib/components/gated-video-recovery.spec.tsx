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
 * The members video outlives the links behind it (AGL-2814).
 *
 * Both links under a playing gated video expire: the stream link, and the
 * signed media session it redirects to. When a request under an expired one
 * fails, the browser raises a media error on the element and stops. Before
 * this, nothing handled that error, so a long sitting simply ended mid-film.
 *
 * jsdom has no media pipeline, so the element is put into the state a browser
 * reports after a failed request — `error.code`, `currentTime`, `paused` —
 * and the event is fired. What is asserted is everything the component does
 * about it: which endpoint it asks, what it does with the answer, and where
 * playback resumes.
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import GatedVideo from './gated-video'

const mockSiteFetch = jest.fn()

jest.mock('@aglyn/aglyn', () => ({
  ...jest.requireActual('@aglyn/aglyn'),
  useSite: () => ({ hostId: 'host-1' }),
  useSiteFetch: () => mockSiteFetch,
}))

/** A stream link, numbered so a test can tell one mint from the next. */
const link = (n: number) =>
  `/api/commerce/stream?hostId=host-1&productId=prod-course&video=0&exp=${n}&sig=s${n}`

const minted = (n: number) => ({
  ok: true,
  status: 200,
  json: async () => ({ url: link(n), expiresAtMs: n }),
})

const refused = (status: number) => ({
  ok: false,
  status,
  json: async () => ({ error: 'Not entitled' }),
})

const MEDIA_ERR_ABORTED = 1
const MEDIA_ERR_NETWORK = 2
const MEDIA_ERR_DECODE = 3
const MEDIA_ERR_SRC_NOT_SUPPORTED = 4

function videoOf(container: HTMLElement): HTMLVideoElement {
  const element = container.querySelector('video')
  if (!element) throw new Error('no video element rendered')
  return element
}

/** The element as a browser leaves it once a request under its link failed. */
function fail(
  element: HTMLVideoElement,
  code: number,
  options: { at?: number; paused?: boolean } = {},
) {
  Object.defineProperty(element, 'error', {
    configurable: true,
    value: { code },
  })
  Object.defineProperty(element, 'currentTime', {
    configurable: true,
    writable: true,
    value: options.at ?? 0,
  })
  Object.defineProperty(element, 'paused', {
    configurable: true,
    value: options.paused ?? false,
  })
  fireEvent.error(element)
}

/** A freshly loaded source: the element starts over at zero. */
function load(element: HTMLVideoElement) {
  Object.defineProperty(element, 'currentTime', {
    configurable: true,
    writable: true,
    value: 0,
  })
  fireEvent.loadedMetadata(element)
}

/** Playback reaching `seconds` on the current source. */
function playTo(element: HTMLVideoElement, seconds: number) {
  Object.defineProperty(element, 'currentTime', {
    configurable: true,
    writable: true,
    value: seconds,
  })
  fireEvent.timeUpdate(element)
}

let play: jest.SpyInstance

beforeEach(() => {
  mockSiteFetch.mockReset()
  window.localStorage.clear()
  play = jest
    .spyOn(HTMLMediaElement.prototype, 'play')
    .mockImplementation(() => Promise.resolve())
})

afterEach(() => {
  jest.restoreAllMocks()
})

async function renderPlaying() {
  const view = render(<GatedVideo productId="prod-course" />)
  await waitFor(() =>
    expect(videoOf(view.container).getAttribute('src')).toBe(link(1)),
  )
  return view
}

describe('AGL-2814 · a failed request under an expired link', () => {
  it('asks the stream endpoint for a new link and resumes at the second it stopped', async () => {
    mockSiteFetch
      .mockResolvedValueOnce(minted(1))
      .mockResolvedValueOnce(minted(2))
    const { container } = await renderPlaying()
    fireEvent.play(videoOf(container))

    fail(videoOf(container), MEDIA_ERR_NETWORK, { at: 1234 })

    await waitFor(() =>
      expect(videoOf(container).getAttribute('src')).toBe(link(2)),
    )
    // A POST to the stream endpoint, which is the call that re-checks the
    // member's entitlement before anything new is signed.
    expect(mockSiteFetch).toHaveBeenCalledTimes(2)
    expect(mockSiteFetch.mock.calls[1][0]).toBe('/api/commerce/stream')
    expect(mockSiteFetch.mock.calls[1][1]).toMatchObject({ method: 'POST' })
    expect(JSON.parse(mockSiteFetch.mock.calls[1][1].body)).toEqual({
      hostId: 'host-1',
      productId: 'prod-course',
      video: 0,
    })

    load(videoOf(container))
    expect(videoOf(container).currentTime).toBe(1234)
    expect(play).toHaveBeenCalledTimes(1)
  })

  it('recovers the same way when the first request under a link is refused', async () => {
    mockSiteFetch
      .mockResolvedValueOnce(minted(1))
      .mockResolvedValueOnce(minted(2))
    const { container } = await renderPlaying()
    fail(videoOf(container), MEDIA_ERR_SRC_NOT_SUPPORTED, { paused: true })
    await waitFor(() =>
      expect(videoOf(container).getAttribute('src')).toBe(link(2)),
    )
  })

  it('does not resume a video the viewer had paused', async () => {
    mockSiteFetch
      .mockResolvedValueOnce(minted(1))
      .mockResolvedValueOnce(minted(2))
    const { container } = await renderPlaying()
    fireEvent.play(videoOf(container))
    fireEvent.pause(videoOf(container))
    fail(videoOf(container), MEDIA_ERR_NETWORK, { at: 60, paused: true })
    await waitFor(() =>
      expect(videoOf(container).getAttribute('src')).toBe(link(2)),
    )
    load(videoOf(container))
    expect(videoOf(container).currentTime).toBe(60)
    expect(play).not.toHaveBeenCalled()
  })

  it('shows the lock when the re-check says the member is no longer entitled', async () => {
    mockSiteFetch
      .mockResolvedValueOnce(minted(1))
      .mockResolvedValueOnce(refused(403))
    const { container } = await renderPlaying()
    fail(videoOf(container), MEDIA_ERR_NETWORK, { at: 30 })
    expect(
      await screen.findByText('🔒 Sign in with an active subscription to watch'),
    ).toBeTruthy()
    expect(container.querySelector('video')).toBeNull()
  })

  it('⛔ does not ask again for an abort or a broken file', async () => {
    mockSiteFetch.mockResolvedValue(minted(1))
    const { container } = await renderPlaying()
    fail(videoOf(container), MEDIA_ERR_ABORTED)
    fail(videoOf(container), MEDIA_ERR_DECODE)
    await Promise.resolve()
    expect(mockSiteFetch).toHaveBeenCalledTimes(1)
    expect(videoOf(container).getAttribute('src')).toBe(link(1))
  })

  it('⛔ asks the viewer to reload rather than looping when new links keep failing', async () => {
    let next = 1
    mockSiteFetch.mockImplementation(async () => minted(next++))
    const { container } = await renderPlaying()
    fail(videoOf(container), MEDIA_ERR_NETWORK, { at: 10 })
    await waitFor(() =>
      expect(videoOf(container).getAttribute('src')).toBe(link(2)),
    )
    fail(videoOf(container), MEDIA_ERR_SRC_NOT_SUPPORTED)
    await waitFor(() =>
      expect(videoOf(container).getAttribute('src')).toBe(link(3)),
    )
    fail(videoOf(container), MEDIA_ERR_SRC_NOT_SUPPORTED)
    expect(
      await screen.findByText('Playback stopped. Reload the page to keep watching.'),
    ).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Reload' })).toBeTruthy()
    // The first link plus two recoveries, and nothing after the budget ran out.
    expect(mockSiteFetch).toHaveBeenCalledTimes(3)
  })

  it('recovers again hours later, once the previous recovery has played', async () => {
    let next = 1
    mockSiteFetch.mockImplementation(async () => minted(next++))
    const { container } = await renderPlaying()
    for (const [at, expected] of [
      [100, 2],
      [5000, 3],
      [9000, 4],
    ] as const) {
      fail(videoOf(container), MEDIA_ERR_NETWORK, { at })
      await waitFor(() =>
        expect(videoOf(container).getAttribute('src')).toBe(link(expected)),
      )
      load(videoOf(container))
      playTo(videoOf(container), at + 30)
    }
    expect(screen.queryByText(/Reload the page/)).toBeNull()
  })
})

describe('the first link', () => {
  it('still reads any refusal as the lock', async () => {
    mockSiteFetch.mockResolvedValueOnce(refused(500))
    render(<GatedVideo productId="prod-course" lockedText="Members only" />)
    expect(await screen.findByText('Members only')).toBeTruthy()
  })
})
