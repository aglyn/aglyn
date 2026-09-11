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
 * This file is the ONLY place in the tenant's component graph that names
 * `@mui/material/Dialog`, and it must stay that way. `libs/shared/ui/jsx`'s
 * barrel deliberately withholds `dialog-confirm`, `loading-modal` and
 * `navigation-drawer` because the MUI Dialog/Drawer/Popper stack was measured
 * sitting in the first-load chunks of `/pricing` — a page that opens no dialog
 * (AGL-1290). `plugin.ts` imports every element eagerly, so a `Dialog` named
 * at the top of `video.tsx` would put that whole stack back on every published
 * page of every customer site, including the ones with no video on them.
 *
 * Split out, it is a chunk `video.tsx` reaches through `lazy(() => import())`
 * and mounts only once a visitor has actually asked to watch something. A page
 * with no video pays nothing; a page with a video pays nothing; a visitor who
 * clicks pays once. The player's controls, `video-lightbox-controls.tsx`, are
 * imported from here and from nowhere else, so they ride in the same chunk.
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

import { mdiClose } from '@aglyn/shared-data-mdi'
import { MdiIcon } from '@aglyn/shared-ui-jsx'
import Box from '@mui/material/Box'
import Dialog, { type DialogProps } from '@mui/material/Dialog'
import IconButton from '@mui/material/IconButton'
import useMediaQuery from '@mui/material/useMediaQuery'
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
  } = props
  const playbackHandlers = useVideoPlaybackBeacon({
    ...playback,
    viewingKey: open,
  })
  const videoRef = useRef<HTMLVideoElement>(null)
  /** The frame that goes full screen, controls and all. */
  const playerRef = useRef<HTMLDivElement>(null)
  /**
   * `prefers-reduced-motion` reaches the DIALOG, not the video.
   *
   * The overlay's fade-and-grow is incidental motion a visitor did not ask
   * for, so it is dropped to zero — MUI reads `transitionDuration` for both
   * the backdrop and the paper, so one value covers the whole open.
   *
   * The FILM is deliberately left alone, and that is the more interesting
   * half. Autoplay here is not autoplay: the visitor pressed a play button,
   * and a play button that opens a paused video is a defect, not an
   * accommodation. WCAG's auto-motion requirement is about motion that
   * starts without the user, and it is satisfied anyway — the player's
   * controls are on screen, so the video can be paused at any moment.
   */
  const reduceMotion = useMediaQuery('(prefers-reduced-motion: reduce)')
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
  const handleClose: DialogProps['onClose'] = (_event, reason) => {
    const doc = playerRef.current?.ownerDocument
    if (reason === 'escapeKeyDown' && doc?.fullscreenElement) {
      void Promise.resolve(doc.exitFullscreen()).catch(() => undefined)
      return
    }
    closeDialog()
  }
  return (
    <Dialog
      open={open}
      onClose={handleClose}
      onKeyDown={(event) =>
        handlePlayerShortcut(event, {
          video: videoRef.current,
          player: playerRef.current,
        })
      }
      maxWidth="lg"
      fullWidth
      transitionDuration={reduceMotion ? 0 : undefined}
      slotProps={{
        paper: {
          /**
           * ⚠️ The label goes on the PAPER, not on `<Dialog>`.
           *
           * `role="dialog"` lives on the paper; props spread onto `Dialog`
           * reach the Modal root, which is `role="presentation"`. Written
           * there first and measured in a browser: the presentation root
           * carried the name and the dialog itself had none, which is an
           * unlabelled dialog announced to a screen reader — the exact
           * failure the label was added to prevent. No `DialogTitle`,
           * deliberately: the film is the content, and a heading above it
           * would only push it down.
           */
          'aria-label': title || FALLBACK_LABEL,
          // The paper is a frame around a video, not a sheet of content:
          // no padding, and a black ground so a letterboxed film has
          // something to sit on rather than a white margin.
          sx: { overflow: 'hidden', bgcolor: 'common.black' },
        },
      }}
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
        <IconButton
          onClick={closeDialog}
          aria-label="Close video"
          size="small"
          sx={[
            controlButtonSx,
            (theme) => ({
              position: 'absolute',
              top: theme.spacing(1),
              right: theme.spacing(1),
              zIndex: 1,
              // Over frames of unknown brightness, so the control carries its
              // own ground rather than trusting the film's.
              bgcolor: 'common.black',
            }),
          ]}
        >
          <MdiIcon path={mdiClose.path} fontSize="small" />
        </IconButton>
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
      </Box>
    </Dialog>
  )
}
VideoLightbox.displayName = 'VideoLightbox'

export default VideoLightbox
