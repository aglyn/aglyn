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
 * clicks pays once.
 *
 * It is still MUI's `Dialog` and still the site's own theme. The split is
 * about WHEN the dialog arrives, not about hand-rolling a modal — and the
 * accessibility is most of why. `Dialog` traps focus for the life of the
 * overlay, restores it to the element that opened it on close, closes on
 * `Escape`, and marks the rest of the document inert for assistive
 * technology. Every one of those is a thing a bespoke overlay gets wrong.
 */
'use client'

import { mdiClose } from '@aglyn/shared-data-mdi'
import { MdiIcon } from '@aglyn/shared-ui-jsx'
import Box from '@mui/material/Box'
import Dialog from '@mui/material/Dialog'
import IconButton from '@mui/material/IconButton'
import useMediaQuery from '@mui/material/useMediaQuery'
import type { ReactNode } from 'react'

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
  } = props
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
   * controls are on, so the video can be paused at any moment.
   */
  const reduceMotion = useMediaQuery('(prefers-reduced-motion: reduce)')
  return (
    <Dialog
      open={open}
      onClose={onClose}
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
          sx: {
            position: 'relative',
            overflow: 'hidden',
            bgcolor: 'common.black',
          },
        },
      }}
    >
      <IconButton
        onClick={onClose}
        aria-label="Close video"
        size="small"
        sx={{
          position: 'absolute',
          top: 1,
          right: 1,
          zIndex: 1,
          // Over video frames of unknown brightness, so the affordance
          // carries its own contrast rather than trusting the first frame.
          color: 'common.white',
          bgcolor: 'rgba(0, 0, 0, 0.5)',
          '&:hover': { bgcolor: 'rgba(0, 0, 0, 0.7)' },
        }}
      >
        <MdiIcon path={mdiClose.path} fontSize="small" />
      </IconButton>
      <Box
        component="video"
        src={src}
        poster={poster || undefined}
        title={title || undefined}
        controls
        autoPlay
        playsInline
        loop={Boolean(loop)}
        muted={Boolean(muted)}
        // The one place in this element where fetching eagerly is right:
        // the visitor has asked for the film and is looking at the player.
        preload="auto"
        // Focused on mount so `Space` and the arrow keys reach the player
        // rather than the dialog, and so a keyboard visitor who opened this
        // with `Enter` is already on the control they wanted.
        autoFocus
        sx={{ display: 'block', width: '100%', height: 'auto', aspectRatio }}
      >
        {captions}
      </Box>
    </Dialog>
  )
}
VideoLightbox.displayName = 'VideoLightbox'

export default VideoLightbox
