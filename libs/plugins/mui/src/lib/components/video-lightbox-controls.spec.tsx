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
 * The lightbox player's controls and keyboard (AGL-2802).
 *
 * jsdom draws no browser controls and plays nothing, so these cases hold the
 * half of the contract the page owns: every stop in the dialog is an element
 * whose keys are dispatched through the document, `Escape` from each one
 * reaches MUI's Modal and hands focus back to the trigger, and each shortcut
 * acts on the `<video>` without taking a key from a control that uses it.
 * That Chrome delivers those keys to the page at all is proved in a real
 * browser by `tools/e2e/dam-replace-and-video.e2e.mjs`.
 *
 * Every case opens the dialog the way a visitor does, through the Video
 * element's trigger and its lazy boundary, so focus has somewhere real to
 * go back to.
 */

import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import Video from './video'
import {
  formatMediaTime,
  SEEK_PAGE_SECONDS,
  SEEK_STEP_SECONDS,
  seekValueText,
} from './video-lightbox-controls'

const TITLE = 'The tour'
/** 4:10, so the seek slider's text has minutes on both sides. */
const FILM_SECONDS = 250

let played: jest.SpyInstance
let paused: jest.SpyInstance
let fullscreenElement: Element | null
let requestFullscreen: jest.Mock
let exitFullscreen: jest.Mock

type FullscreenDocument = Partial<
  Record<'fullscreenEnabled' | 'fullscreenElement' | 'exitFullscreen', unknown>
>

beforeEach(() => {
  // jsdom implements no playback. These do what a browser's `play()` and
  // `pause()` do as far as a page can observe: flip `paused`, fire the event.
  played = jest
    .spyOn(HTMLMediaElement.prototype, 'play')
    .mockImplementation(function (this: HTMLMediaElement) {
      Object.defineProperty(this, 'paused', { configurable: true, value: false })
      this.dispatchEvent(new Event('play'))
      return Promise.resolve()
    })
  paused = jest
    .spyOn(HTMLMediaElement.prototype, 'pause')
    .mockImplementation(function (this: HTMLMediaElement) {
      Object.defineProperty(this, 'paused', { configurable: true, value: true })
      this.dispatchEvent(new Event('pause'))
    })
  // Nor any full screen: a browser that has one, as far as a page can see.
  fullscreenElement = null
  const enter = (element: Element) => {
    fullscreenElement = element
    document.dispatchEvent(new Event('fullscreenchange'))
    return Promise.resolve()
  }
  requestFullscreen = jest.fn(function (this: Element) {
    return enter(this)
  })
  exitFullscreen = jest.fn(() => {
    fullscreenElement = null
    document.dispatchEvent(new Event('fullscreenchange'))
    return Promise.resolve()
  })
  Object.defineProperty(document, 'fullscreenEnabled', {
    configurable: true,
    get: () => true,
  })
  Object.defineProperty(document, 'fullscreenElement', {
    configurable: true,
    get: () => fullscreenElement,
  })
  Object.defineProperty(document, 'exitFullscreen', {
    configurable: true,
    value: exitFullscreen,
  })
  Object.defineProperty(Element.prototype, 'requestFullscreen', {
    configurable: true,
    value: requestFullscreen,
  })
})

afterEach(() => {
  jest.restoreAllMocks()
  const doc = document as unknown as FullscreenDocument
  delete doc.fullscreenEnabled
  delete doc.fullscreenElement
  delete doc.exitFullscreen
  delete (Element.prototype as { requestFullscreen?: unknown }).requestFullscreen
})

/**
 * jsdom's `<video>` has no length and a playhead that cannot move. This gives
 * it both, the way a browser reports them once metadata is in.
 */
function load(video: HTMLVideoElement) {
  let position = 0
  Object.defineProperty(video, 'duration', {
    configurable: true,
    get: () => FILM_SECONDS,
  })
  Object.defineProperty(video, 'currentTime', {
    configurable: true,
    get: () => position,
    set: (value: number) => {
      position = value
    },
  })
  fireEvent.durationChange(video)
}

