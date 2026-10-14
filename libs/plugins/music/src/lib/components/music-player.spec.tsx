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

import * as Aglyn from '@aglyn/aglyn'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { renderToString } from 'react-dom/server'
import MusicPlayer, {
  ADD_YOUR_TRACKS,
  MusicTrack,
  TRACK_UNAVAILABLE,
  presets,
  schema,
  trackSchema,
} from './music-player'
import {
  formatTrackTime,
  isLibraryAudio,
  musicCoverSrc,
  musicTrackSource,
  trackLabel,
} from './music-sources'

const LIBRARY_TRACK = 'media:host1/track1'

/** A published page of site host1. */
const published = (element: JSX.Element) => (
  <Aglyn.SiteContext.Provider value={{ hostId: 'host1' } as never}>{element}</Aglyn.SiteContext.Provider>
)

/** The besigner canvas: authoring hints shown, nothing plays. */
const canvas = (element: JSX.Element) => (
  <Aglyn.SiteContext.Provider value={{ hostId: 'host1' } as never}>
    <Aglyn.ScreenLinkContext.Provider value={{ suppressNavigation: true, editorInert: true }}>
      {element}
    </Aglyn.ScreenLinkContext.Provider>
  </Aglyn.SiteContext.Provider>
)

beforeAll(() => {
  // jsdom implements no media playback.
  Object.defineProperty(HTMLMediaElement.prototype, 'play', {
    configurable: true,
    value: jest.fn(function (this: HTMLMediaElement) {
      this.dispatchEvent(new Event('play'))
      return Promise.resolve()
    }),
  })
  Object.defineProperty(HTMLMediaElement.prototype, 'pause', {
    configurable: true,
    value: jest.fn(function (this: HTMLMediaElement) {
      this.dispatchEvent(new Event('pause'))
    }),
  })
})

describe('music sources (AGL-3716)', () => {
  it('plays a library file as it is: its rights were confirmed at upload', () => {
    const source = musicTrackSource({ src: LIBRARY_TRACK }, { hostId: 'host1' })
    expect(source.state).toBe('ready')
    expect(source.state === 'ready' && source.url).toContain('/api/media/cdn/')
    expect(source.state === 'ready' && source.library).toBe(true)
    expect(isLibraryAudio('/api/media/cdn/org:acme/track1')).toBe(true)
  })

  it('refuses an external address until the author confirms the rights', () => {
    expect(musicTrackSource({ src: 'https://cdn.example.com/song.mp3' }).state).toBe('unconfirmed')
    expect(
      musicTrackSource({ src: 'https://cdn.example.com/song.mp3', rightsConfirmed: true }),
    ).toEqual({ state: 'ready', url: 'https://cdn.example.com/song.mp3', library: false })
  })

  it('treats anything but https or the library as no source at all', () => {
    for (const src of ['http://example.com/a.mp3', 'javascript:alert(1)', 'data:audio/mpeg;base64,AA', '/a.mp3', '']) {
      expect(musicTrackSource({ src, rightsConfirmed: true }).state).toBe('empty')
    }
  })

  it('formats times and names tracks', () => {
    expect(formatTrackTime(0)).toBe('0:00')
    expect(formatTrackTime(65.4)).toBe('1:05')
    expect(formatTrackTime(3725)).toBe('1:02:05')
    expect(formatTrackTime(Number.NaN)).toBe('0:00')
    expect(trackLabel({ title: 'Blue', artist: 'Ana' }, 0)).toBe('Blue by Ana')
    expect(trackLabel({}, 2)).toBe('Track 3')
    expect(musicCoverSrc('javascript:x')).toBeUndefined()
  })
})

describe('Music player schema (AGL-3716)', () => {
  it('narrows Browse media to audio for the source, images for the cover', () => {
    for (const declared of [schema, trackSchema]) {
      const src = declared.attributes?.find((field) => field.name === 'src')
      const image = declared.attributes?.find((field) => field.name === 'image')
      expect(src?.mediaKind).toBe('audio')
      expect(image?.mediaKind).toBe('image')
      expect(declared.attributes?.some((field) => field.name === 'rightsConfirmed')).toBe(true)
    }
  })

  it('takes only Track elements as children, and a Track only in a player', () => {
    expect(schema.restrictChildren?.[1]).toEqual({ components: ['musicTrack'] })
    expect(trackSchema.restrictParent?.[1]).toEqual({ components: ['musicPlayer'] })
  })

  it('ships no preset that sources audio', () => {
    const sources = JSON.stringify(presets)
    expect(sources).not.toMatch(/"src"/)
    expect(sources).not.toMatch(/rightsConfirmed/)
  })
})

