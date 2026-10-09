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
 * The Video element's lightbox (AGL-2744).
 *
 * ## Why this is its own module
 *
 * The dialog itself is the shared lightbox shell (AGL-3717,
 * `@aglyn/shared-ui-jsx/components/lightbox/lightbox-dialog`), the same one
 * the Image, the Image List gallery and the Lightbox container open. What is
 * the Video's own is what goes inside it: the film, its controls, the hosted
 * player frame and the play beacon.
 *
 * The shell names `@mui/material/Dialog`, which must never be reached from a
 * first paint. `libs/shared/ui/jsx`'s barrel deliberately withholds
 * `dialog-confirm`, `loading-modal` and `navigation-drawer` because the MUI
 * Dialog/Drawer/Popper stack was measured sitting in the first-load chunks of
 * `/pricing` — a page that opens no dialog (AGL-1290). `plugin.ts` imports
 * every element eagerly, so this module is a chunk `video.tsx` reaches through
 * `lazy(() => import())` and mounts only once a visitor has actually asked to
 * watch something. A page with no video pays nothing; a page with a video
 * pays nothing; a visitor who clicks pays once. The player's controls,
 * `video-lightbox-controls.tsx`, are imported from here and from nowhere
 * else, so they ride in the same chunk.
 *
 * It is still MUI's `Dialog` and still the site's own theme. The split is
 * about WHEN the dialog arrives, not about hand-rolling a modal — and the
 * accessibility is most of why. `Dialog` traps focus for the life of the
 * overlay, restores it to the element that opened it on close, closes on
 * `Escape`, and marks the rest of the document inert for assistive
 * technology. Every one of those is a thing a bespoke overlay gets wrong.
 *
 * ## Why the film has no `controls` attribute here
 *
 * The browser's own controls swallow `Escape` (AGL-2802): from inside them no
 * key event reaches the page, so the dialog could not be dismissed from the
 * stops a keyboard visitor is on while watching. The player draws its own
 * controls instead; `video-lightbox-controls.tsx` explains the measurement and
 * carries the key map. The inline player keeps the browser's controls, because
 * nothing on a page is listening for `Escape` there.
 */
'use client'

import type { LightboxAppearance } from '@aglyn/shared-ui-jsx/components/lightbox/lightbox-appearance'
import {
  LightboxCloseButton,
  LightboxDialog,
} from '@aglyn/shared-ui-jsx/components/lightbox/lightbox-dialog'
import Box from '@mui/material/Box'
import { type ReactNode, useRef } from 'react'
import {
  controlButtonSx,
  handlePlayerShortcut,
  togglePlayback,
  VideoLightboxControls,
} from './video-lightbox-controls'
import {
  useVideoPlaybackBeacon,
  type VideoPlaybackBeaconOptions,
} from './video-playback-beacon'
import { VideoPlayerFrame } from './video-player-frame'

export interface VideoLightboxProps {
  open: boolean
  onClose: () => void
  /** Names the dialog for assistive technology; also the video's own title. */
  title?: string
  /** Resolved video URL — already through `resolveMediaSrc`. */
  src: string
  /** Resolved poster URL, shown for the instant before the first frame. */
  poster?: string
  /** `width / height` from the asset, when the DAM measured it. */
  aspectRatio?: string
  loop?: boolean
  muted?: boolean
  /** The `<track>` the inline element would have rendered, if any. */
  captions?: ReactNode
  /**
   * What a play in this dialog is counted against (AGL-2781). Each open is
   * its own viewing, so the element passes the facts and the dialog keys the
   * viewing to `open`.
   */
  playback?: Omit<VideoPlaybackBeaconOptions, 'viewingKey'>
  /**
   * A hosted player's frame address (AGL-2826). When set, the dialog frames
   * that player and never plays `src` itself.
   */
  embedSrc?: string
  /**
   * The author's lightbox settings (AGL-3717). Absent, the dialog is exactly
   * the one AGL-2744 shipped: wide, black, the close control in the corner.
   */
  appearance?: LightboxAppearance
}

/** What a dialog is called when the author gave the video no title. */
const FALLBACK_LABEL = 'Video'

/**
 * The dialog. Rendered only while `open`, and unmounted when it closes.
 *
 * Unmounting is not tidiness — it is the only thing that reliably STOPS the
 * download. A `<video>` left in the tree paused still holds whatever it has
 * buffered and may keep filling that buffer; taking the element out of the
 * document is what tells the browser the request is over. That matters more
 * here than it would elsewhere, because the whole element exists to keep a
 * multi-megabyte file off the wire until it is wanted.
 */
