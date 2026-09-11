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
 * The lightbox player's own controls (AGL-2802).
 *
 * ## Why not the browser's
 *
 * A `<video controls>` draws its buttons inside the browser's shadow tree, and
 * Chrome's media controls consume `Escape` there before the page is sent
 * anything: from the play, timeline, volume and full-screen stops, no
 * `keydown` or `keyup` for it reaches the document in either phase. MUI's
 * Modal closes on a bubbling `keydown`, so the dialog could not close from the
 * four focus stops a keyboard visitor is on while watching, and no listener,
 * capture phase included, can hear a key the page is never sent.
 *
 * These are ordinary buttons and range inputs. Every key pressed on one is
 * dispatched through the document like any other key, so `Escape` bubbles to
 * the Modal from each of them and focus goes back to the trigger.
 *
 * ## Why a module of its own
 *
 * Only `video-lightbox.tsx` imports it, and nothing else may. That module is
 * reached solely through `lazy(() => import())` in `video.tsx`, so this file,
 * and MUI's Slider with it, travels in the dialog's chunk: fetched by a
 * visitor who asked to watch, never by a page that only shows a poster
 * (AGL-2744).
 *
 * ## The keyboard
 *
 * | key | from | does |
 * | -- | -- | -- |
 * | `Space` | any stop but a button, which `Space` presses | play or pause |
 * | `K` | any stop | play or pause |
 * | `←` `→` | any stop but a slider | back or forward five seconds |
 * | `M` | any stop | mute or unmute |
 * | `F` | any stop | full screen on or off |
 * | arrows | the seek slider | five seconds, ten with `Shift` |
 * | `Page Up` `Page Down` | the seek slider | ten seconds |
 * | `Home` `End` | the seek slider | the start, the end |
 * | arrows | the volume slider | five percent |
 * | `Escape` | any stop | leaves full screen if on, otherwise closes |
 *
 * A key held with `Ctrl`, `Alt` or `Meta` is never a shortcut: those belong
 * to the browser and the operating system.
 */
'use client'

import {
  mdiClosedCaption,
  mdiClosedCaptionOutline,
  mdiFullscreen,
  mdiFullscreenExit,
  mdiPause,
  mdiPlay,
  mdiVolumeHigh,
  mdiVolumeOff,
} from '@aglyn/shared-data-mdi'
import { MdiIcon } from '@aglyn/shared-ui-jsx'
import Box from '@mui/material/Box'
import { touchRippleClasses } from '@mui/material/ButtonBase'
import IconButton from '@mui/material/IconButton'
import Slider, { sliderClasses } from '@mui/material/Slider'
import { type Theme, useTheme } from '@mui/material/styles'
import Typography from '@mui/material/Typography'
import useMediaQuery from '@mui/material/useMediaQuery'
import {
  type KeyboardEvent,
  type RefObject,
  useEffect,
  useRef,
  useState,
} from 'react'

/** One arrow press on the playhead, on the seek slider or from any other stop. */
export const SEEK_STEP_SECONDS = 5

/** `Page Up` and `Page Down` on the seek slider, and an arrow held with `Shift`. */
export const SEEK_PAGE_SECONDS = 10

/** One arrow press on the volume slider, in percent. */
const VOLUME_STEP_PERCENT = 5

const ignore = () => undefined

/**
 * A player clock: `m:ss`, or `h:mm:ss` from an hour up.
 *
 * A duration the browser does not know yet (`NaN`, before metadata) or cannot
 * know (`Infinity`, a stream) reads as `0:00` rather than as `NaN:NaN`.
 */