/** Opens the lightbox as a visitor does: focus on the trigger, then press it. */
async function openLightbox(
  options: { captions?: boolean; loaded?: boolean } = {},
) {
  const { captions = true, loaded = true } = options
  const view = render(
    <Video
      src="media:h/film"
      poster="media:h/still"
      captionsSrc={captions ? 'media:h/captions' : undefined}
      title={TITLE}
      lightbox
    />,
  )
  const trigger = within(view.container).getByRole('button', {
    name: `Play video: ${TITLE}`,
  })
  act(() => trigger.focus())
  fireEvent.click(trigger)
  const dialog = await screen.findByRole('dialog', { name: TITLE })
  const video = dialog.querySelector('video') as HTMLVideoElement
  if (loaded) load(video)
  return { trigger, dialog, video }
}

const control = (name: string) => screen.getByRole('button', { name })
const slider = (name: string) => screen.getByRole('slider', { name })
const pressed = (name: string) => control(name).getAttribute('aria-pressed')

/** The element MUI's FocusTrap holds as the dialog's own stop. */
const focusSurface = (dialog: HTMLElement) =>
  dialog.closest<HTMLElement>('[tabindex="-1"]') ?? dialog

/** Moves the playhead as playback would, and lets the controls hear it. */
function playheadAt(video: HTMLVideoElement, seconds: number) {
  video.currentTime = seconds
  fireEvent.timeUpdate(video)
}

const closed = () =>
  waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())

/** The candidates MUI's FocusTrap walks for its tab order, in document order. */
const TABBABLE =
  'input, select, textarea, a[href], button, [tabindex], audio[controls], video[controls]'

describe('the player clock', () => {
  it('reads m:ss under an hour and h:mm:ss from one', () => {
    expect(formatMediaTime(0)).toBe('0:00')
    expect(formatMediaTime(83.9)).toBe('1:23')
    expect(formatMediaTime(3600)).toBe('1:00:00')
    expect(formatMediaTime(3725)).toBe('1:02:05')
  })

  it('reads a length it does not know, or cannot, as 0:00', () => {
    expect(formatMediaTime(Number.NaN)).toBe('0:00')
    expect(formatMediaTime(Number.POSITIVE_INFINITY)).toBe('0:00')
    expect(formatMediaTime(-4)).toBe('0:00')
  })

  it('says where the playhead is against the length', () => {
    expect(seekValueText(83, 250)).toBe('1:23 of 4:10')
  })
})

describe('Escape closes the lightbox from every focus stop (AGL-2802)', () => {
  const stops: ReadonlyArray<readonly [string, () => HTMLElement]> = [
    ['the close button', () => control('Close video')],
    ['the seek slider', () => slider('Seek')],
    ['play', () => control('Play')],
    ['mute', () => control('Mute')],
    ['the volume slider', () => slider('Volume')],
    ['captions', () => control('Captions')],
    ['full screen', () => control('Full screen')],
    [
      'the dialog itself, where a click on the film leaves focus',
      () => focusSurface(screen.getByRole('dialog', { name: TITLE })),
    ],
  ]

  it.each(stops)(
    'closes from %s and hands focus back to the trigger',
    async (_name, stopOf) => {
      const { trigger } = await openLightbox()
      const stop = stopOf()
      act(() => stop.focus())
      expect(document.activeElement).toBe(stop)
      fireEvent.keyDown(stop, { key: 'Escape' })
      await closed()
      expect(document.activeElement).toBe(trigger)
    },
  )
})