export function VideoLightbox(props: VideoLightboxProps) {
  const {
    open,
    onClose,
    title,
    src,
    poster,
    aspectRatio,
    loop,
    muted,
    captions,
    playback,
    embedSrc,
    appearance,
  } = props
  const playbackHandlers = useVideoPlaybackBeacon({
    ...playback,
    viewingKey: open,
  })
  const videoRef = useRef<HTMLVideoElement>(null)
  /** The frame that goes full screen, controls and all. */
  const playerRef = useRef<HTMLDivElement>(null)
  /*
   * `prefers-reduced-motion` reaches the DIALOG, not the video: the shared
   * shell drops its transition to nothing (AGL-3717 moved that rule there).
   *
   * The FILM is deliberately left alone. Autoplay here is not autoplay: the
   * visitor pressed a play button, and a play button that opens a paused
   * video is a defect, not an accommodation. WCAG's auto-motion requirement
   * is about motion that starts without the user, and it is satisfied anyway
   * — the player's controls are on screen, so the video can be paused at any
   * moment.
   */
  /**
   * Pauses before closing, so the sound stops on the press rather than when
   * the exit transition ends and the `<video>` leaves the tree.
   */
  const closeDialog = () => {
    videoRef.current?.pause()
    onClose()
  }
  /**
   * `Escape` in full screen leaves full screen and keeps the dialog open. A
   * browser normally exits full screen on that key before the page hears it;
   * this covers one that passes the key on as well, so one press never does
   * both.
   */
  const interceptClose = (reason: string) => {
    const doc = playerRef.current?.ownerDocument
    if (reason === 'escapeKeyDown' && doc?.fullscreenElement) {
      void Promise.resolve(doc.exitFullscreen()).catch(() => undefined)
      return true
    }
    return false
  }
  return (
    <LightboxDialog
      open={open}
      onClose={closeDialog}
      interceptClose={interceptClose}
      onKeyDown={(event) =>
        handlePlayerShortcut(event, {
          video: videoRef.current,
          player: playerRef.current,
        })
      }
      maxWidth="lg"
      fullWidth
      // No `DialogTitle`, deliberately: the film is the content, and a
      // heading above it would only push it down. The name rides the paper.
      label={title || FALLBACK_LABEL}
      // The close control lives inside the frame that goes full screen.
      closeButton={false}
      appearance={appearance}
      // The paper is a frame around a video, not a sheet of content: no
      // padding, and a black ground so a letterboxed film has something to
      // sit on rather than a white margin.
      paperSx={{ overflow: 'hidden', bgcolor: 'common.black' }}
    >
      <Box
        ref={playerRef}
        sx={{
          position: 'relative',
          display: 'flex',
          flexDirection: 'column',
          // The paper stops growing at the viewport, less its margins. The
          // film is what gives way, letterboxed, so the controls under it
          // are never the part cut off on a short or landscape screen.
          flex: '1 1 auto',
          minHeight: 0,
          bgcolor: 'common.black',
        }}
      >
        <LightboxCloseButton
          onClick={closeDialog}
          label="Close video"
          appearance={appearance}
          sx={[
            controlButtonSx,
            // Over frames of unknown brightness, so the control carries its
            // own ground rather than trusting the film's.
            ...(appearance?.closeStyle ? [] : [{ bgcolor: 'common.black' }]),
          ]}
        />
        {embedSrc ? (
          // A hosted player draws its own controls inside its frame, so the
          // dialog adds none, and its shortcuts find no film to act on.
          // Closing unmounts the frame with the rest of the dialog, which
          // stops the player exactly as it stops the `<video>`, and the frame
          // gives way on a short screen for the reason the film does.
          <VideoPlayerFrame
            src={embedSrc}
            title={title}
            aspectRatio={aspectRatio}
            style={{ flexGrow: 1, flexShrink: 1, minHeight: 0 }}
          />
        ) : (
          <>
            <Box
              component="video"
              ref={videoRef}
              src={src}
              poster={poster || undefined}
              title={title || undefined}
              autoPlay
              playsInline
              loop={Boolean(loop)}
              muted={Boolean(muted)}
              // The one place in this element where fetching eagerly is right:
              // the visitor has asked for the film and is looking at the player.
              preload="auto"
              // A click on the picture plays and pauses, as it does on the
              // browser's own player.
              onClick={() => {
                if (videoRef.current) togglePlayback(videoRef.current)
              }}
              onPlay={playbackHandlers.onPlay}
              onTimeUpdate={playbackHandlers.onTimeUpdate}
              onEnded={playbackHandlers.onEnded}
              sx={{
                display: 'block',
                width: '100%',
                height: 'auto',
                flex: '1 1 auto',
                minHeight: 0,
                objectFit: 'contain',
                aspectRatio,
              }}
            >
              {captions}
            </Box>
            <VideoLightboxControls
              videoRef={videoRef}
              playerRef={playerRef}
              captions={Boolean(captions)}
            />
          </>
        )}
      </Box>
    </LightboxDialog>
  )
}
VideoLightbox.displayName = 'VideoLightbox'

export default VideoLightbox
