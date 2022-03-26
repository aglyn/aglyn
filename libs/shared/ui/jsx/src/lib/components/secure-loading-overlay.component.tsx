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

import {mergeSxProps} from '@aglyn/shared-feature-themes'
import {AglynSvgLogo} from '@aglyn/shared-ui-jsx'
import {Box, Modal, type ModalProps as MuiModalProps, Stack} from '@mui/material'
import CircularProgress from '@mui/material/CircularProgress'
import {forwardRef} from 'react'
import LoadingTextComponent from './loading-text.component'


export interface SecureLoadingOverlayProps extends Partial<MuiModalProps<any, any>> {}

const SecureLoadingOverlayComponent = forwardRef<any, SecureLoadingOverlayProps>(
  function RefRenderFn(props, ref) {
    const {sx, ...rest} = props
    return (
      <Modal
        ref={ref}
        open
        sx={mergeSxProps({
          zIndex: 'blocking',
          color: 'text.primary',

          '& .MuiBackdrop-root': {
            backgroundColor: theme => theme.palette.background.paper,
          },
        }, sx)}
        {...rest}
      >
        <Box
          sx={{
            position: 'absolute',
            top: 0, right: 0, bottom: 0, left: 0,
            flexDirection: 'column',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexSpacing: 2,
          }}
        >
          <Stack
            direction="column"
            justifyContent="center"
            alignItems="center"
            spacing={2}
          >
            <AglynSvgLogo sx={{width: 280, maxWidth: 1}} color="secondary" />
            <CircularProgress color="secondary" />
            <LoadingTextComponent
              component="div"
              variant="overline"
              sx={{fontWeight: 'fontWeightBold'}}
            >
              {'One moment'}
            </LoadingTextComponent>
          </Stack>
        </Box>
      </Modal>
    )
  },
)
SecureLoadingOverlayComponent.displayName = 'SecureLoadingOverlayComponent'

export {SecureLoadingOverlayComponent}
export default SecureLoadingOverlayComponent
