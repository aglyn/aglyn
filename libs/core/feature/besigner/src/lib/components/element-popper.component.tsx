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
import MuiPopper, { PopperProps as MuiPopperProps } from '@mui/material/Popper'
import { forwardRef, RefObject } from 'react'
import { useBesignerElementInteractionActivity } from '../hooks/use-besigner-element-interaction-activity'
import { ElementBadgeComponent } from './element-badge.component'
import { AglynElementOutlineProps, ElementOutlineComponent } from './element-outline.component'


export interface ElementPopperComponentProps extends Partial<MuiPopperProps> {
  $id: ElementId
  isOver?: boolean
  isDragging?: boolean
  variant?: AglynElementOutlineProps['variant']
  badgeable?: boolean
  onGetElementRef: ($id: ElementId) => RefObject<Element>
}

const ElementPopperComponent = forwardRef<any, ElementPopperComponentProps>(
  function RefRenderFn(props, ref) {
    const {$id, isOver, isDragging, variant, badgeable, onGetElementRef, ...rest} = props

    const anchorRef = onGetElementRef($id)
    const {isSelfHovered, isSelfSelected} = useBesignerElementInteractionActivity($id)

    const isTypeSelect = variant === 'selected'
    const outlineType = (isDragging || isSelfSelected) && isTypeSelect ? 'selected' : 'hovered'

    const isOutlineable = Boolean(isOver || isDragging || isSelfHovered || isSelfSelected)
    const outlineOpen = Boolean(isOutlineable && anchorRef?.current)

    const isBadgeable = Boolean(isSelfSelected && outlineOpen)
    const badgeOpen = Boolean(isTypeSelect && isBadgeable)

    const modifiers = [
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
    ]

    return (
      <MuiPopper
        ref={ref}
        open={outlineOpen}
        anchorEl={anchorRef?.current}
        placement="top-start"
        modifiers={modifiers}
        keepMounted
        disablePortal
        {...rest}
      >
        <ElementOutlineComponent
          data-aglyn-element-outline={variant}
          anchorEl={anchorRef?.current}
          variant={outlineType}
        />

        {badgeable && (
          <ElementBadgeComponent
            data-aglyn-element-badge={variant}
            anchorEl={anchorRef?.current}
            open={badgeOpen}
            $id={$id}
          />
        )}
      </MuiPopper>
    )
  },
)
ElementPopperComponent.displayName = 'ElementPopperComponent'
ElementPopperComponent.defaultProps = {
  variant: 'hovered',
}

export { ElementPopperComponent }
export default ElementPopperComponent