describe('Music player renderer (AGL-3716)', () => {
  it('server-renders without throwing', () => {
    expect(() => renderToString(published(<MusicPlayer src={LIBRARY_TRACK} title="Blue" />))).not.toThrow()
  })

  it('asks the author for tracks on the canvas, and shows a visitor nothing', () => {
    render(canvas(<MusicPlayer />))
    expect(screen.getByText(ADD_YOUR_TRACKS)).toBeTruthy()
    const { container } = render(published(<MusicPlayer data-testid="empty" />))
    expect(container.textContent).toBe('')
  })

  it('plays a library track with its own controls and no download control', () => {
    const { container } = render(published(<MusicPlayer src={LIBRARY_TRACK} title="Blue" artist="Ana" />))
    const audio = container.querySelector('audio') as HTMLAudioElement
    expect(audio.getAttribute('src')).toContain('/api/media/cdn/')
    expect(audio.hasAttribute('controls')).toBe(false)
    expect(audio.getAttribute('controlslist')).toContain('nodownload')
    // Its context menu (Save audio as…) is refused.
    const menu = new MouseEvent('contextmenu', { bubbles: true, cancelable: true })
    audio.dispatchEvent(menu)
    expect(menu.defaultPrevented).toBe(true)
    expect(screen.queryByRole('button', { name: /download/i })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Play Blue by Ana' }))
    expect(screen.getByRole('button', { name: 'Pause Blue by Ana' })).toBeTruthy()
    expect(screen.getByRole('slider', { name: 'Seek Blue by Ana' })).toBeTruthy()
    expect(screen.getByRole('slider', { name: 'Volume' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Mute' }))
    expect(screen.getByRole('button', { name: 'Unmute' }).getAttribute('aria-pressed')).toBe('true')
  })

  it('says a track is unavailable when the CDN refuses it (a takedown answers 410)', () => {
    const { container } = render(published(<MusicPlayer src={LIBRARY_TRACK} title="Blue" />))
    const audio = container.querySelector('audio') as HTMLAudioElement
    act(() => {
      audio.dispatchEvent(new Event('error'))
    })
    expect(screen.getByRole('status').textContent).toBe(TRACK_UNAVAILABLE)
    expect(container.querySelector('audio')).toBeNull()
    expect((screen.getByRole('button', { name: /^Play Blue/ }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('plays an external address only once the element records the rights confirmation', () => {
    const external = 'https://cdn.example.com/song.mp3'
    const refused = render(published(<MusicPlayer src={external} title="Song" />))
    expect(refused.container.querySelector('audio')).toBeNull()
    expect(screen.getByRole('status').textContent).toBe(TRACK_UNAVAILABLE)
    refused.unmount()
    const { container } = render(published(<MusicPlayer src={external} title="Song" rightsConfirmed />))
    expect(container.querySelector('audio')?.getAttribute('src')).toBe(external)
  })

  it('tells the author on the canvas what an unconfirmed address needs, and plays nothing', () => {
    const { container } = render(canvas(<MusicPlayer src="https://cdn.example.com/song.mp3" />))
    expect(screen.getByRole('status').textContent).toMatch(/own this audio or have a license/)
    expect(container.querySelector('audio')).toBeNull()
  })

  it('plays a playlist of Track elements in page order, with previous and next', () => {
    const { container } = render(
      published(
        <MusicPlayer heading="First EP">
          <MusicTrack src="media:host1/a" title="One" />
          <MusicTrack src="media:host1/b" title="Two" />
        </MusicPlayer>,
      ),
    )
    expect(screen.getByRole('region', { name: 'First EP' })).toBeTruthy()
    expect(screen.getByRole('list', { name: 'First EP tracks' })).toBeTruthy()
    const audio = () => container.querySelector('audio') as HTMLAudioElement
    expect(audio().getAttribute('src')).toContain('/a')
    fireEvent.click(screen.getByRole('button', { name: 'Next track' }))
    expect(audio().getAttribute('src')).toContain('/b')
    expect(screen.getByRole('button', { name: 'Play Two' }).closest('li')?.getAttribute('aria-current')).toBe('true')
    fireEvent.click(screen.getByRole('button', { name: 'Previous track' }))
    expect(audio().getAttribute('src')).toContain('/a')
    fireEvent.click(screen.getByRole('button', { name: 'Play Two' }))
    expect(audio().getAttribute('src')).toContain('/b')
  })

  it('is inert on the canvas: nothing plays and no audio is fetched', () => {
    const { container } = render(canvas(<MusicPlayer src={LIBRARY_TRACK} title="Blue" />))
    expect(container.querySelector('audio')).toBeNull()
    expect((screen.getByRole('button', { name: 'Play Blue' }) as HTMLButtonElement).disabled).toBe(true)
  })
})
