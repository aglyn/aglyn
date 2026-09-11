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
 *
 * @jest-environment jsdom
 * @jest-environment-options {"url": "https://customer.example/"}
 */

/**
 * A played film reports its plays (AGL-2781).
 *
 * `/api/analytics/collect` counts `plays`, three quartiles and `completes`
 * per asset, and `sendVideoAnalyticsBeacon` is the one door onto it. These
 * cases assert what the PLAYER sends through that door: how many beacons,
 * for which events, and from which surfaces none at all.
 *
 * The URL pragma and the production environment below are what let a beacon
 * leave at all — `sendAnalyticsBeacon` refuses a loopback document and every
 * non-production build, so without them each "sends nothing" case would pass
 * for the wrong reason. The last describe block is that gate, kept honest.
 */

import * as Aglyn from '@aglyn/aglyn'
import { act, fireEvent, getByRole, render } from '@testing-library/react'
import Video from './video'
import { VideoLightbox } from './video-lightbox'

let beacons: Record<string, unknown>[]

const mutableEnv = process.env as Record<string, string | undefined>
const savedEnv = {
  nodeEnv: process.env.NODE_ENV,
  deployEnv: process.env.NEXT_PUBLIC_DEPLOY_ENV,
}

beforeEach(() => {
  beacons = []
  mutableEnv.NODE_ENV = 'production'
  process.env.NEXT_PUBLIC_DEPLOY_ENV = 'production'
  Object.defineProperty(navigator, 'sendBeacon', {
    configurable: true,
    writable: true,
    value: (_url: string, body: string) => {
      beacons.push(JSON.parse(body))
      return true
    },
  })
})

afterEach(() => {
  mutableEnv.NODE_ENV = savedEnv.nodeEnv
  if (savedEnv.deployEnv === undefined) delete process.env.NEXT_PUBLIC_DEPLOY_ENV
  else process.env.NEXT_PUBLIC_DEPLOY_ENV = savedEnv.deployEnv
})

/** A live page: a site, and no editing surface unless a case says so. */
const onSite = (
  element: JSX.Element,
  options: { hostId?: string; suppressNavigation?: boolean } = {},
) => (
  <Aglyn.SiteContext.Provider
    value={{ hostId: 'hostId' in options ? options.hostId : 'host-1' } as never}
  >
    <Aglyn.ScreenLinkContext.Provider
      value={{ screens: {}, suppressNavigation: options.suppressNavigation }}
    >
      {element}
    </Aglyn.ScreenLinkContext.Provider>
  </Aglyn.SiteContext.Provider>
)

/**
 * jsdom implements no media pipeline: `duration` is NaN and `currentTime`
 * cannot move. The playhead is supplied here so a `timeupdate` carries a
 * position the way a browser's does.
 */
const scrubbable = (video: HTMLVideoElement, durationSeconds: number) => {
  let position = 0
  Object.defineProperty(video, 'duration', {
    configurable: true,
    get: () => durationSeconds,
  })
  Object.defineProperty(video, 'currentTime', {
    configurable: true,
    get: () => position,
    set: (value: number) => {
      position = value
    },
  })
  return (seconds: number) => {
    position = seconds
    fireEvent.timeUpdate(video)
  }
}

const events = () => beacons.map((body) => body['video'])

describe('the inline player counts a play (AGL-2781)', () => {
  const inline = (src = 'media:host-1/film', options = {}) =>
    render(onSite(<Video src={src} />, options)).container.querySelector(
      'video',
    ) as HTMLVideoElement

  it('reports one play naming the site and the asset', () => {
    fireEvent.play(inline())
    expect(beacons).toEqual([
      { hostId: 'host-1', mediaId: 'film', video: 'play' },
    ])
  })

  it('does not count a resume after a pause as another play', () => {
    const video = inline()
    fireEvent.play(video)
    fireEvent.pause(video)
    fireEvent.play(video)
    expect(events()).toEqual(['play'])
  })

  it('reports each quartile once, and nothing again after seeking back', () => {
    const video = inline()
    const to = scrubbable(video, 100)
    fireEvent.play(video)
    to(10)
    to(26)
    to(27)
    // Back before the first quartile and through it again: the watch curve
    // asks where people STOP, so a rewatched stretch is not a second crossing.
    to(5)
    to(30)
    to(51)
    to(76)
    expect(events()).toEqual(['play', 'progress25', 'progress50', 'progress75'])
  })

  it('reports a completion on ended, and a replay as a new play', () => {
    const video = inline()
    fireEvent.play(video)
    fireEvent.ended(video)
    fireEvent.play(video)
    expect(events()).toEqual(['play', 'complete', 'play'])
  })

  it('counts a pinned reference against its asset, not its hash', () => {
    fireEvent.play(inline('media:host-1/film@abc123'))
    expect(beacons[0]).toMatchObject({ mediaId: 'film' })
  })

  it('counts a CDN path written before references existed', () => {
    fireEvent.play(inline('/api/media/cdn/host-1/film'))
    expect(beacons[0]).toMatchObject({ mediaId: 'film' })
  })

  it('reports nothing for a hotlinked film, which names no asset', () => {
    fireEvent.play(inline('https://videos.example.com/film.mp4'))
    expect(beacons).toEqual([])
  })

  it('reports nothing on an editing surface', () => {
    fireEvent.play(inline('media:host-1/film', { suppressNavigation: true }))
    expect(beacons).toEqual([])
  })

  it('reports nothing without a site', () => {
    fireEvent.play(inline('media:host-1/film', { hostId: undefined }))
    expect(beacons).toEqual([])
  })
})

