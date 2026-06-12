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
  CircularProgress,
  LinearProgress,
  Modal,
  type ModalProps,
  Stack,
  styled,
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

export interface LoadingModalProps extends Partial<ModalProps> {}

export const LoadingModal = forwardRef<any, LoadingModalProps>((props, ref) => {
  const { open, children, ...rest } = props

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
                <AglynLogoFull
                  sx={{
                    fontSize: 100,
                    m: '0 auto',
                    position: 'absolute',
                    bottom: (theme) => theme.spacing(2),
                  }}
                />
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
