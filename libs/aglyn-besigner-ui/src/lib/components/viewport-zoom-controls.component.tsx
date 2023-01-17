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

import { SrOnly } from '@aglyn/shared-ui-jsx'
import {
  mdiFitToPage,
  MdiIcon,
  type MdiIconProps,
  mdiMagnifyMinus,
  mdiMagnifyPlus,
} from '@aglyn/shared-ui-mdi-jsx'
import { styled } from '@aglyn/shared-ui-theme'
import { _isFnT } from '@aglyn/shared-util-guards'
import { truthy } from '@aglyn/shared-util-tools'
import Button from '@mui/material/Button'
import ButtonGroup from '@mui/material/ButtonGroup'
import Tooltip from '@mui/material/Tooltip'
import {
  type ChangeEvent,
  type EventHandler,
  forwardRef,
  type HTMLAttributes,
  useCallback,
} from 'react'

const ViewportZoomControls = styled('div', {
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
  extends HTMLAttributes<HTMLDivElement> {
  disableZoomResetButton?: boolean
  disableZoomDecreaseButton?: boolean
  disableZoomIncreaseButton?: boolean
  onZoomReset?: EventHandler<any>
  onZoomDecrease?: EventHandler<any>
  onZoomIncrease?: EventHandler<any>
}

export const ViewportZoomControlsComponent = forwardRef<
  any,
  ViewportZoomControlsComponentProps
>((props, ref) => {
  const {
    disableZoomResetButton,
    disableZoomDecreaseButton,
    disableZoomIncreaseButton,
    onZoomReset,
    onZoomDecrease,
    onZoomIncrease,
    ...rest
  } = props

  const handleZoomReset = useCallback(
    (e: ChangeEvent<unknown>) => {
      if (_isFnT(onZoomReset)) {
        onZoomReset(e)
      }
    },
    [onZoomReset],
  )

  const handleZoomDecrease = useCallback(
    (e: ChangeEvent<unknown>) => {
      if (_isFnT(onZoomDecrease)) {
        onZoomDecrease(e)
      }
    },
    [onZoomDecrease],
  )

  const handleZoomIncrease = useCallback(
    (e: ChangeEvent<unknown>) => {
      if (_isFnT(onZoomIncrease)) {
        onZoomIncrease(e)
      }
    },
    [onZoomIncrease],
  )

  const buttons = [
    {
      key: 'vp-zoom-reset',
      id: 'reset-zoom',
      tooltipProps: {
        title: 'Reset zoom',
      },
      srOnlyProps: {
        children: 'Reset zoom',
      },
      buttonProps: {
        disabled: truthy(disableZoomResetButton),
        onClick: handleZoomReset,
      },
      svgPathIconProps: {
        path: mdiFitToPage.path,
      } as MdiIconProps,
    },
    {
      key: 'vp-zoom-decrease',
      id: 'decrease-zoom',
      tooltipProps: {
        title: 'Decrease zoom (⌘-)',
      },
      srOnlyProps: {
        children: 'Decrease zoom (⌘-)',
      },
      buttonProps: {
        disabled: truthy(disableZoomDecreaseButton),
        onClick: handleZoomDecrease,
      },
      svgPathIconProps: {
        path: mdiMagnifyMinus.path,
      },
    },
    {
      key: 'vp-zoom-increase',
      id: 'increase-zoom',
      tooltipProps: {
        title: 'Increase zoom (⌘+)',
      },
      srOnlyProps: {
        children: 'Increase zoom (⌘+)',
      },
      buttonProps: {
        disabled: truthy(disableZoomIncreaseButton),
        onClick: handleZoomIncrease,
      },
      svgPathIconProps: {
        path: mdiMagnifyPlus.path,
      },
    },
  ]

  return (
    <ViewportZoomControls ref={ref} id="aglyn:viewport-zoom-controls" {...rest}>
      <ButtonGroup
        variant="contained"
        color="primary"
        aria-label="zoom controls"
      >
        {buttons.map(
          (
            {
              tooltipProps,
              srOnlyProps,
              buttonProps,
              svgPathIconProps,
              ...item
            },
            key,
          ) => (
            <Tooltip key={item.key ?? item.id ?? key} {...tooltipProps}>
              <Button {...buttonProps}>
                <MdiIcon fontSize="small" {...svgPathIconProps} />
                <SrOnly component="span" {...srOnlyProps} />
              </Button>
            </Tooltip>
          ),
        )}
      </ButtonGroup>
    </ViewportZoomControls>
  )
})

ViewportZoomControlsComponent.displayName = 'ViewportZoomControlsComponent'
ViewportZoomControlsComponent.aglyn = true
ViewportZoomControlsComponent.defaultProps = {}

export default ViewportZoomControlsComponent