export function formatMediaTime(seconds: number): string {
  const whole = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0
  const hours = Math.floor(whole / 3600)
  const minutes = Math.floor(whole / 60) % 60
  const rest = String(whole % 60).padStart(2, '0')
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${rest}`
    : `${minutes}:${rest}`
}

/** What the seek slider says its value is: `1:23 of 4:10`. */
export function seekValueText(position: number, duration: number): string {
  return `${formatMediaTime(position)} of ${formatMediaTime(duration)}`
}

/** The two elements the controls and the keyboard act on. */
export interface LightboxPlayerElements {
  video: HTMLVideoElement | null
  /**
   * The frame that goes full screen: the film AND these controls, so they are
   * still on screen, and still reachable from the keyboard, once it has.
   */
  player: HTMLElement | null
}

/**
 * Play or pause.
 *
 * `play()` rejects when the browser refuses playback, and the refusal needs
 * no handling: no `play` event fires, so the control goes on reporting a
 * paused film, which is the truth.
 */
export function togglePlayback(video: HTMLVideoElement): void {
  if (video.paused || video.ended) {
    void Promise.resolve(video.play()).catch(ignore)
  } else {
    video.pause()
  }
}

/**
 * Moves the playhead, clamped to the film, and returns where it landed.
 * Before the duration is known there is nowhere to land, and nothing moves.
 */
export function seekPlayback(
  video: HTMLVideoElement,
  seconds: number,
): number | undefined {
  const { duration } = video
  if (!Number.isFinite(duration) || duration <= 0) return undefined
  const landed = Math.min(Math.max(seconds, 0), duration)
  video.currentTime = landed
  return landed
}

export function toggleMute(video: HTMLVideoElement): void {
  video.muted = !video.muted
}

/** iOS Safari on a phone, which can put only the `<video>` itself full screen. */
type PhoneVideoElement = HTMLVideoElement & { webkitEnterFullscreen?: () => void }

/**
 * Whether a full-screen control would do anything here.
 *
 * `fullscreenEnabled` is false inside a frame whose embedder did not allow it,
 * and there the control is left out rather than shown doing nothing. A phone
 * with no element full screen at all still gets the video-only kind, which
 * plays under the platform's own controls.
 */
export function fullscreenAvailable(): boolean {
  if (typeof document === 'undefined') return false
  if (document.fullscreenEnabled) return true
  return (
    !('requestFullscreen' in Element.prototype) &&
    'webkitEnterFullscreen' in HTMLVideoElement.prototype
  )
}

export function toggleFullscreen({ video, player }: LightboxPlayerElements): void {
  const doc = (player ?? video)?.ownerDocument
  if (!doc) return
  if (player && doc.fullscreenElement === player) {
    void Promise.resolve(doc.exitFullscreen()).catch(ignore)
    return
  }
  if (player && doc.fullscreenEnabled) {
    void Promise.resolve(player.requestFullscreen()).catch(ignore)
    return
  }
  const phone = video as PhoneVideoElement | null
  phone?.webkitEnterFullscreen?.()
}

/** The tracks a captions toggle turns on and off. */
function captionTracks(video: HTMLVideoElement): TextTrack[] {
  // Absent where a DOM implements no media pipeline.
  const tracks: ArrayLike<TextTrack> = video.textTracks ?? []
  return Array.from(tracks).filter(
    (track) => track.kind === 'captions' || track.kind === 'subtitles',
  )
}

/** The keys a focused slider moves itself with. */
const SLIDER_KEYS = new Set([
  'ArrowLeft',
  'ArrowRight',
  'ArrowUp',
  'ArrowDown',
  'PageUp',
  'PageDown',
  'Home',
  'End',
])

const ARROW_KEYS = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'])

/**
 * Whether the focused element uses `key` for itself, in which case no shortcut
 * may take it: `Space` and `Enter` press a focused button, the arrows and
 * `Home`/`End` move a focused slider, and a text field wants every key.
 */
export function keyBelongsToFocus(
  target: EventTarget | null,
  key: string,
): boolean {
  if (!(target instanceof Element)) return false
  if (target instanceof HTMLElement && target.isContentEditable) return true
  if (target.matches('input[type="range"], [role="slider"]')) {
    return SLIDER_KEYS.has(key)
  }
  if (
    target.matches(
      'button, [role="button"], a[href], summary, input[type="checkbox"], input[type="radio"]',
    )
  ) {
    return key === ' ' || key === 'Enter'
  }
  return target.matches('input, textarea, select')
}

interface Shortcut {
  run: (video: HTMLVideoElement, player: HTMLElement | null) => void
  /** Whether holding the key keeps doing it. A toggle held down must not flicker. */
  repeats: boolean
}

const SHORTCUTS = new Map<string, Shortcut>([
  [' ', { run: togglePlayback, repeats: false }],
  ['k', { run: togglePlayback, repeats: false }],
  [
    'ArrowLeft',
    {
      run: (video) => seekPlayback(video, video.currentTime - SEEK_STEP_SECONDS),
      repeats: true,
    },
  ],
  [
    'ArrowRight',
    {
      run: (video) => seekPlayback(video, video.currentTime + SEEK_STEP_SECONDS),
      repeats: true,
    },
  ],
  ['m', { run: toggleMute, repeats: false }],
  [
    'f',
    { run: (video, player) => toggleFullscreen({ video, player }), repeats: false },
  ],
])

/**
 * The dialog's `onKeyDown`: the player's shortcuts, from every stop inside it.
 *
 * Bound on the Modal root rather than on the controls, because focus is not
 * always on a control — a click on the film leaves it on the dialog container
 * — and a key pressed anywhere in the dialog bubbles through the root. MUI
 * calls this before its own `Escape` handling, and nothing here touches
 * `Escape`.
 *
 * A key the focused control uses for itself is left alone, and so is any key
 * a control already claimed: MUI's Slider calls `preventDefault` on the keys
 * it moves with, which is how an arrow on a slider stays that slider's.
 */
export function handlePlayerShortcut(
  event: KeyboardEvent<Element>,
  { video, player }: LightboxPlayerElements,
): void {
  const key = event.key.length === 1 ? event.key.toLowerCase() : event.key
  const shortcut = SHORTCUTS.get(key)
  if (!shortcut || !video) return
  if (
    event.defaultPrevented ||
    event.altKey ||
    event.ctrlKey ||
    event.metaKey ||
    event.nativeEvent.isComposing
  ) {
    return
  }
  if (keyBelongsToFocus(event.target, event.key)) return
  event.preventDefault()
  if (event.repeat && !shortcut.repeats) return
  shortcut.run(video, player)
}

/** A focus ring that reads on the player's black ground, whatever the site's palette. */
const focusRing = {
  outline: '2px solid',
  outlineColor: 'common.white',
  outlineOffset: 2,
}

/**
 * Every button on the player, the dialog's close button included.
 *
 * IconButton's own hover rule reads `--IconButton-hoverBg`, `hover: none`
 * reset and all; its default is a tint of `action.active`, which on a light
 * site's palette is black on this black ground and never shows. The ripple is
 * motion, so it goes for a visitor who asked for less, and it is gated in CSS
 * as the poster's play badge is so the setting resolves in both directions.
 */
export const controlButtonSx = (theme: Theme) => ({
  color: 'common.white',
  '--IconButton-hoverBg': (theme.vars || theme).palette.grey[800],
  '&:focus-visible': focusRing,
  '@media (prefers-reduced-motion: reduce)': {
    [`& .${touchRippleClasses.root}`]: { display: 'none' },
  },
})

const sliderSx = {
  color: 'common.white',
  // The focused element is the thumb's visually hidden range input, so the
  // ring goes on the thumb MUI marks as focus-visible.
  [`& .${sliderClasses.thumb}.${sliderClasses.focusVisible}`]: focusRing,
  // The thumb glides to each new value; that glide is motion too.
  '@media (prefers-reduced-motion: reduce)': {
    [`& .${sliderClasses.thumb}, & .${sliderClasses.track}`]: {
      transition: 'none',
    },
  },
}

/** The film's state as the controls draw it. */
interface MediaSnapshot {
  paused: boolean
  currentTime: number
  duration: number
  muted: boolean
  volume: number
}

/** Every event after which the element reports something the controls draw. */
const MEDIA_EVENTS = [
  'play',
  'pause',
  'ended',
  'timeupdate',
  'seeked',
  'durationchange',
  'loadedmetadata',
  'volumechange',
  'emptied',
] as const

const snapshotOf = (video: HTMLVideoElement): MediaSnapshot => ({
  paused: video.paused,
  currentTime: video.currentTime,
  duration: video.duration,
  muted: video.muted,
  volume: video.volume,
})

export interface VideoLightboxControlsProps {
  videoRef: RefObject<HTMLVideoElement | null>
  /** See {@link LightboxPlayerElements.player}. */
  playerRef: RefObject<HTMLElement | null>
  /** The film carries a captions track, so a toggle for it belongs here. */
  captions?: boolean
}

/**
 * The bar under the film: a seek slider across the top, then play, the clock,
 * mute, volume, captions and full screen.
 *
 * Each control is a real `<button>` or a real range input with a name and a
 * state: `aria-pressed` on the toggles, a spoken `1:23 of 4:10` on the seek
 * slider, `aria-keyshortcuts` where a key does the same thing.
 *
 * What the controls draw is read back off the `<video>` on its own events
 * rather than kept beside it, so a button, a shortcut, a click on the film and
 * the platform's media keys all end in one place, and the play beacon's
 * handlers on the element hear every one of them.
 */
export function VideoLightboxControls(props: VideoLightboxControlsProps) {
  const { videoRef, playerRef, captions = false } = props
  const [media, setMedia] = useState<MediaSnapshot>({
    paused: true,
    currentTime: 0,
    duration: Number.NaN,
    muted: false,
    volume: 1,
  })
  const [fullscreen, setFullscreen] = useState(false)
  const [captionsShowing, setCaptionsShowing] = useState(captions)
  const [canFullscreen] = useState(fullscreenAvailable)
  const fullscreenButtonRef = useRef<HTMLButtonElement>(null)
  /**
   * No volume slider at phone width: a phone's volume belongs to its hardware
   * buttons, iOS ignores a page that sets it, and the row has no room for it.
   * Read on the first render, so the slider never flashes in and out on open.
   */
  const theme = useTheme()
  const phone = useMediaQuery(theme.breakpoints.down('sm'), { noSsr: true })

  useEffect(() => {
    const video = videoRef.current
    if (!video) return undefined
    const doc = video.ownerDocument
    const tracks = video.textTracks as TextTrackList | undefined
    const syncMedia = () => setMedia(snapshotOf(video))
    /**
     * Full screen moves the player into the top layer, and the browser blurs
     * whatever had focus outside it: the dialog's own surface, where focus
     * lands on open, is outside it. Focus then sits on the body, outside the
     * Modal, where no shortcut and no `Escape` reaches the dialog. So focus
     * follows the player in, onto the control that toggles it, and is put
     * back there on the way out if the browser dropped it again.
     */
    const syncFullscreen = () => {
      const player = playerRef.current
      setFullscreen(player !== null && doc.fullscreenElement === player)
      if (player && !player.contains(doc.activeElement)) {
        fullscreenButtonRef.current?.focus()
      }
    }
    const syncCaptions = () =>
      setCaptionsShowing(
        captionTracks(video).some((track) => track.mode === 'showing'),
      )
    syncMedia()
    for (const type of MEDIA_EVENTS) video.addEventListener(type, syncMedia)
    doc.addEventListener('fullscreenchange', syncFullscreen)
    tracks?.addEventListener?.('change', syncCaptions)
    return () => {
      for (const type of MEDIA_EVENTS) video.removeEventListener(type, syncMedia)
      doc.removeEventListener('fullscreenchange', syncFullscreen)
      tracks?.removeEventListener?.('change', syncCaptions)
    }
  }, [videoRef, playerRef])

  const seekable = Number.isFinite(media.duration) && media.duration > 0
  const position = seekable
    ? Math.min(Math.max(media.currentTime, 0), media.duration)
    : 0
  const playing = !media.paused
  const level = media.muted ? 0 : Math.round(media.volume * 100)

  const withVideo = (action: (video: HTMLVideoElement) => void) => () => {
    const video = videoRef.current
    if (video) action(video)
  }

  /**
   * MUI's Slider steps an arrow by `step`, which is also the grain a pointer
   * drag snaps to. One second keeps a drag as fine as the clock it moves, and
   * this scales an arrow up to the same five seconds the arrows give from
   * every other stop, in the direction MUI chose, so a right-to-left page's
   * arrows still point the way the track runs.
   */
  const onSeek = (event: Event, value: number | number[]) => {
    const video = videoRef.current
    if (!video || typeof value !== 'number') return
    const arrow =
      event.type === 'keydown' &&
      ARROW_KEYS.has((event as globalThis.KeyboardEvent).key)
    const step = (event as globalThis.KeyboardEvent).shiftKey
      ? SEEK_PAGE_SECONDS
      : SEEK_STEP_SECONDS
    const target = arrow
      ? video.currentTime + Math.sign(value - position) * step
      : value
    const landed = seekPlayback(video, target)
    // Drawn now rather than on `seeked`, so the thumb does not spring back
    // to where it was for the frames the seek takes.
    if (landed !== undefined) {
      setMedia((previous) => ({ ...previous, currentTime: landed }))
    }
  }

  /**
   * Zero mutes rather than zeroing the volume, so unmuting brings back the
   * last level the visitor could hear.
   */
  const onVolume = (_event: Event, value: number | number[]) => {
    const video = videoRef.current
    if (!video || typeof value !== 'number') return
    if (value <= 0) {
      video.muted = true
      return
    }
    video.volume = value / 100
    video.muted = false
  }

  const onCaptions = withVideo((video) => {
    const next = !captionsShowing
    for (const track of captionTracks(video)) {
      track.mode = next ? 'showing' : 'hidden'
    }
    setCaptionsShowing(next)
  })

  return (
    <Box>
      <Box sx={{ px: 2 }}>
        <Slider
          aria-label="Seek"
          size="small"
          min={0}
          max={seekable ? media.duration : 1}
          step={1}
          shiftStep={SEEK_PAGE_SECONDS}
          value={position}
          disabled={!seekable}
          getAriaValueText={(value) => seekValueText(value, media.duration)}
          onChange={onSeek}
          sx={sliderSx}
        />
      </Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 1, pb: 1 }}>
        <IconButton
          aria-label="Play"
          aria-pressed={playing}
          aria-keyshortcuts="k Space"
          onClick={withVideo(togglePlayback)}
          sx={controlButtonSx}
        >
          <MdiIcon path={playing ? mdiPause.path : mdiPlay.path} />
        </IconButton>
        <Typography
          component="span"
          variant="body2"
          // The seek slider already speaks this, as `1:23 of 4:10`.
          aria-hidden
          sx={{
            color: 'common.white',
            fontVariantNumeric: 'tabular-nums',
            whiteSpace: 'nowrap',
          }}
        >
          {`${formatMediaTime(position)} / ${formatMediaTime(media.duration)}`}
        </Typography>
        <Box sx={{ flexGrow: 1 }} />
        <IconButton
          aria-label="Mute"
          aria-pressed={media.muted}
          aria-keyshortcuts="m"
          onClick={withVideo(toggleMute)}
          sx={controlButtonSx}
        >
          <MdiIcon
            path={
              media.muted || media.volume === 0
                ? mdiVolumeOff.path
                : mdiVolumeHigh.path
            }
          />
        </IconButton>
        {phone ? null : (
          <Slider
            aria-label="Volume"
            size="small"
            min={0}
            max={100}
            step={VOLUME_STEP_PERCENT}
            value={level}
            getAriaValueText={(value) => (value === 0 ? 'Muted' : `${value}%`)}
            onChange={onVolume}
            sx={[sliderSx, { width: theme.spacing(12), mx: 1 }]}
          />
        )}
        {captions ? (
          <IconButton
            aria-label="Captions"
            aria-pressed={captionsShowing}
            onClick={onCaptions}
            sx={controlButtonSx}
          >
            <MdiIcon
              path={
                captionsShowing
                  ? mdiClosedCaption.path
                  : mdiClosedCaptionOutline.path
              }
            />
          </IconButton>
        ) : null}
        {canFullscreen ? (
          <IconButton
            ref={fullscreenButtonRef}
            aria-label="Full screen"
            aria-pressed={fullscreen}
            aria-keyshortcuts="f"
            onClick={() =>
              toggleFullscreen({
                video: videoRef.current,
                player: playerRef.current,
              })
            }
            sx={controlButtonSx}
          >
            <MdiIcon path={fullscreen ? mdiFullscreenExit.path : mdiFullscreen.path} />
          </IconButton>
        ) : null}
      </Box>
    </Box>
  )
}
VideoLightboxControls.displayName = 'VideoLightboxControls'