describe('the controls carry a name and a state (AGL-2802)', () => {
  it('says whether the film is playing on the play toggle', async () => {
    await openLightbox()
    expect(pressed('Play')).toBe('false')
    fireEvent.click(control('Play'))
    expect(played).toHaveBeenCalledTimes(1)
    expect(pressed('Play')).toBe('true')
    fireEvent.click(control('Play'))
    expect(paused).toHaveBeenCalledTimes(1)
    expect(pressed('Play')).toBe('false')
  })

  it('says the playhead against the length on the seek slider', async () => {
    const { video } = await openLightbox()
    playheadAt(video, 83)
    expect(slider('Seek').getAttribute('aria-valuetext')).toBe('1:23 of 4:10')
  })

  it('holds the seek slider disabled until the film has a length', async () => {
    const { video } = await openLightbox({ loaded: false })
    expect((slider('Seek') as HTMLInputElement).disabled).toBe(true)
    load(video)
    expect((slider('Seek') as HTMLInputElement).disabled).toBe(false)
  })

  it('offers captions for a film with a captions track, and turns them off and on', async () => {
    await openLightbox()
    expect(pressed('Captions')).toBe('true')
    fireEvent.click(control('Captions'))
    expect(pressed('Captions')).toBe('false')
  })

  it('offers no captions control for a film without a track', async () => {
    await openLightbox({ captions: false })
    expect(screen.queryByRole('button', { name: 'Captions' })).toBeNull()
  })

  it('offers no full-screen control where the browser has none to give', async () => {
    Object.defineProperty(document, 'fullscreenEnabled', {
      configurable: true,
      get: () => false,
    })
    await openLightbox()
    expect(screen.queryByRole('button', { name: 'Full screen' })).toBeNull()
  })

  it('gives the film no browser controls to hide a key inside', async () => {
    const { video } = await openLightbox()
    expect(video.hasAttribute('controls')).toBe(false)
  })
})

