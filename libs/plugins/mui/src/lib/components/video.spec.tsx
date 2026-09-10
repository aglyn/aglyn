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
import { render } from '@testing-library/react'
import { renderToString } from 'react-dom/server'
import Video, {
  isoDuration,
  posterSrc,
  resolveVideoPreload,
  schema,
} from './video'

const CDN = '/api/media/cdn'

const video = (element: JSX.Element) =>
  render(element).container.querySelector('video') as HTMLVideoElement

describe('Video element shape', () => {
  it('is flagged self-closing so renderers never pass it children', () => {
    expect(
      Boolean((schema.flags?.selfClosing ?? 0) & Aglyn.FEATURE_FLAG.ENABLED),
    ).toBe(true)
  })

  it('server-renders with a src without throwing', () => {
    expect(() =>
      renderToString(<Video src="https://example.com/a.mp4" />),
    ).not.toThrow()
  })

  it('renders the placeholder when src is empty', () => {
    const { getByText } = render(<Video />)
    expect(getByText(/set a source URL/i)).toBeTruthy()
  })

  it('drops children a renderer leaks rather than putting them beside the track', () => {
    const props = {
      src: 'https://example.com/a.mp4',
      children: [undefined, false],
    } as React.ComponentProps<typeof Video>
    expect(() => renderToString(<Video {...props} />)).not.toThrow()
  })
})

describe('Video downloads nothing before it is asked to (AGL-2741)', () => {
  it('preloads NOTHING when a poster carries the first paint', () => {
    expect(
      video(
        <Video src="https://x/a.mp4" poster="https://x/a.png" />,
      ).getAttribute('preload'),
    ).toBe('none')
  })

  it('keeps preloading metadata when there is no poster', () => {
    // Deferring an unpostered video trades a transfer for a black rectangle,
    // and `metadata` is also what every document authored before this
    // rendered — which is what makes the change safe for published sites.
    expect(video(<Video src="https://x/a.mp4" />).getAttribute('preload')).toBe(
      'metadata',
    )
  })

  it('lets an author override the default in either direction', () => {
    expect(
      video(
        <Video src="https://x/a.mp4" poster="https://x/a.png" preload="auto" />,
      ).getAttribute('preload'),
    ).toBe('auto')
    expect(
      video(<Video src="https://x/a.mp4" preload="none" />).getAttribute(
        'preload',
      ),
    ).toBe('none')
  })

  it('never starves an autoplaying video of the bytes it needs', () => {
    expect(
      resolveVideoPreload({ poster: 'x.png', autoPlay: true }),
    ).toBe('auto')
  })

  it('ignores a preload value that is not one of the three', () => {
    // `cleared-props-bundle` clears every declared attribute to null, and a
    // null that fell through to the DOM would emit `preload="null"`.
    expect(resolveVideoPreload({ preload: null, poster: 'x.png' })).toBe('none')
    expect(resolveVideoPreload({ preload: 'sometimes' })).toBe('metadata')
  })
})

describe('Video poster resolution (AGL-1215, AGL-2741)', () => {
  it('resolves a media reference and asks for the WebP variant', () => {
    const url = posterSrc('media:host1/abc')
    expect(url).toBe(`${CDN}/host1/abc?w=1280`)
  })

  it('leaves an off-site poster exactly as the author typed it', () => {
    // A hotlinked poster has no variants and no `?w=` handler behind it;
    // appending one would be a query string on somebody else's server.
    expect(posterSrc('https://example.com/still.jpg')).toBe(
      'https://example.com/still.jpg',
    )
  })

  it('renders the resolved poster on the element', () => {
    const element = video(<Video src="https://x/a.mp4" poster="media:h/p" />)
    expect(element.getAttribute('poster')).toBe(`${CDN}/h/p?w=1280`)
  })

  it('yields nothing for a blank poster', () => {
    expect(posterSrc(undefined)).toBeUndefined()
    expect(posterSrc('')).toBeUndefined()
  })
})

