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
'use client'

import {
  Box,
  CircularProgress,
  LinearProgress,
  Modal,
  type ModalProps,
  Stack,
  styled,
  Typography,
} from '@mui/material'
import { alpha } from '@mui/material/styles'
import { forwardRef } from 'react'
import { AglynLogoFull } from '../const/aglyn-logo-full'
import LoadingTextComponent from './loading-text.component'

const LoadingOverlayModal = styled(Modal)(({ theme }) => {
  // The overlay has two homes. The console's theme is built with
  // `cssVariables`, so `theme.vars` carries a `*Channel` triplet for every
  // palette color and `rgba(var(--…Channel) / a)` stays bound to the
  // variable: it follows a scheme switch without a re-render. A published
  // site renders under a plain `createTheme()` — no `vars`, no channel
  // triplets — where that template would spell `rgba(undefined / a)`, an
  // invalid declaration the browser drops. There the tint is composed from
  // the literal palette value instead.
  const backdropTint = theme.vars
    ? `rgba(${theme.vars.palette.background.paperChannel} / 0.48)`
    : alpha(theme.palette.background.paper, 0.48)
  const progressTint = theme.vars
    ? `rgba(${theme.vars.palette.primary.mainChannel} / 0.86)`
    : alpha(theme.palette.primary.main, 0.86)

  return {
    zIndex: theme.zIndex.max,
    color: (theme.vars || theme).palette.text.primary,

    ['& .MuiBackdrop-root']: {
      backdropFilter: 'blur(5px)',
      backgroundColor: backdropTint,
    },
    ['& .wrapper']: {
      position: 'absolute',
      top: 0,
      right: 0,
      bottom: 0,
      left: 0,
      height: '100%',
      width: '100%',
      flexDirection: 'column',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
    },
    ['& .progress-bar-top']: {
      position: 'absolute',
      top: 0,
      left: 0,
      backgroundColor: progressTint,
      width: '100%',
    },
    ['& .status-text']: {
      fontWeight: theme.typography.fontWeightBold,
    },
  }
})

export interface LoadingModalOverlayProps extends Partial<ModalProps> {
  /** Whether the overlay is showing; drives MUI's enter/exit transition. */
  open?: boolean
  /**
   * Brand the overlay for a tenant site (AGL-594): a site logo image
   * replaces the Aglyn logo in the bottom slot; with only a name, the
   * site name renders as text. Without either, the Aglyn logo shows —
   * the console's own look.
   */
  brandLogoUrl?: string
  brandName?: string
}

/**
 * The overlay itself: the scrim, the two progress indicators and the brand
 * slot (AGL-594).
 *
 * A module of its own so {@link LoadingModal} can reach it through
 * `next/dynamic` (AGL-2706). Everything here draws only while a navigation is
 * in flight, and everything here is expensive to carry until then: MUI's
 * `Modal` pulls `ModalManager`, `FocusTrap`, `Backdrop` and `Fade`,
 * `CircularProgress` pulls the transition helpers, and `AglynLogoFull` is
 * 6 KB of inline path data — the platform's mark, which on a white-labelled
 * customer site is the one brand that must never be in the first paint.
 *
 * The layout above keeps `children` outside this file, so nothing a visitor
 * reads depends on this chunk having arrived.
 */
export const LoadingModalOverlay = forwardRef<any, LoadingModalOverlayProps>(
  (props, ref) => {
    const { open, brandLogoUrl, brandName, ...rest } = props

    const brandSlotSx = {
      m: '0 auto',
      position: 'absolute',
      bottom: (theme: any) => theme.spacing(2),
    } as const

    return (
      <LoadingOverlayModal
        ref={ref}
        open={Boolean(open)}
        closeAfterTransition
        {...rest}
      >
        <div className="wrapper">
          <LinearProgress color="primary" className="progress-bar-top" />
          <Stack
            direction="column"
            spacing={2}
            sx={{
              justifyContent: 'center',
              alignItems: 'center',
              flexGrow: 1,
            }}
          >
            <div>
              <CircularProgress color="primary" />
              <LoadingTextComponent
                variant="overline"
                className="status-text"
                sx={{ ml: -0.5 }}
              >
                Loading
              </LoadingTextComponent>
            </div>
          </Stack>
          {brandLogoUrl ? (
            <Box
              component="img"
              src={brandLogoUrl}
              alt={brandName || 'Site logo'}
              sx={{
                ...brandSlotSx,
                maxHeight: 48,
                maxWidth: 200,
                objectFit: 'contain',
              }}
            />
          ) : brandName ? (
            <Typography variant="h6" sx={{ ...brandSlotSx, fontWeight: 600 }}>
              {brandName}
            </Typography>
          ) : (
            <AglynLogoFull sx={{ ...brandSlotSx, fontSize: 100 }} />
          )}
        </div>
      </LoadingOverlayModal>
    )
  },
)
LoadingModalOverlay.displayName = 'LoadingModalOverlay'

export default LoadingModalOverlay