describe('the player keyboard (AGL-2802)', () => {
  it('plays and pauses on Space from a stop that is not a button', async () => {
    const { dialog } = await openLightbox()
    const surface = focusSurface(dialog)
    act(() => surface.focus())
    expect(fireEvent.keyDown(surface, { key: ' ' })).toBe(false)
    expect(pressed('Play')).toBe('true')
    fireEvent.keyDown(surface, { key: ' ' })
    expect(pressed('Play')).toBe('false')
    expect(played).toHaveBeenCalledTimes(1)
    expect(paused).toHaveBeenCalledTimes(1)
  })

  it('leaves Space and Enter to a focused button, which they press', async () => {
    await openLightbox()
    const mute = control('Mute')
    act(() => mute.focus())
    expect(fireEvent.keyDown(mute, { key: ' ' })).toBe(true)
    expect(fireEvent.keyDown(mute, { key: 'Enter' })).toBe(true)
    expect(played).not.toHaveBeenCalled()
    expect(pressed('Play')).toBe('false')
  })

  it('plays and pauses on K from any stop, a slider included, in either case', async () => {
    await openLightbox()
    const seek = slider('Seek')
    act(() => seek.focus())
    fireEvent.keyDown(seek, { key: 'k' })
    expect(pressed('Play')).toBe('true')
    fireEvent.keyDown(seek, { key: 'K' })
    expect(pressed('Play')).toBe('false')
  })

  it('does not flicker a toggle while its key is held down', async () => {
    await openLightbox()
    const play = control('Play')
    fireEvent.keyDown(play, { key: 'k' })
    fireEvent.keyDown(play, { key: 'k', repeat: true })
    fireEvent.keyDown(play, { key: 'k', repeat: true })
    expect(played).toHaveBeenCalledTimes(1)
    expect(paused).not.toHaveBeenCalled()
  })

  it('moves the playhead five seconds on ← and → from a button, and stops at either end', async () => {
    const { video } = await openLightbox()
    const play = control('Play')
    act(() => play.focus())
    playheadAt(video, 100)
    fireEvent.keyDown(play, { key: 'ArrowRight' })
    expect(video.currentTime).toBe(100 + SEEK_STEP_SECONDS)
    fireEvent.keyDown(play, { key: 'ArrowLeft' })
    fireEvent.keyDown(play, { key: 'ArrowLeft' })
    expect(video.currentTime).toBe(100 - SEEK_STEP_SECONDS)
    playheadAt(video, 2)
    fireEvent.keyDown(play, { key: 'ArrowLeft' })
    expect(video.currentTime).toBe(0)
    playheadAt(video, FILM_SECONDS - 2)
    fireEvent.keyDown(play, { key: 'ArrowRight' })
    expect(video.currentTime).toBe(FILM_SECONDS)
  })

  it('moves the seek slider five seconds per arrow, once, not by the slider and the shortcut both', async () => {
    const { video } = await openLightbox()
    playheadAt(video, 100)
    const seek = slider('Seek')
    act(() => seek.focus())
    fireEvent.keyDown(seek, { key: 'ArrowRight' })
    expect(video.currentTime).toBe(105)
    expect(seek.getAttribute('aria-valuetext')).toBe('1:45 of 4:10')
    fireEvent.keyDown(seek, { key: 'ArrowLeft' })
    expect(video.currentTime).toBe(100)
    fireEvent.keyDown(seek, { key: 'ArrowUp' })
    expect(video.currentTime).toBe(105)
    fireEvent.keyDown(seek, { key: 'ArrowDown' })
    expect(video.currentTime).toBe(100)
    fireEvent.keyDown(seek, { key: 'ArrowRight', shiftKey: true })
    expect(video.currentTime).toBe(100 + SEEK_PAGE_SECONDS)
  })

  it('moves the seek slider ten seconds on Page Up and Page Down, to the start on Home and the end on End', async () => {
    const { video } = await openLightbox()
    playheadAt(video, 100)
    const seek = slider('Seek')
    act(() => seek.focus())
    fireEvent.keyDown(seek, { key: 'PageUp' })
    expect(video.currentTime).toBe(100 + SEEK_PAGE_SECONDS)
    fireEvent.keyDown(seek, { key: 'PageDown' })
    expect(video.currentTime).toBe(100)
    fireEvent.keyDown(seek, { key: 'End' })
    expect(video.currentTime).toBe(FILM_SECONDS)
    expect(seek.getAttribute('aria-valuetext')).toBe('4:10 of 4:10')
    fireEvent.keyDown(seek, { key: 'Home' })
    expect(video.currentTime).toBe(0)
    expect(seek.getAttribute('aria-valuetext')).toBe('0:00 of 4:10')
  })

  it('changes the volume on the volume slider’s arrows and never moves the playhead', async () => {
    const { video } = await openLightbox()
    playheadAt(video, 100)
    act(() => {
      video.volume = 0.5
    })
    const volume = slider('Volume')
    act(() => volume.focus())
    fireEvent.keyDown(volume, { key: 'ArrowRight' })
    expect(video.volume).toBeCloseTo(0.55)
    fireEvent.keyDown(volume, { key: 'ArrowLeft' })
    fireEvent.keyDown(volume, { key: 'ArrowLeft' })
    expect(video.volume).toBeCloseTo(0.45)
    expect(volume.getAttribute('aria-valuetext')).toBe('45%')
    expect(video.currentTime).toBe(100)
  })

  it('mutes and unmutes on M from any stop', async () => {
    const { video } = await openLightbox()
    const seek = slider('Seek')
    act(() => seek.focus())
    fireEvent.keyDown(seek, { key: 'm' })
    expect(video.muted).toBe(true)
    expect(pressed('Mute')).toBe('true')
    expect(slider('Volume').getAttribute('aria-valuetext')).toBe('Muted')
    fireEvent.keyDown(seek, { key: 'M' })
    expect(video.muted).toBe(false)
    expect(pressed('Mute')).toBe('false')
  })

  it('puts the player, controls and all, full screen on F, takes focus in with it, and brings it back', async () => {
    const { dialog, video } = await openLightbox()
    // From the dialog's own surface, where focus lands on open, which is
    // outside the element that goes full screen.
    act(() => dialog.focus())
    fireEvent.keyDown(dialog, { key: 'f' })
    expect(requestFullscreen).toHaveBeenCalledTimes(1)
    expect(fullscreenElement?.contains(video)).toBe(true)
    expect(fullscreenElement?.contains(slider('Seek'))).toBe(true)
    expect(fullscreenElement?.contains(control('Close video'))).toBe(true)
    expect(pressed('Full screen')).toBe('true')
    // A browser blurs focus left outside the top layer, and keys pressed from
    // the body never reach the dialog: focus has to follow the player in.
    expect(fullscreenElement?.contains(document.activeElement)).toBe(true)
    fireEvent.keyDown(document.activeElement as Element, { key: 'F' })
    expect(exitFullscreen).toHaveBeenCalledTimes(1)
    expect(pressed('Full screen')).toBe('false')
  })

  it('leaves full screen on Escape first, and closes on the next press', async () => {
    await openLightbox()
    const play = control('Play')
    fireEvent.keyDown(play, { key: 'f' })
    fireEvent.keyDown(play, { key: 'Escape' })
    expect(exitFullscreen).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('dialog', { name: TITLE })).toBeTruthy()
    fireEvent.keyDown(play, { key: 'Escape' })
    await closed()
  })

  it('never takes a key held with Ctrl, Alt or Meta', async () => {
    const { video } = await openLightbox()
    const play = control('Play')
    playheadAt(video, 100)
    for (const modifier of [
      { ctrlKey: true },
      { altKey: true },
      { metaKey: true },
    ]) {
      for (const key of ['k', 'm', 'f', ' ', 'ArrowRight']) {
        expect(fireEvent.keyDown(play, { key, ...modifier })).toBe(true)
      }
    }
    expect(played).not.toHaveBeenCalled()
    expect(video.muted).toBe(false)
    expect(requestFullscreen).not.toHaveBeenCalled()
    expect(video.currentTime).toBe(100)
  })

  it('plays and pauses on a click on the film', async () => {
    const { video } = await openLightbox()
    fireEvent.click(video)
    expect(pressed('Play')).toBe('true')
    fireEvent.click(video)
    expect(pressed('Play')).toBe('false')
  })
})

