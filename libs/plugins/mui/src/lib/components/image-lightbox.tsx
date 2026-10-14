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
 * The picture lightbox (AGL-3717): one picture full size, or a gallery of
 * them with previous and next, a counter, captions and an optional strip of
 * thumbnails.
 *
 * It is the shared lightbox shell — the Video's dialog, lifted into
 * `@aglyn/shared-ui-jsx/components/lightbox/lightbox-dialog` — with pictures
 * in it, and it is reached the way the Video's is: `image.tsx` and
 * `image-list.tsx` load this module through `lazy(() => import())` the first
 * time a visitor goes near a picture that opens, so a page that only shows
 * pictures never downloads the Dialog stack (AGL-1290).
 *
 * Nothing in it renders while closed. The full-size picture is requested when
 * the dialog opens and not before; it is the one image here that loads
 * eagerly, because the visitor has just asked to see it.
 */
'use client'

import * as Aglyn from '@aglyn/aglyn'
import { mdiChevronLeft, mdiChevronRight } from '@aglyn/shared-data-mdi'
import { MdiIcon } from '@aglyn/shared-ui-jsx'
import type { LightboxAppearance } from '@aglyn/shared-ui-jsx/components/lightbox/lightbox-appearance'
import { LightboxDialog } from '@aglyn/shared-ui-jsx/components/lightbox/lightbox-dialog'
import Box from '@mui/material/Box'
import IconButton from '@mui/material/IconButton'
import { alpha, type Theme } from '@mui/material/styles'
import Typography from '@mui/material/Typography'
import { type KeyboardEvent, type PointerEvent, useEffect, useRef, useState } from 'react'
import { type LightboxGallery, stepIndex } from './image-lightbox-items'

/** How far a finger has to travel sideways before it counts as a swipe. */
export const SWIPE_THRESHOLD_PX = 40

export interface ImageLightboxProps {
  open: boolean
  onClose: () => void
  gallery: LightboxGallery
  appearance?: LightboxAppearance
  /** A strip of thumbnails under the picture, for a gallery of two or more. */
  thumbnails?: boolean
  /** The dialog's name; the gallery's own name or "Gallery". */
  label?: string
}

const navButtonSx = {
  position: 'absolute',
  top: '50%',
  transform: 'translateY(-50%)',
  zIndex: 1,
  color: 'common.white',
  bgcolor: (theme: Theme) => alpha(theme.palette.common.black, 0.45),
  '&:hover': { bgcolor: (theme: Theme) => alpha(theme.palette.common.black, 0.65) },
} as const

