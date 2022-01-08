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
  type BesignerCanvasState,
  BesignerPanelTabFlag,
  duplicateCanvasElement,
  setBesignerCanvasHovered,
  setBesignerCanvasSelected,
  setBesignerPanels,
} from '@aglyn/core-data-framework'
import {useAglynAppContext, useAglynElementData} from '@aglyn/core-feature-renderer'
import {type KeyOf} from '@aglyn/shared-data-types'
import MuiPopper, {type PopperProps as MuiPopperProps} from '@mui/material/Popper'
import {type ChangeEvent, forwardRef, useCallback} from 'react'
import {CanvasRenderedElementRefsConsumer} from '../contexts/canvas-rendered-element-refs'
import useAglynBesignerStoreState from '../hooks/use-aglyn-besigner-store-state'
import ElementOverlayBadgeComponent from './element-overlay-badge.component'
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

const defaultClientRect = ({
  width: 0, height: 0,
  left: 0, top: 0, x: 0, y: 0,
}) as DOMRect
const virtualElement = {
  ...defaultClientRect,
  getBoundingClientRect: (): DOMRect => ({
    ...defaultClientRect,
    toJSON: () => ({...defaultClientRect}),
  }),
}


const variantToStoreName: Record<PopperVariant, KeyOf<BesignerCanvasState>> = {
  selectedOverlay: 'selected',
  hoveredOverlay: 'hovered',
}

export type PopperVariant =
  | 'hoveredOverlay'
  | 'selectedOverlay'

export interface ElementOverlayPopperComponentProps extends Partial<MuiPopperProps> {
  variant: PopperVariant
}

const ElementOverlayPopperComponent = forwardRef<any, ElementOverlayPopperComponentProps>(
  function RefRenderFn(props, ref) {
    const {variant, id, ...rest} = props || {}


    const {getApp} = useAglynAppContext()
    const store = variantToStoreName[variant]
    const state = useAglynBesignerStoreState('canvas', store)
    const $id = state?.$id
    const parentId = useAglynElementData($id, 'parentId')


    const handleDuplicateClick = useCallback((e: ChangeEvent<unknown>) => {
      duplicateCanvasElement(getApp(), {$id})
    }, [$id, getApp])


    const handleModifyClick = useCallback((e: ChangeEvent<unknown>) => {
      setBesignerPanels(getApp(), {
        panels: (panels) => ({
          ...panels,
          panelRight: {
            ...panels.panelRight,
            toggled: true,
            tab: BesignerPanelTabFlag.ELEMENT_PROPS_FORM,
          },
        }),
      })
    }, [getApp])


    const handleSelectParentClick = useCallback((e: ChangeEvent<unknown>) => {
      setBesignerCanvasSelected(getApp(), {
        selected: (prev) => ({
          ...prev,
          $id: parentId,
        }),
      })
    }, [getApp, parentId])


    const handleHoverParent = useCallback((e: ChangeEvent<unknown>) => {
      setBesignerCanvasHovered(getApp(), {
        hovered: (prev) => ({
          ...prev,
          $id: parentId,
        }),
      })
    }, [getApp, parentId])


    const handleHoverParentLeave = useCallback((e: ChangeEvent<unknown>) => {
      setBesignerCanvasHovered(getApp(), {
        hovered: (prev) => ({
          ...prev,
          $id: null,
        }),
      })
    }, [getApp])

    return (
      <CanvasRenderedElementRefsConsumer>
        {([, , getElementRef]) => {
          const data = getElementRef($id)
          const anchorEl = data?.element?.current || virtualElement,
            dragHandleRef = data?.dragHandle

          // console.log('anchorEl', variant, $id, getElementRef($id))

          return (
            <MuiPopper
              ref={ref}
              id={id}
              anchorEl={anchorEl}
              placement="top-start"
              modifiers={modifiers}
              data-aglyn-overlay-id={$id}
              data-aglyn-overlay-variant={variant}
              data-aglyn-overlay-type="popper"
              open={Boolean(anchorEl)}
              keepMounted
              disablePortal
              {...rest}
            >
              <ElementOverlayOutlineComponent
                $id={$id}
                anchorEl={anchorEl}
                data-aglyn-overlay-id={$id}
                data-aglyn-overlay-variant={variant}
                data-aglyn-overlay-type="outline"
              >

                {variant === 'selectedOverlay' && (
                  <ElementOverlayBadgeComponent
                    $id={$id}
                    data-aglyn-overlay-id={$id}
                    data-aglyn-overlay-variant={variant}
                    data-aglyn-overlay-type="badge"
                    dragHandleRef={dragHandleRef}
                    onModifyClick={handleModifyClick}
                    onDuplicateClick={handleDuplicateClick}
                    onSelectParentClick={handleSelectParentClick}
                    onHoverParent={handleHoverParent}
                    onHoverParentLeave={handleHoverParentLeave}
                    sx={{
                      boxShadow: 4,
                      pointerEvents: 'auto',
                      marginTop: `-2.1em`,
                      position: 'absolute',
                    }}
                  />
                )}
              </ElementOverlayOutlineComponent>
            </MuiPopper>
          )
        }}
      </CanvasRenderedElementRefsConsumer>
    )
  },
)
ElementOverlayPopperComponent.displayName = 'ElementOverlayPopperComponent'
ElementOverlayPopperComponent.defaultProps = {
  variant: 'hoveredOverlay',
}

export {ElementOverlayPopperComponent}
export default ElementOverlayPopperComponent