describe('Tab stays inside the lightbox (AGL-2802)', () => {
  it('orders the stops close, seek, play, mute, volume, captions, full screen', async () => {
    const { dialog } = await openLightbox()
    const order = [
      ...focusSurface(dialog).querySelectorAll<HTMLElement>(TABBABLE),
    ]
      .filter(
        (node) =>
          node.tabIndex >= 0 && !(node as HTMLButtonElement).disabled,
      )
      .map((node) => node.getAttribute('aria-label'))
    expect(order).toEqual([
      'Close video',
      'Seek',
      'Play',
      'Mute',
      'Volume',
      'Captions',
      'Full screen',
    ])
  })

  it('opens with focus on the dialog, named for the film, where Space plays', async () => {
    // MUI's Dialog marks its paper as the trap's first focus: a screen reader
    // announces the film's name on entry, and Tab from there reaches the
    // close button first.
    const { dialog } = await openLightbox()
    expect(document.activeElement).toBe(dialog)
    fireEvent.keyDown(dialog, { key: ' ' })
    expect(pressed('Play')).toBe('true')
  })

  it('wraps from the last stop to the first, and from the first back to the last', async () => {
    await openLightbox()
    const first = control('Close video')
    const last = control('Full screen')
    const sentinelStart = document.querySelector(
      '[data-testid="sentinelStart"]',
    ) as HTMLElement
    const sentinelEnd = document.querySelector(
      '[data-testid="sentinelEnd"]',
    ) as HTMLElement
    // What a browser does on Tab from the last stop: the next tabbable
    // element in the document is the trap's end sentinel, and the trap sends
    // focus on from there to the first stop. Shift+Tab, the other way round.
    act(() => last.focus())
    fireEvent.keyDown(last, { key: 'Tab' })
    act(() => sentinelEnd.focus())
    expect(document.activeElement).toBe(first)
    fireEvent.keyDown(first, { key: 'Tab', shiftKey: true })
    act(() => sentinelStart.focus())
    expect(document.activeElement).toBe(last)
  })
})
