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

// eslint-disable-next-line @nx/enforce-module-boundaries
import { mergeSxProps } from '@aglyn/shared-ui-theme'
import {
  Box,
  CircularProgress,
  Modal,
  type ModalProps as MuiModalProps,
  Stack,
} from '@mui/material'
import { forwardRef } from 'react'
import { AglynLogoFull } from '../const/svg-icons'
import LoadingTextComponent from './loading-text.component'

export interface SplashScreenProps extends Partial<MuiModalProps<any, any>> {}

const SplashScreen = forwardRef<any, SplashScreenProps>((props, ref) => {
  const { sx, ...rest } = props
  const _sx = mergeSxProps(
    {
      zIndex: 'max',
      color: 'text.primary',

      '& .MuiBackdrop-root': {
        backgroundColor: (theme) => (theme as any).vars?.palette.background.paper ?? theme.palette.background.paper,
      },
    },
    sx,
  )
  return (
    <Modal ref={ref} sx={_sx} open {...rest}>
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
          flexSpacing: 2,
        }}
      >
        <Stack
          direction="column"
          spacing={2}
          sx={{
            justifyContent: "center",
            alignItems: "center"
          }}>
          <AglynLogoFull sx={{ fontSize: 175 }} />
          <CircularProgress color="secondary" />
          <LoadingTextComponent
            variant="overline"
            sx={{ fontWeight: 'fontWeightBold' }}
          >
            {'One moment'}
          </LoadingTextComponent>
        </Stack>
      </Box>
    </Modal>
  );
})
SplashScreen.displayName = 'SplashScreen'
SplashScreen.aglyn = true

export { SplashScreen }
export default SplashScreen
