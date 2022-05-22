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
  BesignerPanelTabFlag,
  setBesignerPanels,
} from '@aglyn/core-data-besigner'
import {duplicateCanvasElement} from '@aglyn/core-data-framework'
import {useAglynElementData, useAglynElementLabel} from '@aglyn/core-feature-renderer'
import {type KeyOf} from '@aglyn/shared-data-types'
import {useSubscribable} from '@aglyn/shared-ui-jsx'
import {Box} from '@mui/material'
import MuiPopper, {type PopperProps as MuiPopperProps} from '@mui/material/Popper'
import {type ChangeEvent, forwardRef, useCallback} from 'react'
import {RenderedCanvasElementsContext} from '../contexts/rendered-canvas-elements'
import {useAglynCanvasSetHovered} from '../hooks/use-aglyn-canvas-hovered'
import {useAglynCanvasSetSelected} from '../hooks/use-aglyn-canvas-selected'
import useBesignerAppContext from '../utils/use-besigner-app-context'
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


    const app = useBesignerAppContext()
    const state = useSubscribable<BesignerCanvasItemValue>(
      app.besigner?.canvas, undefined,
      (canvas) => canvas?.[variantToStoreName[variant]],
      [variant, app],
    )

    const $id = state?.$id
    const parentId = useAglynElementData($id, 'parentId')
    const setHovered = useAglynCanvasSetHovered()
    const setSelected = useAglynCanvasSetSelected()
    const badgeLabel = useAglynElementLabel($id)

    const handleDuplicateClick = useCallback((e: ChangeEvent<unknown>) => {
      duplicateCanvasElement(app, {$id})
    }, [$id, app])


    const handleModifyClick = useCallback((e: ChangeEvent<unknown>) => {
      setBesignerPanels(app, {
        panels: (panels) => ({
          ...panels,
          panelRight: {
            ...panels.panelRight,
            toggled: true,
            tab: BesignerPanelTabFlag.ELEMENT_PROPS_FORM,
          },
        }),
      })
    }, [app])


    const handleSelectParentClick = useCallback((e: ChangeEvent<unknown>) => {
      setSelected({$id: parentId})
    }, [parentId, setSelected])


    const handleHoverParent = useCallback((e: ChangeEvent<unknown>) => {
      setHovered({$id: parentId})
    }, [parentId, setHovered])


    const handleHoverParentLeave = useCallback((e: ChangeEvent<unknown>) => {
      setHovered(undefined)
    }, [setHovered])

    return (
      <RenderedCanvasElementsContext.Consumer>
        {([, , getElementRef]) => {
          const data = getElementRef($id)
          const anchorEl = data?.element?.current || virtualElement,
            dragHandleRef = data?.dragHandle

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


                <MuiPopper
                  anchorEl={anchorEl}
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
                  data-aglyn-overlay-id={$id}
                  data-aglyn-overlay-variant={variant}
                  data-aglyn-overlay-type="popper"
                  open={Boolean(anchorEl)}
                  keepMounted
                  disablePortal
                  {...rest}
                >
                  <div>
                    {{
                      'selectedOverlay': (

                        <ElementOverlayBadgeComponent
                          $id={$id}
                          data-aglyn-overlay-id={$id}
                          data-aglyn-overlay-variant={variant}
                          data-aglyn-overlay-type="badge-actions"
                          dragHandleRef={dragHandleRef}
                          onModifyClick={handleModifyClick}
                          onDuplicateClick={handleDuplicateClick}
                          onSelectParentClick={handleSelectParentClick}
                          onHoverParent={handleHoverParent}
                          onHoverParentLeave={handleHoverParentLeave}
                          sx={{
                            boxShadow: 4,
                            pointerEvents: 'auto',
                          }}
                        />
                      ),
                      'hoveredOverlay': (
                        <Box
                          data-aglyn-overlay-id={$id}
                          data-aglyn-overlay-variant={variant}
                          data-aglyn-overlay-type="badge-label"
                          sx={{
                            pointerEvents: 'none',
                            // marginTop: '-20px',
                            marginLeft: '-2px',
                            bgcolor: 'secondary.main',
                            color: 'secondary.contrastText',
                            whiteSpace: 'nowrap',
                            textOverflow: 'ellipsis',
                            overflow: 'hidden',
                            px: 0.6, py: 0.4,
                            lineHeight: 1,
                            maxWidth: 120,
                            fontSize: 12,
                          }}
                        >
                          {badgeLabel}
                        </Box>
                      ),
                    }[variant]}
                  </div>
                </MuiPopper>
              </ElementOverlayOutlineComponent>
            </MuiPopper>
          )
        }}
      </RenderedCanvasElementsContext.Consumer>
    )
  },
)
ElementOverlayPopperComponent.displayName = 'ElementOverlayPopperComponent'
ElementOverlayPopperComponent.aglyn = true
ElementOverlayPopperComponent.defaultProps = {
  variant: 'hoveredOverlay',
}

export {ElementOverlayPopperComponent}
export default ElementOverlayPopperComponent
