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

import {alpha, styled} from '@aglyn/shared-feature-themes'
import {
  Backdrop as MuiBackdrop,
  type BackdropProps as MuiBackdropProps,
  CircularProgress,
  LinearProgress,
  Typography,
} from '@mui/material'
import Portal, {PortalProps as MuiPortalProps} from '@mui/material/Portal'
import {forwardRef} from 'react'
import {LoadingConsumer} from '../contexts/loading.context'


const LoadingBackdrop = styled(MuiBackdrop, {
  name: 'AglynLoadingBackdrop',
})(({theme}) => ({
  backgroundColor: alpha(theme.palette.common.white, 0.48),
  color: theme.palette.getContrastText(alpha(theme.palette.common.white, 0.36)),
  zIndex: 9999999,
  flexDirection: 'column',
  backdropFilter: 'blur(5px)',
}))

const LoadingProgressBar = styled(LinearProgress, {
  name: 'AglynLoadingProgressBar',
})(({theme}) => ({
  position: 'absolute',
  top: 0,
  left: 0,
  backgroundColor: alpha(theme.palette.primary.main, 0.86),
  width: '100%',
}))

export interface LoadingOverlayComponentProps extends Partial<MuiBackdropProps>, Partial<MuiPortalProps> {}

const LoadingOverlayComponent = forwardRef<any, LoadingOverlayComponentProps>(
  function RefRenderFn(props, ref) {
    const {open, children, disablePortal, container, ...rest} = props

    return (
      <>
        {children}
        <Portal disablePortal={disablePortal} container={container}>
          <LoadingConsumer>
            {({loading}) => (
              <LoadingBackdrop
                ref={ref}
                open={open || loading}
                mountOnEnter
                unmountOnExit
                {...rest}
              >
                <LoadingProgressBar color="secondary" />
                <CircularProgress color="secondary" />
                <Typography
                  children="Loading..."
                  component="div"
                  variant="overline"
                  sx={{mt: 2, fontWeight: 'fontWeightBold'}}
                />
              </LoadingBackdrop>
            )}
          </LoadingConsumer>
        </Portal>
      </>
    )
  },
)

LoadingOverlayComponent.displayName = 'LoadingOverlayComponent'

export {LoadingOverlayComponent}
export default LoadingOverlayComponent
