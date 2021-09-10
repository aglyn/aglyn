/**
 * @license
 * Copyright 2021 Aglyn LLC
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

import { alpha, styled } from '@aglyn/shared/ui/themes'
import MuiBackdrop, { BackdropProps as MuiBackdropProps } from '@mui/material/Backdrop'
import CircularProgress from '@mui/material/CircularProgress'
import LinearProgress from '@mui/material/LinearProgress'
import Typography from '@mui/material/Typography'
import { useRouter } from 'next/router'
import React, { useEffect, useState } from 'react'
import { withAppLoader, WithAppLoaderProps } from '../contexts/app-loader-context'
import { NextRouterEvent } from '../hooks/router-events'


const LoadingBackdrop = styled(MuiBackdrop, {
  name: 'LoadingBackdrop',
})(({theme}) => ({
  backgroundColor: alpha(theme.palette.common.white, 0.48),
  color: theme.palette.getContrastText(alpha(theme.palette.common.white, 0.36)),
  zIndex: 9999999,
  flexDirection: 'column',
  backdropFilter: 'blur(5px)',
}))

const LoadingProgressBar = styled(LinearProgress, {
  name: 'LoadingProgressBar',
})(({theme}) => ({
  position: 'absolute',
  top: 0, left: 0,
  backgroundColor: alpha(theme.palette.primary.main, 0.86),
  width: '100%',
}))

export interface AppLoaderOverlayProps extends Partial<MuiBackdropProps>, WithAppLoaderProps {}

const AppLoaderOverlayView = React.forwardRef<any, AppLoaderOverlayProps>(
  function RefRenderFn(props, ref) {
    const {
      classes,
      open,
      appLoader,
      ...rest
    } = props
    const isOpen = Boolean(open || appLoader?.isLoading)
    const [loading, setLoading] = useState(false)
    const router = useRouter()
    useEffect(() => {
      const handleStart = () => {
        setLoading(true)
      }
      const handleEnd = () => {
        setLoading(false)
      }
      router.events.on(NextRouterEvent.ROUTE_CHANGE_START, handleStart)
      router.events.on(NextRouterEvent.ROUTE_CHANGE_COMPLETE, handleEnd)
      router.events.on(NextRouterEvent.ROUTE_CHANGE_ERROR, handleEnd)
      return () => {
        router.events.off(NextRouterEvent.ROUTE_CHANGE_START, handleStart)
        router.events.off(NextRouterEvent.ROUTE_CHANGE_COMPLETE, handleEnd)
        router.events.off(NextRouterEvent.ROUTE_CHANGE_ERROR, handleEnd)
      }
    }, [])

    return (
      <LoadingBackdrop
        ref={ref}
        open={isOpen || loading}
        mountOnEnter
        unmountOnExit
        {...rest}
      >
        <LoadingProgressBar color="secondary"/>
        <CircularProgress color="secondary"/>
        <Typography
          children="Loading..."
          component="div"
          variant="overline"
          sx={{mt: 2}}
        />
      </LoadingBackdrop>
    )
  },
)

AppLoaderOverlayView.displayName = 'AppLoaderOverlayView'

export default withAppLoader(AppLoaderOverlayView)
