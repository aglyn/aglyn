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

import {
  mdiFitToPage,
  MdiIcon,
  mdiMagnifyMinus,
  mdiMagnifyPlus,
  SrOnly,
} from '@aglyn/shared-ui-jsx'
import { styled } from '@aglyn/shared-ui-theme'
import { _isFnT } from '@aglyn/shared-util-tools'
import Button from '@mui/material/Button'
import ButtonGroup from '@mui/material/ButtonGroup'
import Tooltip from '@mui/material/Tooltip'
import type { ComponentProps } from 'react'
import {
  type ChangeEvent,
  type EventHandler,
  forwardRef,
  useCallback,
} from 'react'

const ZoomControlsWrapper = styled('div', {
  name: 'AglynViewportZoomControls',
})(({ theme }) => ({
  display: 'none',
  position: 'absolute',
  bottom: theme.spacing(1),
  zIndex: theme.zIndex.tooltip,
  opacity: 0.32,
  transition: theme.transitions.create(['opacity', 'filter'], {
    easing: theme.transitions.easing.sharp,
    duration: theme.transitions.duration.leavingScreen,
  }),
  ['&:hover']: {
    opacity: 1,
    transition: theme.transitions.create(['opacity', 'filter'], {
      easing: theme.transitions.easing.easeOut,
      duration: theme.transitions.duration.enteringScreen,
    }),
  },
}))

export interface ViewportZoomControlsComponentProps
  extends ComponentProps<typeof ZoomControlsWrapper> {
  disableZoomReset?: boolean
  disableZoomDecrease?: boolean
  disableZoomIncrease?: boolean
  onZoomReset?: EventHandler<any>
  onZoomDecrease?: EventHandler<any>
  onZoomIncrease?: EventHandler<any>
}

export const ViewportZoomControls = forwardRef<
  any,
  ViewportZoomControlsComponentProps
>((props, ref) => {
  const {
    disableZoomReset,
    disableZoomDecrease,
    disableZoomIncrease,
    onZoomReset,
    onZoomDecrease,
    onZoomIncrease,
    ...rest
  } = props

  const handleReset = useCallback(
    (e: ChangeEvent<unknown>) => {
      if (_isFnT(onZoomReset)) {
        onZoomReset(e)
      }
    },
    [onZoomReset],
  )

  const handleDecrease = useCallback(
    (e: ChangeEvent<unknown>) => {
      if (_isFnT(onZoomDecrease)) {
        onZoomDecrease(e)
      }
    },
    [onZoomDecrease],
  )

  const handleIncrease = useCallback(
    (e: ChangeEvent<unknown>) => {
      if (_isFnT(onZoomIncrease)) {
        onZoomIncrease(e)
      }
    },
    [onZoomIncrease],
  )

  return (
    <ZoomControlsWrapper ref={ref} id="aglyn:viewport-zoom-controls" {...rest}>
      <ButtonGroup
        variant="contained"
        color="primary"
        aria-label="zoom controls"
        size="small"
      >
        <Tooltip title="Reset zoom">
          <Button disabled={disableZoomReset} onClick={handleReset}>
            <MdiIcon fontSize="inherit" path={mdiFitToPage.path} />
            <SrOnly>{'Reset zoom'}</SrOnly>
          </Button>
        </Tooltip>
        <Tooltip title="Decrease zoom (⌘-)">
          <Button disabled={disableZoomDecrease} onClick={handleDecrease}>
            <MdiIcon fontSize="inherit" path={mdiMagnifyMinus.path} />
            <SrOnly>{'Decrease zoom (⌘-)'}</SrOnly>
          </Button>
        </Tooltip>
        <Tooltip title="Increase zoom (⌘+)">
          <Button disabled={disableZoomIncrease} onClick={handleIncrease}>
            <MdiIcon fontSize="inherit" path={mdiMagnifyPlus.path} />
            <SrOnly>{'Increase zoom (⌘+)'}</SrOnly>
          </Button>
        </Tooltip>
      </ButtonGroup>
    </ZoomControlsWrapper>
  )
})

ViewportZoomControls.displayName = 'ViewportZoomControls'

export default ViewportZoomControls
