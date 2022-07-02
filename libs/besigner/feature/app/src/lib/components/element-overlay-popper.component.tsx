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

import {
  BesignerCanvasItemValue,
  type BesignerCanvasState,
} from '@aglyn/besigner-data-app'
import { type KeyOf } from '@aglyn/shared-data-types'
import { useSubscribable } from '@aglyn/shared-ui-jsx'
import {
  Popper as MuiPopper,
  type PopperProps as MuiPopperProps,
} from '@mui/material'
import ElementOverlayActionsComponent from 'libs/besigner/feature/app/src/lib/components/element-overlay-actions.component'
import { forwardRef, useMemo } from 'react'
import { useRenderedCanvasElementRef } from '../contexts/rendered-canvas-elements'
import useBesignerAppContext from '../utils/use-besigner-app-context'
import { ElementOverlayLabelComponent } from './element-overlay-label.component'
import ElementOverlayOutlineComponent from './element-overlay-outline.component'

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
      tether: false,
      rootBoundary: 'viewport',
      padding: 0,
    },
  },
]

const defaultClientRect = {
  width: 0,
  height: 0,
  left: 0,
  top: 0,
  x: 0,
  y: 0,
} as DOMRect
const virtualElement = {
  ...defaultClientRect,
  getBoundingClientRect: (): DOMRect => ({
    ...defaultClientRect,
    toJSON: () => ({ ...defaultClientRect }),
  }),
}

const variantToStoreName: Record<PopperVariant, KeyOf<BesignerCanvasState>> = {
  selectedOverlay: 'selected',
  hoveredOverlay: 'hovered',
}

export type PopperVariant = 'hoveredOverlay' | 'selectedOverlay'

export interface ElementOverlayPopperComponentProps
  extends Partial<MuiPopperProps> {
  variant: PopperVariant
}

const ElementOverlayPopperComponent = forwardRef<
  any,
  ElementOverlayPopperComponentProps
>((props, ref) => {
  const { variant, ...rest } = props || {}

  const app = useBesignerAppContext()
  const state = useSubscribable<BesignerCanvasItemValue>(
    app.besigner?.canvas,
    undefined,
    (canvas) => canvas?.[variantToStoreName[variant]],
    [variant, app],
  )

  const $id = state?.$id
  const elementRef = useRenderedCanvasElementRef({ $id })
  const isOpen = Boolean(elementRef?.node)

  const badgeElement = useMemo(() => {
    if (variant === 'selectedOverlay') {
      return <ElementOverlayActionsComponent $id={$id} />
    }
    return <ElementOverlayLabelComponent $id={$id} />
  }, [$id, variant])

  return (
    <MuiPopper
      ref={ref}
      anchorEl={elementRef?.node}
      placement="top-start"
      modifiers={modifiers}
      data-aglyn-overlay-id={$id}
      data-aglyn-overlay-popper={`outer-${variant}`}
      open={isOpen}
      keepMounted
      disablePortal
      {...rest}
    >
      <ElementOverlayOutlineComponent $id={$id}>
        <MuiPopper
          anchorEl={elementRef?.node}
          data-aglyn-overlay-popper={`inner-${variant}`}
          placement={variant === 'hoveredOverlay' ? 'top-start' : undefined}
          modifiers={[
            {
              name: 'flip',
              enabled: true,
              options: {
                altBoundary: true,
                rootBoundary: 'viewport',
                padding: 0,
              },
            },
            {
              name: 'preventOverflow',
              enabled: true,
              options: {
                altAxis: true,
                altBoundary: true,
                tether: true,
                rootBoundary: 'viewport',
                padding: 0,
              },
            },
          ]}
          open={isOpen}
          keepMounted
          disablePortal
          {...rest}
        >
          <div>{badgeElement}</div>
        </MuiPopper>
      </ElementOverlayOutlineComponent>
    </MuiPopper>
  )
})
ElementOverlayPopperComponent.displayName = 'ElementOverlayPopperComponent'
ElementOverlayPopperComponent.aglyn = true
ElementOverlayPopperComponent.defaultProps = {
  variant: 'hoveredOverlay',
}

export { ElementOverlayPopperComponent }
export default ElementOverlayPopperComponent
