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
 * The one lightbox every element opens (AGL-3717).
 *
 * The Video element's dialog (AGL-2744) was the first and, until this, the
 * only lightbox on a published page. Its shell — the MUI `Dialog`, the label
 * on the paper, the close control, the reduced-motion rule — is lifted out
 * here so the Image, the Image List's gallery and the Lightbox container open
 * the SAME dialog rather than three that drift apart. What each of them puts
 * inside it stays theirs.
 *
 * ## Load it lazily
 *
 * This module names `@mui/material/Dialog`. The barrel withholds it, and every
 * caller reaches it through `lazy(() => import())` once a visitor has asked
 * for the lightbox, because the Dialog/Modal/FocusTrap stack measured in the
 * first-load chunks of pages that open no dialog (AGL-1290). Import it by its
 * subpath, `@aglyn/shared-ui-jsx/components/lightbox/lightbox-dialog`, and
 * only from a module that is itself loaded on demand.
 *
 * ## The accessibility is the reason it is MUI's Dialog
 *
 * `Dialog` traps focus for the life of the overlay, returns it to the element
 * that opened it on close, closes on `Escape`, marks the paper
 * `aria-modal="true"` and the rest of the document inert for assistive
 * technology. Each of those is a thing a bespoke overlay gets wrong. What this
 * shell adds is the part `Dialog` cannot know: a NAME on the element that has
 * `role="dialog"` (the paper — props spread onto `<Dialog>` land on the
 * `role="presentation"` root, which once left the Video dialog unnamed), a
 * close control that is always there and always labelled, and motion that
 * stops for a visitor who asked for less of it.
 *
 * ## Nothing renders while closed
 *
 * `Dialog` keeps no children mounted while closed, and the callers mount this
 * only once armed. Whatever a lightbox shows — a film, a full-size picture, a
 * form — is not in the document until it opens, so it costs a page nothing.
 */
'use client'

import { mdiClose } from '@aglyn/shared-data-mdi'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Dialog, { type DialogProps } from '@mui/material/Dialog'
import Fade from '@mui/material/Fade'
import IconButton from '@mui/material/IconButton'
import type { SxProps, Theme } from '@mui/material/styles'
import useMediaQuery from '@mui/material/useMediaQuery'
import Zoom from '@mui/material/Zoom'
import type { KeyboardEvent, ReactNode } from 'react'
import { MdiIcon } from '../mdi-icon'
import {
  type LightboxAppearance,
  lightboxBackdropBackground,
} from './lightbox-appearance'

/** Why the dialog was asked to close. */
export type LightboxCloseReason = 'escapeKeyDown' | 'backdropClick' | 'closeButton'

/** The appearance every lightbox takes when an element sets none. */
export const DEFAULT_LIGHTBOX_APPEARANCE: LightboxAppearance = {
  closeOnBackdrop: true,
  closeOnEscape: true,
}

export interface LightboxDialogProps {
  open: boolean
  onClose: () => void
  /** The dialog's accessible name. Required: an unnamed dialog is a defect. */
  label: string
  /** The close control's accessible name. */
  closeLabel?: string
  appearance?: LightboxAppearance
  /**
   * A chance to refuse one close: return `true` to keep the dialog open. The
   * Video uses it so `Escape` in full screen leaves full screen first.
   */
  interceptClose?: (reason: LightboxCloseReason) => boolean
  onKeyDown?: (event: KeyboardEvent<HTMLDivElement>) => void
  /**
   * `false` when the content draws its own {@link LightboxCloseButton} — the
   * Video does, inside the frame that goes full screen.
   */
  closeButton?: boolean
  /** The frame's width rule when the appearance names no max width. */
  maxWidth?: DialogProps['maxWidth']
  fullWidth?: boolean
  /** Extra styles for the paper — the Video's black ground, for one. */
  paperSx?: SxProps<Theme>
  /** Extra styles for the close control. */
  closeButtonSx?: SxProps<Theme>
  children?: ReactNode
}

/** `prefers-reduced-motion` — the transitions drop to nothing under it. */
export function useLightboxReducedMotion(): boolean {
  return useMediaQuery('(prefers-reduced-motion: reduce)')
}

export interface LightboxCloseButtonProps {
  onClick: () => void
  label: string
  appearance?: LightboxAppearance
  sx?: SxProps<Theme>
}

/** Where the close control sits, by the appearance's position. */
function closePositionSx(
  position: LightboxAppearance['closePosition'],
): SxProps<Theme> {
  if (position === 'outside-end') {
    // Fixed to the screen: the dialog's container is not transformed once
    // open, so `fixed` resolves against the viewport, and the button stays
    // inside the dialog's focus trap where a portal of its own would not.
    return (theme) => ({
      position: 'fixed',
      top: theme.spacing(2),
      right: theme.spacing(2),
      zIndex: 2,
    })
  }
  return (theme) => ({
    position: 'absolute',
    top: theme.spacing(1),
    ...(position === 'inside-start'
      ? { left: theme.spacing(1) }
      : { right: theme.spacing(1) }),
    zIndex: 1,
  })
}

