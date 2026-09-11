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
 * The lightbox dialog (AGL-2744).
 *
 * The label assertions exist because the first version got this WRONG in a way
 * no unit test then in the file could see: `aria-label` was passed to
 * `<Dialog>`, which spreads onto the Modal ROOT — `role="presentation"` — so
 * the `role="dialog"` paper had no accessible name at all and a screen reader
 * announced an unlabelled dialog. Found by driving the built component in a
 * real browser and reading the roles back; these are what stop it returning.
 */

import { render } from '@testing-library/react'
import { VideoLightbox } from './video-lightbox'

const open = (props: Partial<Parameters<typeof VideoLightbox>[0]> = {}) => {
  const result = render(
    <VideoLightbox
      open
      onClose={() => undefined}
      src="https://x/a.mp4"
      title="The 60-second tour"
      {...props}
    />,
  )
  return result.baseElement
}

describe('VideoLightbox naming', () => {
  it('puts the accessible name on the element that carries role="dialog"', () => {
    const dialog = open().querySelector('[role="dialog"]') as HTMLElement
    expect(dialog).toBeTruthy()
    expect(dialog.getAttribute('aria-label')).toBe('The 60-second tour')
  })

  it('never leaves the dialog unnamed, even with no title', () => {
    const dialog = open({ title: undefined }).querySelector(
      '[role="dialog"]',
    ) as HTMLElement
    expect(dialog.getAttribute('aria-label')).toBe('Video')
  })

  it('labels the close control for a screen reader', () => {
    expect(
      open().querySelector('button[aria-label="Close video"]'),
    ).toBeTruthy()
  })
})

describe('VideoLightbox playback', () => {
  it('fetches eagerly — the visitor has asked for the film', () => {
    const video = open().querySelector('video') as HTMLVideoElement
    expect(video.getAttribute('preload')).toBe('auto')
    expect(video.hasAttribute('autoplay')).toBe(true)
  })

  it("draws its own controls rather than the browser's (AGL-2802)", () => {
    // The browser's controls swallow Escape before the page hears it, so the
    // dialog could not be dismissed from them. Its own are real buttons.
    const base = open()
    expect(
      (base.querySelector('video') as HTMLVideoElement).hasAttribute('controls'),
    ).toBe(false)
    expect(base.querySelector('button[aria-label="Play"]')).toBeTruthy()
  })

  it('carries the poster through so the frame is not blank on open', () => {
    expect(
      (open({ poster: '/still.png' }).querySelector('video') as HTMLVideoElement)
        .getAttribute('poster'),
    ).toBe('/still.png')
  })

  it('renders the captions track the inline player would have', () => {
    const track = open({
      captions: <track kind="captions" src="/c.vtt" default />,
    }).querySelector('track') as HTMLTrackElement
    expect(track.getAttribute('src')).toBe('/c.vtt')
  })

  it('lets the film give way on a short screen rather than lose its bottom edge (AGL-2827)', () => {
    // The paper stops at the viewport, less its margins, and hides what
    // overflows. A flex item's automatic minimum height is its content
    // height, so a film that could not shrink below its aspect-ratio height
    // lost its bottom edge on a short screen, and the controls with it.
    const style = getComputedStyle(open().querySelector('video') as HTMLVideoElement)
    expect(style.minHeight).toMatch(/^0(px)?$/)
    expect(style.flexShrink).toBe('1')
  })
})

describe('VideoLightbox with a hosted player (AGL-2826)', () => {
  const EMBED = 'https://fast.wistia.net/embed/iframe/e4a27b971d'

  it('adds no controls around a player that draws its own', () => {
    const base = open({ embedSrc: EMBED })
    expect(base.querySelector('button[aria-label="Play"]')).toBeNull()
    expect(base.querySelector('button[aria-label="Close video"]')).toBeTruthy()
  })

  it('lets the player give way on a short screen, as the film does', () => {
    // The same AGL-2827 geometry: a frame that could not shrink below its
    // aspect-ratio height would lose its bottom edge, where Wistia draws its
    // controls.
    const style = getComputedStyle(
      open({ embedSrc: EMBED }).querySelector('iframe') as HTMLIFrameElement,
    )
    expect(style.minHeight).toMatch(/^0(px)?$/)
    expect(style.flexShrink).toBe('1')
  })

  it('frames a hosted player instead of playing a file', () => {
    const embedSrc =
      'https://fast.wistia.net/embed/iframe/e4a27b971d?autoPlay=true'
    const base = open({ embedSrc })
    const frame = base.querySelector('iframe') as HTMLIFrameElement
    expect(frame.getAttribute('src')).toBe(embedSrc)
    // The dialog's name and the frame's name are the same sentence, so a
    // screen reader entering the player knows which film it is in.
    expect(frame.getAttribute('title')).toBe('The 60-second tour')
    expect(frame.getAttribute('allow')).toContain('autoplay')
    // Never both: a `<video>` beside the frame would fetch `src` as well.
    expect(base.querySelector('video')).toBeNull()
  })

  it('never lets the hosted player navigate the page', () => {
    const sandbox = (
      open({
        embedSrc: 'https://fast.wistia.net/embed/iframe/e4a27b971d',
      }).querySelector('iframe') as HTMLIFrameElement
    ).getAttribute('sandbox') as string
    expect(sandbox).toContain('allow-scripts')
    expect(sandbox).not.toContain('allow-top-navigation')
    expect(sandbox).not.toContain('allow-forms')
  })

  it('leaves focus on the dialog, where Escape can still close it', () => {
    // A cross-origin frame keeps every key pressed inside it, so a player that
    // took focus on open would swallow the Escape that closes the dialog.
    const base = open({
      embedSrc: 'https://fast.wistia.net/embed/iframe/e4a27b971d',
    })
    expect(document.activeElement).not.toBe(base.querySelector('iframe'))
  })
})

describe('VideoLightbox while closed', () => {
  it('renders nothing at all while closed', () => {
    // Unmounting is what actually stops the download; a paused `<video>` left
    // in the tree keeps whatever it has buffered.
    const base = render(
      <VideoLightbox open={false} onClose={() => undefined} src="https://x/a.mp4" />,
    ).baseElement
    expect(base.querySelector('video')).toBeNull()
  })
})
