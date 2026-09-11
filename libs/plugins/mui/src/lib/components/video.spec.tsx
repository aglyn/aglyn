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
import { visitorConsentStorageKey } from '@aglyn/aglyn/app-utils/visitor-consent'
import { fireEvent, render, screen } from '@testing-library/react'
import { renderToString } from 'react-dom/server'
import Video, { resolveVideoPreload, schema } from './video'

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
  it('renders the poster at the shared single-url variant width', () => {
    // The same width the page's `thumbnailUrl` asks for — a crawler that
    // fetched different bytes would be describing a different picture.
    const element = video(<Video src="https://x/a.mp4" poster="media:h/p" />)
    expect(element.getAttribute('poster')).toBe(
      `${CDN}/h/p?w=${Aglyn.MEDIA_CDN_POSTER_WIDTH}`,
    )
  })

  it('leaves an off-site poster exactly as the author typed it', () => {
    // A hotlinked poster has no variants and no `?w=` handler behind it;
    // appending one would be a query string on somebody else's server.
    expect(
      video(
        <Video src="https://x/a.mp4" poster="https://example.com/still.jpg" />,
      ).getAttribute('poster'),
    ).toBe('https://example.com/still.jpg')
  })

  it('renders no poster attribute at all without one', () => {
    expect(video(<Video src="https://x/a.mp4" />).hasAttribute('poster')).toBe(
      false,
    )
  })

  it('uses the frame the DAM generated when the node says there is one', () => {
    // The generated poster is not a separate asset — it is `?poster=1` on the
    // video's own reference (AGL-2749).
    expect(
      video(<Video src="media:h/film" posterFromSource />).getAttribute(
        'poster',
      ),
    ).toBe(`${CDN}/h/film?poster=1&w=${Aglyn.MEDIA_CDN_POSTER_WIDTH}`)
  })

  it('never derives a poster the node has not vouched for', () => {
    // `mediaPosterSrc` answers for any CDN reference and a video uploaded
    // before AGL-2742 answers 404 — which behind `<video poster>` is a blank
    // frame, and in an `<img>` is a broken image.
    expect(
      video(<Video src="media:h/film" />).hasAttribute('poster'),
    ).toBe(false)
  })

  it("keeps an author's own poster ahead of the generated one", () => {
    expect(
      video(
        <Video src="media:h/film" poster="media:h/mine" posterFromSource />,
      ).getAttribute('poster'),
    ).toBe(`${CDN}/h/mine?w=${Aglyn.MEDIA_CDN_POSTER_WIDTH}`)
  })

  it('builds every lightbox srcSet candidate through the same rule', () => {
    // Pasting `?w=` onto a generated poster's url would produce
    // `?poster=1?w=320` and 404 every candidate.
    const img = render(
      <Video src="media:h/film" posterFromSource lightbox />,
    ).container.querySelector('img') as HTMLImageElement
    expect(img.getAttribute('src')).toBe(`${CDN}/h/film?poster=1`)
    expect(img.getAttribute('srcset')).toContain(
      `${CDN}/h/film?poster=1&w=320 320w`,
    )
    expect(img.getAttribute('srcset')).not.toContain('?poster=1?w=')
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

describe('Video lightbox (AGL-2744)', () => {
  const trigger = (element: JSX.Element) =>
    render(element).container.querySelector('button') as HTMLButtonElement

  it('renders a play button over the poster instead of a player', () => {
    const { container } = render(
      <Video src="https://x/a.mp4" poster="media:h/p" lightbox title="Tour" />,
    )
    expect(container.querySelector('video')).toBeNull()
    const button = container.querySelector('button') as HTMLButtonElement
    expect(button.getAttribute('aria-label')).toBe('Play video: Tour')
    expect(button.getAttribute('type')).toBe('button')
  })

  it('still names its purpose when the author gave no title', () => {
    expect(
      trigger(
        <Video src="https://x/a.mp4" poster="media:h/p" lightbox />,
      ).getAttribute('aria-label'),
    ).toBe('Play video')
  })

  it('hands the poster the full candidate list an inline player cannot take', () => {
    // The one advantage of this mode: `<video poster>` accepts a single url,
    // an `<img>` accepts every width the DAM generated.
    const img = render(
      <Video src="https://x/a.mp4" poster="media:h/p" lightbox />,
    ).container.querySelector('img') as HTMLImageElement
    expect(img.getAttribute('src')).toBe(`${CDN}/h/p`)
    expect(img.getAttribute('srcset')).toContain(`${CDN}/h/p?w=320 320w`)
    expect(img.getAttribute('srcset')).toContain(`${CDN}/h/p?w=1920 1920w`)
    // Silent for a screen reader: the button beside it already says what
    // this is, and alt text would announce the same film twice.
    expect(img.getAttribute('alt')).toBe('')
  })

  it('falls back to the inline player with no poster to click', () => {
    // A lightbox trigger with nothing to show is a blank rectangle claiming
    // to be a film.
    const { container } = render(<Video src="https://x/a.mp4" lightbox />)
    expect(container.querySelector('button')).toBeNull()
    expect(container.querySelector('video')).toBeTruthy()
  })

  it('is off by default, so no published document changes', () => {
    const { container } = render(
      <Video src="https://x/a.mp4" poster="media:h/p" />,
    )
    expect(container.querySelector('button')).toBeNull()
    expect(container.querySelector('video')).toBeTruthy()
  })

  it('mounts no dialog until the trigger has been approached', () => {
    // The lazy chunk is what holds `@mui/material/Dialog`, and the whole
    // point of the split is that a page which is merely LOOKED at never
    // requests it.
    const { container, baseElement } = render(
      <Video src="https://x/a.mp4" poster="media:h/p" lightbox />,
    )
    expect(container.querySelector('button')).toBeTruthy()
    expect(baseElement.querySelector('[role="dialog"]')).toBeNull()
  })

  it('server-renders the trigger without reaching for the dialog', () => {
    // `lazy()` throws on the server if it is ever rendered there. Nothing
    // arms it during SSR, and this is what says so.
    expect(() =>
      renderToString(
        <Video src="https://x/a.mp4" poster="media:h/p" lightbox title="T" />,
      ),
    ).not.toThrow()
  })
})

/**
 * A Wistia video (AGL-2826). The element's promise is what it does NOT load,
 * so most of these assert an absence before the press and a presence after.
 */
describe('Video plays Wistia only after a press (AGL-2826)', () => {
  const LINK = 'https://aglyn.wistia.com/medias/e4a27b971d'
  const PLAYER = 'https://fast.wistia.net/embed/iframe/e4a27b971d'

  const onSite = (element: JSX.Element) => (
    <Aglyn.SiteContext.Provider value={{ hostId: 'host1' }}>
      {element}
    </Aglyn.SiteContext.Provider>
  )
  const press = (container: HTMLElement) =>
    fireEvent.click(container.querySelector('button') as HTMLButtonElement)
  const frameUrl = (root: ParentNode) =>
    new URL((root.querySelector('iframe') as HTMLIFrameElement).src)
  const recordConsent = (status: string) =>
    window.localStorage.setItem(
      visitorConsentStorageKey('host1'),
      JSON.stringify({ v: 1, at: 1, status }),
    )

  afterEach(() => window.localStorage.clear())

  it('renders the poster as a play button and nothing from Wistia', () => {
    const { container, baseElement } = render(
      <Video src={LINK} poster="media:h/p" title="Tour" />,
    )
    const button = container.querySelector('button') as HTMLButtonElement
    expect(button.getAttribute('aria-label')).toBe('Play video: Tour')
    expect(container.querySelector('video')).toBeNull()
    expect(baseElement.querySelector('iframe')).toBeNull()
    // Not even the address: the link stays in the node and out of the markup.
    expect(baseElement.innerHTML).not.toContain('wistia')
  })

  it('server-renders no frame and no Wistia address, either way', () => {
    for (const lightbox of [false, true]) {
      const html = renderToString(
        <Video src={LINK} poster="media:h/p" lightbox={lightbox} title="T" />,
      )
      expect(html).not.toContain('<iframe')
      expect(html).not.toContain('wistia')
    }
  })

  it('plays in place of the poster when the lightbox is off', () => {
    const { container } = render(
      <Video src={LINK} poster="media:h/p" title="Tour" />,
    )
    press(container)
    expect(container.querySelector('button')).toBeNull()
    const url = frameUrl(container)
    expect(`${url.origin}${url.pathname}`).toBe(PLAYER)
    expect(url.searchParams.get('autoPlay')).toBe('true')
    expect(container.querySelector('iframe')?.getAttribute('title')).toBe(
      'Tour',
    )
    // The pressed button is gone, so focus follows the film into the player.
    expect(document.activeElement).toBe(container.querySelector('iframe'))
  })

  it('opens the player in the dialog when the lightbox is on', async () => {
    const { container } = render(
      <Video src={LINK} poster="media:h/p" lightbox title="Tour" />,
    )
    press(container)
    const dialog = await screen.findByRole('dialog')
    const url = frameUrl(dialog)
    expect(`${url.origin}${url.pathname}`).toBe(PLAYER)
    expect(dialog.querySelector('video')).toBeNull()
  })

  it('tells Wistia not to track a visitor with no consent on record', () => {
    const { container } = render(
      onSite(<Video src={LINK} poster="media:h/p" />),
    )
    press(container)
    expect(frameUrl(container).searchParams.get('doNotTrack')).toBe('true')
  })

  it('keeps refusing tracking to a visitor who declined', () => {
    recordConsent('declined')
    const { container } = render(
      onSite(<Video src={LINK} poster="media:h/p" />),
    )
    press(container)
    expect(frameUrl(container).searchParams.get('doNotTrack')).toBe('true')
  })

  it('lets Wistia count the viewing once analytics consent is on record', () => {
    recordConsent('implied')
    const { container } = render(
      onSite(<Video src={LINK} poster="media:h/p" />),
    )
    press(container)
    expect(frameUrl(container).searchParams.has('doNotTrack')).toBe(false)
  })

  it('loads nothing into the besigner canvas, where a click selects the node', () => {
    const { container } = render(
      <Aglyn.ScreenLinkContext.Provider
        value={{ suppressNavigation: true, editorInert: true }}
      >
        <Video src={LINK} poster="media:h/p" lightbox title="Tour" />
      </Aglyn.ScreenLinkContext.Provider>,
    )
    // What the author sees is still the button a visitor gets.
    expect(container.querySelector('button')).toBeTruthy()
    press(container)
    expect(document.body.querySelector('iframe')).toBeNull()
    expect(document.body.querySelector('[role="dialog"]')).toBeNull()
  })

  it('asks for a poster rather than loading the player up front', () => {
    const { container, getByText } = render(<Video src={LINK} title="Tour" />)
    expect(getByText(/add a poster image/i)).toBeTruthy()
    expect(container.querySelector('iframe')).toBeNull()
    expect(container.querySelector('video')).toBeNull()
  })

  it('treats a look-alike host as an ordinary hotlink', () => {
    const { container } = render(
      <Video src="https://notwistia.com/medias/e4a27b971d" poster="media:h/p" />,
    )
    expect(container.querySelector('video')).toBeTruthy()
    expect(container.querySelector('button')).toBeNull()
  })
})


/**
 * The element loads the delivery copy, not the master (AGL-2753).
 *
 * `?r=auto` is what makes an out-of-band encoding reachable from a page that
 * was published before it existed. The element cannot name a rendition — at
 * pick time an asset usually has none — so it asks, and the CDN answers from
 * the media document it already reads on that request.
 */
describe('Video asks the CDN for a delivery copy (AGL-2753)', () => {
  it('loads a library video through the negotiated URL', () => {
    expect(video(<Video src="media:h/film" />).getAttribute('src')).toBe(
      `${CDN}/h/film?r=auto`,
    )
  })

  it('keeps the parameter on a pinned reference rather than replacing its path', () => {
    expect(video(<Video src="media:h/film@abc123" />).getAttribute('src')).toBe(
      `${CDN}/h/film/abc123?r=auto`,
    )
  })

  it('⛔ leaves a hotlink exactly as authored', () => {
    // A stranger's server has no renditions, and appending a parameter it
    // does not understand is at best noise in someone else's logs.
    expect(
      video(<Video src="https://videos.example.com/film.mp4" />).getAttribute(
        'src',
      ),
    ).toBe('https://videos.example.com/film.mp4')
  })

  it('still shows the placeholder for an empty src', () => {
    // The negotiated builder passes an unusable value straight through, so
    // the empty check above it goes on meaning what it meant.
    const { getByText } = render(<Video src="" />)
    expect(getByText(/set a source URL/i)).toBeTruthy()
  })

  it('hands the lightbox the same delivery URL the inline player uses', () => {
    // One asset, one URL, whichever way it is played — otherwise opening the
    // dialog would fetch the master after the page had already paid for a
    // rendition.
    const { container } = render(
      <Video src="media:h/film" poster="media:h/p" lightbox />,
    )
    expect(container.querySelector('video')).toBeNull()
    expect(
      Aglyn.videoDeliverySrc('media:h/film', { hostId: undefined }),
    ).toBe(`${CDN}/h/film?r=auto`)
  })

  it('⛔ never negotiates the poster, which is an image and edge-cached', () => {
    expect(
      video(<Video src="media:h/film" posterFromSource />).getAttribute(
        'poster',
      ),
    ).toContain('poster=1')
    expect(
      video(<Video src="media:h/film" posterFromSource />).getAttribute(
        'poster',
      ),
    ).not.toContain('r=auto')
  })
})
