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

import * as Aglyn from '@aglyn/aglyn'
import * as Besigner from '@aglyn/besigner'
import type { KeyOf } from '@aglyn/shared-data-types'
import {
  Popper as MuiPopper,
  type PopperProps as MuiPopperProps,
} from '@mui/material'
import { observer } from 'mobx-react-lite'
import { type MutableRefObject, useMemo } from 'react'
import { useRenderedCanvasElementRef } from '../contexts/rendered-canvas-elements'
import ElementOverlayActionsComponent from './element-overlay-actions.component'
import ElementOverlayLabelComponent from './element-overlay-label.component'
import ElementOverlayOutlineComponent from './element-overlay-outline.component'

const outerModifiers = [
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

const innerModifiers = [
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
]

const variantToStoreName: Record<
  PopperVariant,
  KeyOf<Pick<typeof Besigner.focus.state, 'lastSelected' | 'hovered'>>
> = {
  selectedOverlay: 'lastSelected',
  hoveredOverlay: 'hovered',
}

export type PopperVariant = string & ('hoveredOverlay' | 'selectedOverlay')

export interface ElementOverlayPopperComponentProps
  extends Partial<MuiPopperProps> {
  variant: PopperVariant
}

const ElementOverlayPopper = (
  props: ElementOverlayPopperComponentProps,
  ref: MutableRefObject<any>,
) => {
  const { variant, ...rest } = props || {}

  const state = Besigner.focus.state[variantToStoreName[variant] || 'hovered']
  const $id = state?.$id
  const node = Aglyn.screen.getNode($id)

  const isSelected = Besigner.focus.isNodeSelected(node)
  const elementRef = useRenderedCanvasElementRef({ $id })
  const isOpen = Boolean(elementRef?.node)

  const badgeElement = useMemo(() => {
    if (variant === 'selectedOverlay') {
      return <ElementOverlayActionsComponent $id={$id} />
    }
    return <ElementOverlayLabelComponent node={node} />
  }, [$id, node, variant])

  return (
    <>
      <MuiPopper
        ref={ref}
        anchorEl={() => elementRef?.node}
        placement="top-start"
        modifiers={outerModifiers}
        data-aglyn-node={$id}
        data-aglyn-kind={'overlay-popper-out'}
        open={isOpen}
        keepMounted
        disablePortal
        {...rest}
      >
        {({ placement, TransitionProps }) => {
          return (
            <>
              <ElementOverlayOutlineComponent $id={$id} />

              <MuiPopper
                anchorEl={() => elementRef?.node}
                data-aglyn-node={$id}
                data-aglyn-kind={'overlay-popper-in'}
                placement={
                  variant === 'hoveredOverlay' ? 'top-start' : undefined
                }
                modifiers={innerModifiers}
                open={isOpen}
                sx={{
                  ['&[data-popper-placement^=top] #aglyn\\:element-overlay-label']:
                    {
                      borderTopLeftRadius: 3,
                      borderTopRightRadius: 3,
                      borderBottomLeftRadius: 0,
                      borderBottomRightRadius: 0,
                    },
                  ['&[data-popper-placement^=bottom] #aglyn\\:element-overlay-label']:
                    {
                      borderTopLeftRadius: 0,
                      borderTopRightRadius: 0,
                      borderBottomLeftRadius: 3,
                      borderBottomRightRadius: 3,
                    },
                }}
                disablePortal
                {...rest}
              >
                <div>{badgeElement}</div>
              </MuiPopper>
            </>
          )
        }}
      </MuiPopper>
    </>
  )
}

ElementOverlayPopper.displayName = 'ElementOverlayPopperComponent'
ElementOverlayPopper.aglyn = true

export const ElementOverlayPopperComponent = observer<
  ElementOverlayPopperComponentProps,
  any
>(ElementOverlayPopper, {
  forwardRef: true,
})

export default ElementOverlayPopperComponent
