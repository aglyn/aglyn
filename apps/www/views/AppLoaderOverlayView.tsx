import { _isFn } from '@aglyn/shared/util/helpers'
import MuiBackdrop, { BackdropProps as MuiBackdropProps } from '@material-ui/core/Backdrop'
import CircularProgress from '@material-ui/core/CircularProgress'
import LinearProgress from '@material-ui/core/LinearProgress'
import Slide, { SlideProps} from '@material-ui/core/Slide'
import Typography from '@material-ui/core/Typography'
import { createStyles, fade, Theme, WithStyles, withStyles } from '@material-ui/core/styles'
import clsx from 'clsx'
import { useRouter } from 'next/router'
import { QueueResponse, withAppLoader, WithAppLoaderProps } from '../contexts/app-loader-context'
import React, { useEffect, useState } from 'react'
import { NextRouterEvent } from '../hooks/router-events'

const styles = (theme: Theme) => createStyles({
  root: {
    backgroundColor: fade(theme.palette.common.white, 0.48),
    color: theme.palette.getContrastText(fade(theme.palette.common.white, 0.36)),
    zIndex: 9999999,
    flexDirection: 'column',
    backdropFilter: 'blur(5px)'
  },
  loadingBar: {
    position: 'absolute',
    top: 0, left: 0,
    backgroundColor: fade(theme.palette.primary.main, 0.86),
    width: '100%',
  },
  loadingCircle: {},
  label: {marginTop: theme.spacing(2)},
})

export type Props = Partial<MuiBackdropProps> & {
}

const AppLoaderOverlayView = React.forwardRef<any, Props & WithAppLoaderProps & WithStyles<typeof styles>>(
  function RefRenderFn(props, ref) {
    const {
      classes,
      open,
      className,
      appLoader,
      ...rest
    } = props
    const isOpen = Boolean(open || appLoader.isLoading)
    const _className = clsx(classes.root, className)
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
      <MuiBackdrop
        ref={ref}
        className={_className}
        open={isOpen || loading}
        mountOnEnter
        unmountOnExit
        {...rest}
      >
        <LinearProgress className={classes.loadingBar} color="secondary" />
        <CircularProgress className={classes.loadingCircle} color="secondary" />
        <Typography
          children="Loading..."
          className={classes.label}
          component="div"
          variant="overline"
        />
      </MuiBackdrop>
    )
  }
)

AppLoaderOverlayView.displayName = 'AppLoaderOverlayView'

export default withStyles(styles, { name: 'AppLoaderOverlayView' })(
  withAppLoader(AppLoaderOverlayView)
)
