/**
 * @license
 * Copyright 2024 Aglyn LLC
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
import { forwardRef, Fragment } from 'react'
import { AglynLogoFull } from '../const/svg-icons'
import { LoadingContext } from '../contexts/loading.context'
import LoadingTextComponent from './loading-text.component'

const LoadingOverlayModal = styled(Modal)(({ theme }) => {
  const tv = (theme as any).vars || theme
  return {
    zIndex: theme.zIndex.max,
    color: tv.palette.text.primary,

    ['& .MuiBackdrop-root']: {
      backdropFilter: 'blur(5px)',
      backgroundColor: `rgba(${tv.palette.background.paperChannel} / 0.48)`,
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
      backgroundColor: `rgba(${tv.palette.primary.mainChannel} / 0.86)`,
      width: '100%',
    },
    ['& .status-text']: {
      fontWeight: theme.typography.fontWeightBold,
    },
  }
})

export interface LoadingModalProps extends Partial<ModalProps> {
  /**
   * Brand the overlay for a tenant site (AGL-594): a site logo image
   * replaces the Aglyn logo in the bottom slot; with only a name, the
   * site name renders as text. Without either, the Aglyn logo shows —
   * the console's own look.
   */
  brandLogoUrl?: string
  brandName?: string
}

export const LoadingModal = forwardRef<any, LoadingModalProps>((props, ref) => {
  const { open, children, brandLogoUrl, brandName, ...rest } = props

  const brandSlotSx = {
    m: '0 auto',
    position: 'absolute',
    bottom: (theme: any) => theme.spacing(2),
  } as const

  return (
    <LoadingContext.Consumer>
      {({ loading }) => {
        const isOpen = Boolean(open || loading)

        return (
          <Fragment>
            {children}
            <LoadingOverlayModal
              ref={ref}
              open={isOpen}
              closeAfterTransition
              {...rest}
            >
              <div className="wrapper">
                <LinearProgress
                  color="secondary"
                  className="progress-bar-top"
                />
                <Stack
                  direction="column"
                  spacing={2}
                  sx={{
                    justifyContent: "center",
                    alignItems: "center",
                    flexGrow: 1
                  }}>
                  <div>
                    <CircularProgress color="secondary" />
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
                  <Typography
                    variant="h6"
                    sx={{ ...brandSlotSx, fontWeight: 600 }}
                  >
                    {brandName}
                  </Typography>
                ) : (
                  <AglynLogoFull sx={{ ...brandSlotSx, fontSize: 100 }} />
                )}
              </div>
            </LoadingOverlayModal>
          </Fragment>
        );
      }}
    </LoadingContext.Consumer>
  );
})
LoadingModal.displayName = 'LoadingModal'

export default LoadingModal
