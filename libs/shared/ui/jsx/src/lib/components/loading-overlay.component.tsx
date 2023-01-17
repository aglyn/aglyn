/**
 * @license
 * Copyright 2022 Aglyn LLC
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

// eslint-disable-next-line @nrwl/nx/enforce-module-boundaries
import { alpha, mergeSxProps } from '@aglyn/shared-ui-theme'
import {
  Box,
  CircularProgress,
  LinearProgress,
  Modal,
  type ModalProps as MuiModalProps,
  Stack,
} from '@mui/material'
import { forwardRef } from 'react'
import { LoadingContext } from '../contexts/loading.context'
import LoadingTextComponent from './loading-text.component'

export interface LoadingOverlayComponentProps
  extends Partial<MuiModalProps<any, any>> {}

const LoadingOverlayComponent = forwardRef<any, LoadingOverlayComponentProps>(
  (props, ref) => {
    const { open, children, sx, ...rest } = props

    return (
      <>
        {children}
        <LoadingContext.Consumer>
          {({ loading }) => (
            <Modal
              ref={ref}
              open={Boolean(open || loading)}
              sx={mergeSxProps(
                {
                  zIndex: 'max',
                  color: 'text.primary',

                  '& .MuiBackdrop-root': {
                    backdropFilter: 'blur(5px)',
                    backgroundColor: (theme) =>
                      alpha(theme.palette.background.paper, 0.48),
                  },
                },
                sx,
              )}
              {...rest}
            >
              <Box
                sx={{
                  position: 'absolute',
                  top: 0,
                  right: 0,
                  bottom: 0,
                  left: 0,
                  flexDirection: 'column',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <LinearProgress
                  color="secondary"
                  sx={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    backgroundColor: (theme) =>
                      alpha(theme.palette.primary.main, 0.86),
                    width: '100%',
                  }}
                />
                <Stack
                  direction="column"
                  justifyContent="center"
                  alignItems="center"
                  spacing={2}
                >
                  <CircularProgress color="secondary" />
                  <LoadingTextComponent
                    variant="overline"
                    sx={{ fontWeight: 'fontWeightBold' }}
                  >
                    {'Loading'}
                  </LoadingTextComponent>
                </Stack>
              </Box>
            </Modal>
          )}
        </LoadingContext.Consumer>
      </>
    )
  },
)

LoadingOverlayComponent.displayName = 'LoadingOverlayComponent'

export { LoadingOverlayComponent }
export default LoadingOverlayComponent