/** The close control: the same one in every lightbox, styled by appearance. */
export function LightboxCloseButton(props: LightboxCloseButtonProps) {
  const { onClick, label, appearance, sx } = props
  const style = appearance?.closeStyle ?? 'icon'
  const position = closePositionSx(appearance?.closePosition)
  const extra = Array.isArray(sx) ? sx : sx ? [sx] : []
  if (style === 'text') {
    return (
      <Button
        onClick={onClick}
        aria-label={label}
        size="small"
        variant="contained"
        color="inherit"
        sx={[position, ...extra]}
      >
        Close
      </Button>
    )
  }
  return (
    <IconButton
      onClick={onClick}
      aria-label={label}
      size="small"
      sx={[
        position,
        ...(style === 'filled'
          ? [
              {
                bgcolor: 'common.white',
                color: 'common.black',
                boxShadow: 2,
                '&:hover': { bgcolor: 'grey.200' },
              },
            ]
          : []),
        ...extra,
      ]}
    >
      <MdiIcon path={mdiClose.path} fontSize="small" />
    </IconButton>
  )
}
LightboxCloseButton.displayName = 'LightboxCloseButton'

/**
 * The dialog. Mounted by a caller once armed; renders nothing while closed.
 */
export function LightboxDialog(props: LightboxDialogProps) {
  const {
    open,
    onClose,
    label,
    closeLabel = 'Close',
    appearance = DEFAULT_LIGHTBOX_APPEARANCE,
    interceptClose,
    onKeyDown,
    closeButton = true,
    maxWidth,
    fullWidth,
    paperSx,
    closeButtonSx,
    children,
  } = props
  const reduceMotion = useLightboxReducedMotion()
  const transition = reduceMotion ? 'none' : (appearance.transition ?? 'fade')
  const requestClose = (reason: LightboxCloseReason) => {
    if (reason === 'backdropClick' && !appearance.closeOnBackdrop) return
    if (reason === 'escapeKeyDown' && !appearance.closeOnEscape) return
    if (interceptClose?.(reason)) return
    onClose()
  }
  const backdropBackground = lightboxBackdropBackground(appearance)
  const blur = appearance.backdropBlur
  const extraPaperSx = Array.isArray(paperSx) ? paperSx : paperSx ? [paperSx] : []
  return (
    <Dialog
      open={open}
      onClose={(_event, reason) => requestClose(reason)}
      // Only when given: an explicit `onKeyDown={undefined}` reaches the
      // Modal root after its own handler and replaces it, which silently
      // took Escape away from every lightbox that passed none.
      {...(onKeyDown ? { onKeyDown } : {})}
      maxWidth={appearance.maxWidth ? false : maxWidth}
      fullWidth={fullWidth}
      transitionDuration={transition === 'none' ? 0 : undefined}
      slots={transition === 'zoom' ? { transition: Zoom } : { transition: Fade }}
      slotProps={{
        backdrop: {
          sx: {
            ...(backdropBackground ? { backgroundColor: backdropBackground } : {}),
            ...(blur ? { backdropFilter: `blur(${blur}px)` } : {}),
          },
        },
        paper: {
          // ⚠️ The label goes on the PAPER, which carries `role="dialog"`;
          // see the module comment.
          'aria-label': label,
          sx: [
            {
              position: 'relative',
              ...(appearance.maxWidth
                ? { maxWidth: `min(${appearance.maxWidth}, calc(100% - 64px))` }
                : {}),
              ...(appearance.maxWidth && fullWidth ? { width: '100%' } : {}),
              ...(appearance.maxHeight
                ? { maxHeight: `min(${appearance.maxHeight}, calc(100% - 64px))` }
                : {}),
              ...(appearance.padding ? { p: appearance.padding } : {}),
              ...(appearance.radius !== undefined
                ? { borderRadius: `${appearance.radius}px` }
                : {}),
            },
            ...extraPaperSx,
          ],
        },
      }}
    >
      {closeButton ? (
        <LightboxCloseButton
          onClick={() => requestClose('closeButton')}
          label={closeLabel}
          appearance={appearance}
          sx={closeButtonSx}
        />
      ) : null}
      {children}
    </Dialog>
  )
}
LightboxDialog.displayName = 'LightboxDialog'

/** The frame's inner box, for content that wants the paper's full height. */
export function LightboxFrame(props: { children?: ReactNode; sx?: SxProps<Theme> }) {
  const extra = Array.isArray(props.sx) ? props.sx : props.sx ? [props.sx] : []
  return (
    <Box
      sx={[
        {
          position: 'relative',
          display: 'flex',
          flexDirection: 'column',
          flex: '1 1 auto',
          minHeight: 0,
        },
        ...extra,
      ]}
    >
      {props.children}
    </Box>
  )
}

export default LightboxDialog
