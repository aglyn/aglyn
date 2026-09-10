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
    expect(video.hasAttribute('controls')).toBe(true)
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

  it('renders nothing at all while closed', () => {
    // Unmounting is what actually stops the download; a paused `<video>` left
    // in the tree keeps whatever it has buffered.
    const base = render(
      <VideoLightbox open={false} onClose={() => undefined} src="https://x/a.mp4" />,
    ).baseElement
    expect(base.querySelector('video')).toBeNull()
  })
})
