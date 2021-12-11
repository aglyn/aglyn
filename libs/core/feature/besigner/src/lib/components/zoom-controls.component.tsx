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

import { styled } from '@aglyn/shared-feature-themes'
import { SrOnlyComponent, SvgPathIcon } from '@aglyn/shared-ui-jsx'
import { _isFnT } from '@aglyn/shared-util-guards'
import { yes } from '@aglyn/shared-util-tools'
import Button from '@mui/material/Button'
import ButtonGroup from '@mui/material/ButtonGroup'

import Tooltip from '@mui/material/Tooltip'
import { ChangeEvent, EventHandler, forwardRef, HTMLAttributes, useCallback } from 'react'

const ZoomControls = styled('div', {
  name: 'AglynZoomControls'
})(({ theme }) => ({
  position: 'absolute',
  bottom: theme.spacing(1),
  zIndex: theme.zIndex.appBar,
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

export interface ZoomControlsComponentProps extends HTMLAttributes<HTMLDivElement> {
  disableZoomResetButton?: boolean
  disableZoomDecreaseButton?: boolean
  disableZoomIncreaseButton?: boolean
  onZoomReset?: EventHandler<any>
  onZoomDecrease?: EventHandler<any>
  onZoomIncrease?: EventHandler<any>
}

export const ZoomControlsComponent = forwardRef<any, ZoomControlsComponentProps>(
  function RefRenderFn(props, ref) {
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
      [onZoomReset]
    )

    const handleZoomDecrease = useCallback(
      (e: ChangeEvent<unknown>) => {
        if (_isFnT(onZoomDecrease)) {
          onZoomDecrease(e)
        }
      },
      [onZoomDecrease]
    )

    const handleZoomIncrease = useCallback(
      (e: ChangeEvent<unknown>) => {
        if (_isFnT(onZoomIncrease)) {
          onZoomIncrease(e)
        }
      },
      [onZoomIncrease]
    )

    const buttons = [
      {
        id: 'reset-zoom',
        tooltipProps: {
          title: 'Reset zoom',
        },
        srOnlyProps: {
          children: 'Reset zoom',
        },
        buttonProps: {
          disabled: yes(disableZoomResetButton),
          onClick: handleZoomReset,
        },
        svgPathIconProps: {
          iconIds: 'fit-to-page',
        },
      },
      {
        id: 'decrease-zoom',
        tooltipProps: {
          title: 'Decrease zoom (⌘-)',
        },
        srOnlyProps: {
          children: 'Decrease zoom (⌘-)',
        },
        buttonProps: {
          disabled: yes(disableZoomDecreaseButton),
          onClick: handleZoomDecrease,
        },
        svgPathIconProps: {
          iconIds: 'magnify-minus',
        },
      },
      {
        id: 'increase-zoom',
        tooltipProps: {
          title: 'Increase zoom (⌘+)',
        },
        srOnlyProps: {
          children: 'Increase zoom (⌘+)',
        },
        buttonProps: {
          disabled: yes(disableZoomIncreaseButton),
          onClick: handleZoomIncrease,
        },
        svgPathIconProps: {
          iconIds: 'magnify-plus',
        },
      },
    ]

    return (
      <ZoomControls ref={ref} {...rest}>
        <ButtonGroup variant="contained" color="primary" aria-label="zoom controls">
          {buttons.map(({ id, tooltipProps, srOnlyProps, buttonProps, svgPathIconProps }) => (
            <Tooltip key={id} {...tooltipProps}>
              <Button {...buttonProps}>
                <SvgPathIcon fontSize="small" {...svgPathIconProps} />
                <SrOnlyComponent component="span" {...srOnlyProps} />
              </Button>
            </Tooltip>
          ))}
        </ButtonGroup>
      </ZoomControls>
    )
  }
)

ZoomControlsComponent.displayName = 'ZoomControlsComponent'
ZoomControlsComponent.defaultProps = {}

export default ZoomControlsComponent