export function ImageLightbox(props: ImageLightboxProps) {
  const { open, onClose, gallery, appearance, thumbnails, label } = props
  const { pictures } = gallery
  const count = pictures.length
  const [index, setIndex] = useState(gallery.index)
  // A new opening starts at the picture pressed, not where the last one left off.
  useEffect(() => {
    if (open) setIndex(gallery.index)
  }, [open, gallery])
  const swipeStart = useRef<{ x: number; y: number } | null>(null)
  const current = pictures[Math.min(index, Math.max(count - 1, 0))]
  if (!current) return null
  const many = count > 1
  const go = (step: number) => setIndex((value) => stepIndex(value, step, count))
  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!many) return
    if (event.key === 'ArrowRight') go(1)
    else if (event.key === 'ArrowLeft') go(-1)
    else if (event.key === 'Home') setIndex(0)
    else if (event.key === 'End') setIndex(count - 1)
    else return
    event.preventDefault()
  }
  const handlePointerDown = (event: PointerEvent<HTMLElement>) => {
    swipeStart.current = { x: event.clientX, y: event.clientY }
  }
  const handlePointerUp = (event: PointerEvent<HTMLElement>) => {
    const start = swipeStart.current
    swipeStart.current = null
    if (!start || !many) return
    const dx = event.clientX - start.x
    const dy = event.clientY - start.y
    // Sideways and far enough: a scroll or a tap is neither.
    if (Math.abs(dx) < SWIPE_THRESHOLD_PX || Math.abs(dx) < Math.abs(dy)) return
    go(dx < 0 ? 1 : -1)
  }
  const placement = appearance?.captionPlacement ?? 'below'
  const caption = placement !== 'hidden' ? current.caption : undefined
  const ownCloseLook = Boolean(appearance?.closeStyle && appearance.closeStyle !== 'icon')
  return (
    <LightboxDialog
      open={open}
      onClose={onClose}
      label={label || (many ? 'Gallery' : current.alt || 'Picture')}
      closeLabel={many ? 'Close gallery' : 'Close picture'}
      appearance={appearance}
      onKeyDown={handleKeyDown}
      maxWidth="lg"
      // The pictures float on the backdrop: no sheet behind them.
      paperSx={{
        // `background`, not a colour alone: it also clears the overlay
        // gradient a dark theme lays on every paper.
        background: 'transparent',
        boxShadow: 'none',
        overflow: 'visible',
        alignItems: 'center',
      }}
      closeButtonSx={
        ownCloseLook
          ? undefined
          : { color: 'common.white', bgcolor: (theme: Theme) => alpha(theme.palette.common.black, 0.45) }
      }
    >
      <Box
        component="figure"
        sx={{
          position: 'relative',
          m: 0,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          minHeight: 0,
          // A swipe moves between pictures, never the page behind them.
          touchAction: 'pan-y',
        }}
        onPointerDown={handlePointerDown}
        onPointerUp={handlePointerUp}
      >
        <Box sx={{ position: 'relative', maxWidth: '100%' }}>
          <Box
            component="img"
            key={current.src}
            src={current.src}
            srcSet={current.srcSet}
            // The whole screen is the slot, so the browser takes the
            // full-size variant the media CDN already holds.
            sizes="100vw"
            alt={current.alt}
            // Requested only now, because the visitor asked for it.
            loading="eager"
            draggable={false}
            sx={{
              display: 'block',
              maxWidth: '100%',
              maxHeight: thumbnails && many ? 'calc(100vh - 220px)' : 'calc(100vh - 140px)',
              width: 'auto',
              height: 'auto',
              objectFit: 'contain',
              userSelect: 'none',
              borderRadius: appearance?.radius !== undefined ? `${appearance.radius}px` : undefined,
            }}
          />
          {caption && placement === 'overlay' ? (
            <Typography
              component="figcaption"
              variant="body2"
              sx={{
                position: 'absolute',
                left: 0,
                right: 0,
                bottom: 0,
                px: 2,
                py: 1.5,
                color: 'common.white',
                background: (theme: Theme) =>
                  `linear-gradient(transparent, ${alpha(theme.palette.common.black, 0.7)})`,
              }}
            >
              {caption}
            </Typography>
          ) : null}
        </Box>
        {many ? (
          <>
            <IconButton
              aria-label="Previous picture"
              onClick={() => go(-1)}
              sx={[navButtonSx, { left: { xs: 4, sm: -56 } }]}
            >
              <MdiIcon path={mdiChevronLeft.path} />
            </IconButton>
            <IconButton
              aria-label="Next picture"
              onClick={() => go(1)}
              sx={[navButtonSx, { right: { xs: 4, sm: -56 } }]}
            >
              <MdiIcon path={mdiChevronRight.path} />
            </IconButton>
          </>
        ) : null}
        {(caption && placement === 'below') || many ? (
          <Box
            sx={{
              display: 'flex',
              gap: 2,
              alignItems: 'baseline',
              justifyContent: 'space-between',
              width: '100%',
              pt: 1.5,
              color: 'common.white',
            }}
          >
            {caption && placement === 'below' ? (
              <Typography component="figcaption" variant="body2">
                {caption}
              </Typography>
            ) : (
              <span />
            )}
            {many ? (
              <Typography
                variant="body2"
                aria-live="polite"
                aria-label={`Picture ${index + 1} of ${count}`}
                sx={{ whiteSpace: 'nowrap', opacity: 0.85 }}
              >
                {`${index + 1} / ${count}`}
              </Typography>
            ) : null}
          </Box>
        ) : null}
      </Box>
      {thumbnails && many ? (
        <Box
          role="group"
          aria-label="Pictures"
          sx={{
            display: 'flex',
            gap: 1,
            pt: 1.5,
            overflowX: 'auto',
            maxWidth: '100%',
            justifyContent: 'safe center',
          }}
        >
          {pictures.map((picture, position) => (
            <Box
              key={`${picture.src}-${position}`}
              component="button"
              type="button"
              onClick={() => setIndex(position)}
              aria-label={`Show picture ${position + 1}${picture.alt ? `: ${picture.alt}` : ''}`}
              aria-current={position === index ? 'true' : undefined}
              sx={{
                flex: '0 0 auto',
                p: 0,
                border: 2,
                borderColor: position === index ? 'common.white' : 'transparent',
                borderRadius: 1,
                bgcolor: 'transparent',
                cursor: 'pointer',
                opacity: position === index ? 1 : 0.6,
                '&:focus-visible': { outline: '2px solid', outlineColor: 'common.white' },
              }}
            >
              <Box
                component="img"
                src={picture.src}
                srcSet={picture.srcSet}
                sizes="64px"
                alt=""
                sx={{ display: 'block', width: 64, height: 48, objectFit: 'cover', borderRadius: 0.5 }}
                {...Aglyn.DEFERRED_IMAGE_ATTRIBUTES}
              />
            </Box>
          ))}
        </Box>
      ) : null}
    </LightboxDialog>
  )
}
ImageLightbox.displayName = 'ImageLightbox'

export default ImageLightbox