describe('the lightbox player counts a play (AGL-2781)', () => {
  const playback = { hostId: 'host-1', src: 'media:host-1/film' }

  it('reports a play from the dialog player', () => {
    const { baseElement } = render(
      <VideoLightbox
        open
        onClose={() => undefined}
        src="/api/media/cdn/host-1/film?r=auto"
        playback={playback}
      />,
    )
    fireEvent.play(baseElement.querySelector('video') as HTMLVideoElement)
    expect(beacons).toEqual([
      { hostId: 'host-1', mediaId: 'film', video: 'play' },
    ])
  })

  it('counts each open that is played, and not the resumes inside one', () => {
    const view = (open: boolean) => (
      <VideoLightbox
        open={open}
        onClose={() => undefined}
        src="/api/media/cdn/host-1/film?r=auto"
        playback={playback}
      />
    )
    const { baseElement, rerender } = render(view(true))
    const first = baseElement.querySelector('video') as HTMLVideoElement
    fireEvent.play(first)
    fireEvent.pause(first)
    fireEvent.play(first)
    act(() => rerender(view(false)))
    act(() => rerender(view(true)))
    fireEvent.play(baseElement.querySelector('video') as HTMLVideoElement)
    expect(events()).toEqual(['play', 'play'])
  })

  it("reports a play from the player's own play control, then its quartiles and completion (AGL-2802)", () => {
    // jsdom implements no playback: `play()` and `pause()` here do what a
    // browser's do as far as the page can see, which is flip `paused` and
    // fire the event.
    jest
      .spyOn(HTMLMediaElement.prototype, 'play')
      .mockImplementation(function (this: HTMLMediaElement) {
        Object.defineProperty(this, 'paused', { configurable: true, value: false })
        this.dispatchEvent(new Event('play'))
        return Promise.resolve()
      })
    jest
      .spyOn(HTMLMediaElement.prototype, 'pause')
      .mockImplementation(function (this: HTMLMediaElement) {
        Object.defineProperty(this, 'paused', { configurable: true, value: true })
        this.dispatchEvent(new Event('pause'))
      })
    try {
      const { baseElement } = render(
        <VideoLightbox
          open
          onClose={() => undefined}
          src="/api/media/cdn/host-1/film?r=auto"
          playback={playback}
        />,
      )
      const video = baseElement.querySelector('video') as HTMLVideoElement
      const to = scrubbable(video, 100)
      const control = getByRole(baseElement, 'button', { name: 'Play' })
      fireEvent.click(control)
      // Paused and resumed from the same control: still one viewing.
      fireEvent.click(control)
      fireEvent.click(control)
      to(26)
      to(51)
      to(76)
      fireEvent.ended(video)
      expect(events()).toEqual([
        'play',
        'progress25',
        'progress50',
        'progress75',
        'complete',
      ])
    } finally {
      jest.restoreAllMocks()
    }
  })

  it('reports nothing when the element says the surface is an editor', () => {
    const { baseElement } = render(
      <VideoLightbox
        open
        onClose={() => undefined}
        src="/api/media/cdn/host-1/film?r=auto"
        playback={{ ...playback, suppressed: true }}
      />,
    )
    fireEvent.play(baseElement.querySelector('video') as HTMLVideoElement)
    expect(beacons).toEqual([])
  })
})

describe('a play counts only where a pageview would', () => {
  it('reports nothing under next dev', () => {
    mutableEnv.NODE_ENV = 'development'
    fireEvent.play(
      render(onSite(<Video src="media:host-1/film" />)).container.querySelector(
        'video',
      ) as HTMLVideoElement,
    )
    expect(beacons).toEqual([])
  })
})