describe('Video reserves its box before any byte arrives (AGL-2741)', () => {
  const styleOf = (element: JSX.Element) =>
    getComputedStyle(video(element))

  it('turns the intrinsic pair into an aspect ratio', () => {
    // Whitespace-insensitive: jsdom serializes the shorthand without spaces
    // and a browser keeps them, and neither spelling is the thing under test.
    expect(
      styleOf(
        <Video src="https://x/a.mp4" intrinsicWidth={1920} intrinsicHeight={1080} />,
      ).aspectRatio.replace(/\s+/g, ''),
    ).toBe('1920/1080')
  })

  it('refuses a lone dimension, which describes no shape at all', () => {
    expect(
      styleOf(<Video src="https://x/a.mp4" intrinsicWidth={1920} />).aspectRatio,
    ).toBeFalsy()
  })

  it('refuses a zero capture rather than collapsing the element', () => {
    expect(
      styleOf(
        <Video src="https://x/a.mp4" intrinsicWidth={0} intrinsicHeight={0} />,
      ).aspectRatio,
    ).toBeFalsy()
  })

  it('stands down when the author pinned a height', () => {
    expect(
      styleOf(
        <Video
          src="https://x/a.mp4"
          height="360px"
          intrinsicWidth={1920}
          intrinsicHeight={1080}
        />,
      ).aspectRatio,
    ).toBeFalsy()
  })
})

describe('Video captions', () => {
  it('attaches a default captions track when a file is set', () => {
    const track = render(
      <Video
        src="https://x/a.mp4"
        captionsSrc="media:h/vtt"
        captionsLabel="English"
        captionsLang="en"
      />,
    ).container.querySelector('track') as HTMLTrackElement
    expect(track.getAttribute('src')).toBe(`${CDN}/h/vtt`)
    expect(track.getAttribute('kind')).toBe('captions')
    expect(track.getAttribute('srclang')).toBe('en')
    expect(track.getAttribute('label')).toBe('English')
    expect(track.hasAttribute('default')).toBe(true)
  })

  it('renders no track at all without a file', () => {
    expect(
      render(<Video src="https://x/a.mp4" />).container.querySelector('track'),
    ).toBeNull()
  })
})

describe('Video structured-data fields never reach the DOM', () => {
  it('keeps description, upload date and duration off the element', () => {
    // Anything not destructured lands in `...rest` and is spread onto the
    // `<video>`, where it becomes an invalid attribute in published HTML.
    const element = video(
      <Video
        src="https://x/a.mp4"
        title="The film"
        description="What it shows"
        uploadDate="2026-09-01"
        durationSeconds={63}
      />,
    )
    expect(element.hasAttribute('description')).toBe(false)
    expect(element.hasAttribute('uploaddate')).toBe(false)
    expect(element.hasAttribute('durationseconds')).toBe(false)
    // The title is the one that DOES belong there — it is the player's
    // accessible name as well as the schema's.
    expect(element.getAttribute('title')).toBe('The film')
  })
})

describe('isoDuration', () => {
  it('writes seconds, minutes and hours the way schema.org reads them', () => {
    expect(isoDuration(63)).toBe('PT1M3S')
    expect(isoDuration(60)).toBe('PT1M')
    expect(isoDuration(45)).toBe('PT45S')
    expect(isoDuration(3600)).toBe('PT1H')
    expect(isoDuration(3725)).toBe('PT1H2M5S')
  })

  it('declines anything that is not a positive running time', () => {
    // An absent duration is omitted from the schema; `PT0S` would be a claim
    // that the film is zero seconds long, which nobody meant to make.
    expect(isoDuration(0)).toBeUndefined()
    expect(isoDuration(-5)).toBeUndefined()
    expect(isoDuration(undefined)).toBeUndefined()
    expect(isoDuration('63')).toBeUndefined()
    expect(isoDuration(Number.NaN)).toBeUndefined()
  })
})
