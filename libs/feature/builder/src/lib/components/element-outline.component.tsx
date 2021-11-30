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

import { ElementId } from '@aglyn/core-data-framework'
import { generateComponentClassKeys, styled } from '@aglyn/shared-feature-themes'
import { getElementClientRectBounding } from '@aglyn/shared-util-dom'
import Box, { BoxProps } from '@mui/material/Box'
import MuiPopper, { PopperProps as MuiPopperProps } from '@mui/material/Popper'
import clsx from 'clsx'
import { forwardRef, RefObject, useMemo, useState } from 'react'
import { useBuilderElementInteractionActivity } from '../hooks/use-builder-element-interaction-activity'
import ElementBadgeComponent from './element-badge.component'


const classKeys = generateComponentClassKeys('AglynElementOutlineComponent', [
  'open',
  'hovered',
  'selected',
])

export interface AglynElementOutlineProps extends BoxProps {
  type?: 'hovered' | 'selected'
  open?: boolean
}

export const AglynElementOutline = styled(
  forwardRef<any, AglynElementOutlineProps>(
    function RefRenderFn(props, ref) {
      const {className: classNameProp, type, open, ...rest} = props
      const className = clsx({
        [classKeys.open]: Boolean(open),
        [classKeys.hovered]: type === 'hovered' || !type,
        [classKeys.selected]: type === 'selected',
      }, classNameProp)
      return <Box ref={ref} className={className} {...rest} />
    },
  ),
  {
    name: 'AglynElementOutline',
  },
)(({theme}) => ({
  pointerEvents: 'none',
  position: 'absolute',
  left: 0, top: 0, right: 0, bottom: 0,
  marginLeft: -2, marginTop: -2,
  visibility: 'hidden',
  transition: theme.transitions.create(['width', 'height'], {
    duration: theme.transitions.duration.short,
    easing: theme.transitions.easing.easeInOut,
  }),
  overflow: 'hidden',
  [`&.${classKeys.open}`]: {
    visibility: 'visible',
  },
  [`&.${classKeys.hovered}`]: {
    outlineWidth: 3,
    outlineOffset: -2,
    outlineColor: theme.palette.quaternary.main,
    outlineStyle: 'dashed',
  },
  [`&.${classKeys.selected}`]: {
    outlineWidth: 3,
    outlineOffset: 1,
    outlineColor: theme.palette.secondary.light,
    outlineStyle: 'solid',
  },
}))

export interface ElementOutlineComponentProps extends Partial<MuiPopperProps> {
  $id: ElementId
  anchorRef?: RefObject<any>
  isOver?: boolean
  isDragging?: boolean
  type?: AglynElementOutlineProps['type']
}


const ElementOutlineComponent = forwardRef<any, ElementOutlineComponentProps>(
  function RefRenderFn(props, ref) {
    const {
      $id,
      anchorRef,
      isOver,
      isDragging,
      type,
      ...rest
    } = props

    const [outlineRef, setOutlineRef] = useState(null)

    const isTypeSelect = type === 'selected'

    const {isSelfHovered, isSelfSelected} = useBuilderElementInteractionActivity($id)
    const outlineType = (isDragging || isSelfSelected) && isTypeSelect ? 'selected' : 'hovered'

    const isOutlineable = Boolean(isOver || isDragging || isSelfHovered || isSelfSelected)
    const outlineOpen = Boolean(isOutlineable && anchorRef?.current)

    const isBadgeable = Boolean(isTypeSelect && isSelfSelected && outlineOpen)
    const badgeOpen = Boolean(isBadgeable)

    const {width, height} = useMemo(() => {
      const rect = anchorRef?.current
        ? getElementClientRectBounding(anchorRef?.current as any)
        : {} as any
      return {
        width: (rect.width ?? 0) + 4,
        height: (rect.height ?? 0) + 4,
      }
    }, [anchorRef?.current])


    return (
      <MuiPopper
        ref={ref}
        open={outlineOpen}
        anchorEl={anchorRef?.current}
        placement="top-start"
        keepMounted
        disablePortal
        modifiers={[
          {
            name: 'flip',
            enabled: false,
            options: {
              altBoundary: false,
              rootBoundary: 'viewport',
              padding: 0,
            },
          },
          {
            name: 'preventOverflow',
            enabled: false,
            options: {
              altAxis: false,
              altBoundary: false,
              tether: true,
              rootBoundary: 'viewport',
              padding: 0,
            },
          },
        ]}
        {...rest}
      >
        <AglynElementOutline
          style={{width, height}}
          ref={setOutlineRef}
          type={outlineType}
          open
        />

        {isTypeSelect && (
          <ElementBadgeComponent
            anchorEl={outlineRef}
            open={badgeOpen}
            $id={$id}
            arrow
          />
        )}
      </MuiPopper>
    )
  },
)
ElementOutlineComponent.displayName = 'ElementOutlineComponent'
ElementOutlineComponent.defaultProps = {}

export { ElementOutlineComponent }
export default ElementOutlineComponent
