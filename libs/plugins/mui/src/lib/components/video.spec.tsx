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
import {
  storeVisitorConsent,
  VISITOR_CONSENT_CHANGED_EVENT,
  visitorConsentStorageKey,
} from '@aglyn/aglyn/app-utils/visitor-consent'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { renderToString } from 'react-dom/server'
import Video, { resolveVideoPreload, schema } from './video'

const CDN = '/api/media/cdn'

const video = (element: JSX.Element) =>
  render(element).container.querySelector('video') as HTMLVideoElement

/** The besigner canvas or Preview: the surfaces an authoring hint is for. */
const editing = (element: JSX.Element) => (
  <Aglyn.ScreenLinkContext.Provider value={{ suppressNavigation: true }}>
    {element}
  </Aglyn.ScreenLinkContext.Provider>
)

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

  it('renders the placeholder on an editing surface when src is empty', () => {
    const { getByText } = render(editing(<Video />))
    expect(getByText(/set a source URL/i)).toBeTruthy()
  })

  it('renders the bare element on a published page when src is empty', () => {
    // The label is addressed to the author (AGL-3067). A visitor gets the
    // node's own element and nothing inside it.
    const { container } = render(<Video data-aglyn="leaf:film" />)
    const root = container.firstElementChild as HTMLElement
    expect(root.getAttribute('data-aglyn')).toBe('leaf:film')
    expect(container.textContent).toBe('')
    expect(getComputedStyle(root).borderStyle).not.toContain('dashed')
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

  it('narrows an authored poster that is a captured frame without breaking its query', () => {
    // An entry template binds Poster image to the entry's cover, and a cover
    // filled from a film is that film's `?poster=1` url (AGL-2958).
    expect(
      video(
        <Video src="media:h/film" poster={`${CDN}/h/film?poster=1`} />,
      ).getAttribute('poster'),
    ).toBe(`${CDN}/h/film?poster=1&w=${Aglyn.MEDIA_CDN_POSTER_WIDTH}`)
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
    const { container, getByText } = render(
      editing(<Video src={LINK} title="Tour" />),
    )
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
 * A press sent from outside the element (AGL-2867): a "Play a video"
 * interaction on a button elsewhere on the page. The command is sent to the
 * element's DOM root, the one a `playVideo` step's selector finds, and every
 * case asserts what the element's OWN press would have done — including what
 * it does not load before the command arrives.
 */
describe('Video answers a press sent from outside it (AGL-2867)', () => {
  const LINK = 'https://aglyn.wistia.com/medias/e4a27b971d'
  const PLAYER = 'https://fast.wistia.net/embed/iframe/e4a27b971d'

  /** What a `playVideo` step does once its selector has found the element. */
  const sendPlay = (container: HTMLElement) =>
    act(() =>
      Aglyn.dispatchVideoCommand(container.firstElementChild as Element, 'play'),
    )
  const onSite = (element: JSX.Element) => (
    <Aglyn.SiteContext.Provider value={{ hostId: 'host1' }}>
      {element}
    </Aglyn.SiteContext.Provider>
  )
  const frameUrl = (root: ParentNode) =>
    new URL((root.querySelector('iframe') as HTMLIFrameElement).src)

  let play: jest.SpyInstance
  beforeEach(() => {
    play = jest
      .spyOn(HTMLMediaElement.prototype, 'play')
      .mockImplementation(() => Promise.resolve())
  })
  afterEach(() => {
    play.mockRestore()
    window.localStorage.clear()
  })

  it('opens the lightbox and plays, as a press on the poster does', async () => {
    const { container, baseElement } = render(
      <Video src="https://x/a.mp4" poster="media:h/p" lightbox title="Tour" />,
    )
    // Nothing is armed, and no dialog chunk is asked for, before the press.
    expect(baseElement.querySelector('[role="dialog"]')).toBeNull()

    let answered = false
    await act(async () => {
      answered = Aglyn.dispatchVideoCommand(
        container.firstElementChild as Element,
        'play',
      )
    })

    expect(answered).toBe(true)
    const dialog = await screen.findByRole('dialog')
    expect(dialog.getAttribute('aria-label')).toBe('Tour')
    const film = dialog.querySelector('video') as HTMLVideoElement
    expect(film.getAttribute('src')).toBe('https://x/a.mp4')
    expect(film.autoplay).toBe(true)
  })

  it('plays a Wistia film in place of its poster, loading nothing from Wistia until then', () => {
    const { container } = render(
      onSite(<Video src={LINK} poster="media:h/p" title="Tour" />),
    )
    expect(container.querySelector('iframe')).toBeNull()
    expect(container.innerHTML).not.toContain('wistia')

    sendPlay(container)

    expect(container.querySelector('button')).toBeNull()
    const url = frameUrl(container)
    expect(`${url.origin}${url.pathname}`).toBe(PLAYER)
    expect(url.searchParams.get('autoPlay')).toBe('true')
    // The same consent rule as a click: no analytics consent on record, so
    // Wistia is told not to track.
    expect(url.searchParams.get('doNotTrack')).toBe('true')
  })

  it('reads consent at the press, as the poster button does', () => {
    window.localStorage.setItem(
      visitorConsentStorageKey('host1'),
      JSON.stringify({ v: 1, at: 1, status: 'implied' }),
    )
    const { container } = render(
      onSite(<Video src={LINK} poster="media:h/p" title="Tour" />),
    )
    sendPlay(container)
    expect(frameUrl(container).searchParams.has('doNotTrack')).toBe(false)
  })

  it('opens a Wistia film in the lightbox when the lightbox is on', async () => {
    const { container } = render(
      <Video src={LINK} poster="media:h/p" lightbox title="Tour" />,
    )
    await act(async () => {
      Aglyn.dispatchVideoCommand(container.firstElementChild as Element, 'play')
    })
    const dialog = await screen.findByRole('dialog')
    const url = frameUrl(dialog)
    expect(`${url.origin}${url.pathname}`).toBe(PLAYER)
  })

  it('a second press on a film already playing in place changes nothing', () => {
    const { container } = render(
      <Video src={LINK} poster="media:h/p" title="Tour" />,
    )
    sendPlay(container)
    const frame = container.querySelector('iframe')
    sendPlay(container)
    expect(container.querySelectorAll('iframe')).toHaveLength(1)
    expect(container.querySelector('iframe')).toBe(frame)
  })

  it('plays the inline player, which is what a press on it does', () => {
    const { container } = render(
      <Video src="https://x/a.mp4" poster="https://x/a.png" />,
    )
    const film = container.querySelector('video') as HTMLVideoElement
    expect(film.getAttribute('preload')).toBe('none')

    let answered = false
    act(() => {
      answered = Aglyn.dispatchVideoCommand(film, 'play')
    })

    expect(answered).toBe(true)
    expect(play).toHaveBeenCalledTimes(1)
    expect(play.mock.instances[0]).toBe(film)
  })

  it('follows its root when an edit swaps the inline player for a poster', async () => {
    const { container, rerender } = render(
      <Video src="https://x/a.mp4" poster="media:h/p" />,
    )
    expect(container.querySelector('video')).toBeTruthy()
    rerender(<Video src="https://x/a.mp4" poster="media:h/p" lightbox />)
    expect(container.querySelector('video')).toBeNull()

    await act(async () => {
      Aglyn.dispatchVideoCommand(container.firstElementChild as Element, 'play')
    })

    expect(await screen.findByRole('dialog')).toBeTruthy()
    expect(play).not.toHaveBeenCalled()
  })

  it('does nothing when there is nothing it could play', () => {
    const { container } = render(<Video src={LINK} title="Tour" />)
    expect(() => sendPlay(container)).not.toThrow()
    expect(container.querySelector('iframe')).toBeNull()

    const empty = render(<Video />)
    expect(() => sendPlay(empty.container)).not.toThrow()
    expect(play).not.toHaveBeenCalled()
  })

  it('is inert on the besigner canvas, like the poster button', () => {
    const inCanvas = (element: JSX.Element) => (
      <Aglyn.ScreenLinkContext.Provider
        value={{ suppressNavigation: true, editorInert: true }}
      >
        {element}
      </Aglyn.ScreenLinkContext.Provider>
    )
    const wistia = render(inCanvas(<Video src={LINK} poster="media:h/p" lightbox />))
    sendPlay(wistia.container)
    const inline = render(inCanvas(<Video src="https://x/a.mp4" />))
    sendPlay(inline.container)

    expect(document.body.querySelector('iframe')).toBeNull()
    expect(document.body.querySelector('[role="dialog"]')).toBeNull()
    expect(play).not.toHaveBeenCalled()
  })

  it('stops listening once it leaves the page', () => {
    const { container, unmount } = render(<Video src="https://x/a.mp4" />)
    const film = container.querySelector('video') as HTMLVideoElement
    unmount()
    expect(Aglyn.dispatchVideoCommand(film, 'play')).toBe(false)
    expect(play).not.toHaveBeenCalled()
  })
})

/**
 * "Load the player with the page" (AGL-2962): Wistia's player in place of the
 * poster once the page has loaded, so a search engine rendering a watch page
 * finds the player. Only for a visitor whose stored consent grants analytics,
 * because the unpressed frame writes to its own storage; everyone else, the
 * server HTML and the besigner canvas keep the poster the switch-off element
 * renders, and a press on it does what it always did.
 */
describe('Video loads a Wistia player with the page for a visitor who allows analytics (AGL-2962)', () => {
  const LINK = 'https://aglyn.wistia.com/medias/e4a27b971d'
  const PLAYER = 'https://fast.wistia.net/embed/iframe/e4a27b971d'

  const onSite = (element: JSX.Element) => (
    <Aglyn.SiteContext.Provider value={{ hostId: 'host1' }}>
      {element}
    </Aglyn.SiteContext.Provider>
  )
  const frameUrl = (root: ParentNode) =>
    new URL((root.querySelector('iframe') as HTMLIFrameElement).src)
  /** A record already in storage when the page loads, from an earlier visit. */
  const recordConsent = (status: string) =>
    window.localStorage.setItem(
      visitorConsentStorageKey('host1'),
      JSON.stringify({ v: 1, at: 1, status }),
    )
  /** A decision made while the page is open, through the shared writer. */
  const decide = (status: 'implied' | 'accepted' | 'opted-out') =>
    act(() => {
      storeVisitorConsent('host1', { status })
    })
  const press = (container: HTMLElement) =>
    fireEvent.click(container.querySelector('button') as HTMLButtonElement)
  /** What a `playVideo` step does once its selector has found the element. */
  const sendPlay = (container: HTMLElement) =>
    act(() => {
      Aglyn.dispatchVideoCommand(container.firstElementChild as Element, 'play')
    })

  afterEach(() => window.localStorage.clear())

  it('mounts the player with no press, no autoplay and no doNotTrack once analytics is granted', () => {
    for (const status of ['implied', 'accepted']) {
      recordConsent(status)
      const { container, unmount } = render(
        onSite(<Video src={LINK} poster="media:h/p" title="Tour" loadPlayer />),
      )
      expect(container.querySelector('button')).toBeNull()
      const url = frameUrl(container)
      expect(`${url.origin}${url.pathname}`).toBe(PLAYER)
      expect(url.searchParams.get('autoPlay')).toBe('false')
      expect(url.searchParams.has('doNotTrack')).toBe(false)
      expect(container.querySelector('iframe')?.getAttribute('title')).toBe(
        'Tour',
      )
      // Nobody asked for the film, so focus stays where the page left it.
      expect(document.activeElement).not.toBe(container.querySelector('iframe'))
      unmount()
    }
  })

  it('keeps the poster, and nothing from Wistia, for a visitor with no record', () => {
    const { container, baseElement } = render(
      onSite(<Video src={LINK} poster="media:h/p" title="Tour" loadPlayer />),
    )
    expect(container.querySelector('button')?.getAttribute('aria-label')).toBe(
      'Play video: Tour',
    )
    expect(baseElement.querySelector('iframe')).toBeNull()
    expect(baseElement.innerHTML).not.toContain('wistia')
  })

  it('keeps the poster for every refusal on record', () => {
    for (const status of ['declined', 'opted-out', 'gpc-opt-out']) {
      recordConsent(status)
      const { container, unmount } = render(
        onSite(<Video src={LINK} poster="media:h/p" loadPlayer />),
      )
      expect(container.querySelector('button')).toBeTruthy()
      expect(container.querySelector('iframe')).toBeNull()
      unmount()
    }
  })

  it('still loads the player with doNotTrack when a visitor without consent presses', () => {
    const { container } = render(
      onSite(<Video src={LINK} poster="media:h/p" loadPlayer />),
    )
    press(container)
    const url = frameUrl(container)
    expect(url.searchParams.get('autoPlay')).toBe('true')
    expect(url.searchParams.get('doNotTrack')).toBe('true')
  })

  it('mounts the player when the grant lands after the element did', () => {
    const { container } = render(
      onSite(<Video src={LINK} poster="media:h/p" loadPlayer />),
    )
    expect(container.querySelector('iframe')).toBeNull()
    // The implied default, recorded once the region lookup answers.
    decide('implied')
    const url = frameUrl(container)
    expect(url.searchParams.get('autoPlay')).toBe('false')
    expect(url.searchParams.has('doNotTrack')).toBe(false)
  })

  it('puts the poster back when the grant is withdrawn before any press', () => {
    recordConsent('implied')
    const { container } = render(
      onSite(<Video src={LINK} poster="media:h/p" loadPlayer />),
    )
    expect(container.querySelector('iframe')).toBeTruthy()
    decide('opted-out')
    expect(container.querySelector('iframe')).toBeNull()
    expect(container.querySelector('button')).toBeTruthy()
  })

  it('leaves a pressed player alone when a grant lands after the press', () => {
    const { container } = render(
      onSite(<Video src={LINK} poster="media:h/p" loadPlayer />),
    )
    press(container)
    const pressed = container.querySelector('iframe')
    decide('accepted')
    expect(container.querySelectorAll('iframe')).toHaveLength(1)
    expect(container.querySelector('iframe')).toBe(pressed)
    expect(frameUrl(container).searchParams.get('autoPlay')).toBe('true')
  })

  it('loads no second player beside a lightbox a press opened before the grant', async () => {
    const { container } = render(
      onSite(<Video src={LINK} poster="media:h/p" lightbox loadPlayer />),
    )
    press(container)
    const dialog = await screen.findByRole('dialog')
    decide('accepted')
    // The film is playing in the dialog; a paused player loaded in place of
    // the poster behind it would be a second Wistia frame nobody asked for.
    expect(container.querySelector('iframe')).toBeNull()
    expect(container.querySelector('button')).toBeTruthy()
    expect(document.body.querySelectorAll('iframe')).toHaveLength(1)
    expect(dialog.querySelector('iframe')).toBeTruthy()
  })

  it('plays a loaded player when a press arrives from outside, in a new frame', () => {
    recordConsent('implied')
    const { container } = render(
      onSite(<Video src={LINK} poster="media:h/p" title="Tour" loadPlayer />),
    )
    const loaded = container.querySelector('iframe')
    expect(frameUrl(container).searchParams.get('autoPlay')).toBe('false')

    sendPlay(container)

    const frames = container.querySelectorAll('iframe')
    expect(frames).toHaveLength(1)
    // A new frame, not a new address in the loaded one, which would add an
    // entry to the tab's history.
    expect(frames[0]).not.toBe(loaded)
    const url = frameUrl(container)
    expect(`${url.origin}${url.pathname}`).toBe(PLAYER)
    expect(url.searchParams.get('autoPlay')).toBe('true')
    expect(url.searchParams.has('doNotTrack')).toBe(false)
    expect(document.activeElement).toBe(frames[0])

    // Playing now, so a second press changes nothing.
    sendPlay(container)
    expect(container.querySelector('iframe')).toBe(frames[0])
  })

  it('loads the player in place with the lightbox on, and plays it there', () => {
    recordConsent('implied')
    const { container } = render(
      onSite(<Video src={LINK} poster="media:h/p" lightbox loadPlayer />),
    )
    expect(container.querySelector('button')).toBeNull()
    expect(frameUrl(container).searchParams.get('autoPlay')).toBe('false')
    sendPlay(container)
    expect(container.querySelectorAll('iframe')).toHaveLength(1)
    expect(frameUrl(container).searchParams.get('autoPlay')).toBe('true')
  })

  it('opens the lightbox as before for a visitor without consent', async () => {
    const { container } = render(
      onSite(<Video src={LINK} poster="media:h/p" lightbox loadPlayer />),
    )
    expect(container.querySelector('iframe')).toBeNull()
    press(container)
    const dialog = await screen.findByRole('dialog')
    expect(frameUrl(dialog).searchParams.get('doNotTrack')).toBe('true')
    expect(container.querySelector('iframe')).toBeNull()
  })

  it('server-renders the poster and no Wistia address, whatever consent says', () => {
    recordConsent('implied')
    for (const lightbox of [false, true]) {
      const html = renderToString(
        onSite(
          <Video
            src={LINK}
            poster="media:h/p"
            lightbox={lightbox}
            loadPlayer
            title="T"
          />,
        ),
      )
      expect(html).toContain('aria-label="Play video: T"')
      expect(html).not.toContain('<iframe')
      expect(html).not.toContain('wistia')
    }
  })

  it('loads nothing into the besigner canvas, even with analytics granted', () => {
    recordConsent('implied')
    const { container } = render(
      <Aglyn.ScreenLinkContext.Provider
        value={{ suppressNavigation: true, editorInert: true }}
      >
        {onSite(<Video src={LINK} poster="media:h/p" title="Tour" loadPlayer />)}
      </Aglyn.ScreenLinkContext.Provider>,
    )
    expect(container.querySelector('button')).toBeTruthy()
    decide('accepted')
    expect(document.body.querySelector('iframe')).toBeNull()
  })

  it('is off by default: analytics granted, and still the poster until a press', () => {
    recordConsent('implied')
    const add = jest.spyOn(window, 'addEventListener')
    try {
      const { container } = render(
        onSite(<Video src={LINK} poster="media:h/p" />),
      )
      expect(container.querySelector('button')).toBeTruthy()
      expect(container.querySelector('iframe')).toBeNull()
      // Not even a listener: with the switch off, consent is read at a press
      // and nowhere else.
      expect(
        add.mock.calls.some(([type]) => type === VISITOR_CONSENT_CHANGED_EVENT),
      ).toBe(false)
    } finally {
      add.mockRestore()
    }
  })

  it('still loads no player without a poster, and asks the author, not the visitor', () => {
    recordConsent('implied')
    const { container, queryByText } = render(
      onSite(<Video src={LINK} title="Tour" loadPlayer />),
    )
    expect(queryByText(/add a poster image/i)).toBeNull()
    expect(container.querySelector('iframe')).toBeNull()
    const authoring = render(
      editing(<Video src={LINK} title="Tour" loadPlayer />),
    )
    expect(authoring.getByText(/add a poster image/i)).toBeTruthy()
    expect(authoring.container.querySelector('iframe')).toBeNull()
  })

  it('changes nothing for a source that is not Wistia', () => {
    recordConsent('implied')
    const inline = render(
      onSite(<Video src="https://x/a.mp4" poster="https://x/a.png" loadPlayer />),
    ).container
    const film = inline.querySelector('video') as HTMLVideoElement
    expect(film.getAttribute('src')).toBe('https://x/a.mp4')
    expect(film.getAttribute('preload')).toBe('none')
    expect(inline.querySelector('iframe')).toBeNull()

    const boxed = render(
      onSite(<Video src="https://x/a.mp4" poster="media:h/p" lightbox loadPlayer />),
    ).container
    expect(boxed.querySelector('button')).toBeTruthy()
    expect(boxed.querySelector('iframe')).toBeNull()
  })

  it('keeps the switch off the DOM, like every other field that is not markup', () => {
    // A string, because React writes an unknown prop with a string value into
    // the markup and leaves a boolean one out, so only a string shows the
    // leak; and the value that reaches an element is not always the boolean
    // the switch stores.
    const props = {
      src: 'https://x/a.mp4',
      loadPlayer: 'on',
    } as unknown as React.ComponentProps<typeof Video>
    expect(video(<Video {...props} />).hasAttribute('loadplayer')).toBe(false)
  })

  it('stops listening for consent once it leaves the page', () => {
    const add = jest.spyOn(window, 'addEventListener')
    const remove = jest.spyOn(window, 'removeEventListener')
    try {
      const { unmount } = render(
        onSite(<Video src={LINK} poster="media:h/p" loadPlayer />),
      )
      const listener = add.mock.calls.find(
        ([type]) => type === VISITOR_CONSENT_CHANGED_EVENT,
      )?.[1]
      expect(listener).toBeTruthy()
      unmount()
      expect(remove).toHaveBeenCalledWith(
        VISITOR_CONSENT_CHANGED_EVENT,
        listener,
      )
    } finally {
      add.mockRestore()
      remove.mockRestore()
    }
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

  it('loads a pinned reference through the stable URL a replace reaches (AGL-2798)', () => {
    expect(video(<Video src="media:h/film@abc123" />).getAttribute('src')).toBe(
      `${CDN}/h/film?r=auto`,
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
    const { getByText } = render(editing(<Video src="" />))
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
