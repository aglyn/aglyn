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

import { ClickAwayListener, type ClickAwayListenerProps } from '@mui/material'
import {
  forwardRef,
  type HTMLAttributes,
  useCallback,
  useEffect,
  useRef,
} from 'react'
import { REASONS } from '../utils/constants'
import useEventCallback from '../utils/useEventCallback'

export interface SnackbarProps extends HTMLAttributes<HTMLDivElement> {
  autoHideDuration?
  ClickAwayListenerProps?: Partial<ClickAwayListenerProps>
  disableWindowBlurListener?: boolean
  resumeHideDuration?: number
  open?: boolean
  onClose?
}

const Snackbar = forwardRef<any, SnackbarProps>((props, ref) => {
  const {
    children,
    autoHideDuration,
    ClickAwayListenerProps,
    disableWindowBlurListener = false,
    onClose,
    onMouseEnter,
    onMouseLeave,
    open,
    resumeHideDuration,
    ...rest
  } = props

  const timerAutoHide = useRef<NodeJS.Timeout>()

  const handleClose = useEventCallback((...args) => {
    if (onClose) {
      onClose(...args)
    }
  })

  const setAutoHideTimer = useEventCallback((autoHideDurationParam) => {
    if (!onClose || autoHideDurationParam == null) {
      return
    }

    clearTimeout(timerAutoHide.current)
    timerAutoHide.current = setTimeout(() => {
      handleClose(null, REASONS.TIMEOUT)
    }, autoHideDurationParam)
  })

  useEffect(() => {
    if (open) {
      setAutoHideTimer(autoHideDuration)
    }

    return () => {
      clearTimeout(timerAutoHide.current)
    }
  }, [open, autoHideDuration, setAutoHideTimer])

  /**
   * Pause the timer when the user is interacting with the Snackbar
   * or when the user hide the window.
   */
  const handlePause = () => {
    clearTimeout(timerAutoHide.current)
  }

  /**
   * Restart the timer when the user is no longer interacting with the
   * Snackbar or when the window is shown back.
   */
  const handleResume = useCallback(() => {
    if (autoHideDuration != null) {
      setAutoHideTimer(
        resumeHideDuration != null
          ? resumeHideDuration
          : autoHideDuration * 0.5,
      )
    }
  }, [autoHideDuration, resumeHideDuration, setAutoHideTimer])

  const handleMouseEnter = (event) => {
    if (onMouseEnter) {
      onMouseEnter(event)
    }
    handlePause()
  }

  const handleMouseLeave = (event) => {
    if (onMouseLeave) {
      onMouseLeave(event)
    }
    handleResume()
  }

  const handleClickAway = (event) => {
    if (onClose) {
      onClose(event, REASONS.CLICKAWAY)
    }
  }

  useEffect(() => {
    if (!disableWindowBlurListener && open) {
      window.addEventListener('focus', handleResume)
      window.addEventListener('blur', handlePause)

      return () => {
        window.removeEventListener('focus', handleResume)
        window.removeEventListener('blur', handlePause)
      }
    }

    return undefined
  }, [disableWindowBlurListener, handleResume, open])

  return (
    <ClickAwayListener
      onClickAway={handleClickAway}
      {...ClickAwayListenerProps}
    >
      <div
        ref={ref}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        {...rest}
      >
        {children}
      </div>
    </ClickAwayListener>
  )
})
Snackbar.displayName = 'Snackbar'
Snackbar.aglyn = true

export { Snackbar }
export default Snackbar
