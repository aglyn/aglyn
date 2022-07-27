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

import type {
  BesignerCanvasItemValue,
  BesignerCanvasState,
} from '@aglyn/besigner-data-app'
import useAglynCanvasElementStatus from '@aglyn/besigner-feature-app/hooks/use-aglyn-canvas-element-status'
import type { NodeId } from '@aglyn/core-data-foundation'
import { ICON_VARIANT_MODIFY_ADD } from '@aglyn/shared-data-enums'
import type { KeyOf } from '@aglyn/shared-data-types'
import { useSubscribable } from '@aglyn/shared-ui-jsx'
import MdiIcon from '@aglyn/shared-ui-mdi-jsx/components/mdi-icon'
import { styled } from '@aglyn/shared-ui-theme'
import {
  Fab,
  FabProps,
  Popper as MuiPopper,
  type PopperProps as MuiPopperProps,
} from '@mui/material'
import { forwardRef, useMemo, useState } from 'react'
import { useRenderedCanvasElementRef } from '../contexts/rendered-canvas-elements'
import useAddElementDrawerCallback from '../hooks/use-add-element-drawer-callback'
import useBesignerAppContext from '../hooks/use-besigner-app-context'
import ElementOverlayActionsComponent from './element-overlay-actions.component'
import ElementOverlayLabelComponent from './element-overlay-label.component'
import ElementOverlayOutlineComponent from './element-overlay-outline.component'

type ActiveAddArea = 'top' | 'right' | 'bottom' | 'left' | null

interface AddButtonProps extends FabProps {
  active?: boolean
  $id?: NodeId
}

const AddElementOverlay = styled(
  (props: Omit<AddButtonProps, 'active'>) => {
    const { $id, ...rest } = props
    const handleAddElementClick = useAddElementDrawerCallback()
    return (
      <Fab
        color="secondary"
        variant="circular"
        size="small"
        onClick={(e) => handleAddElementClick(e, { $id })}
        {...rest}
      >
        <MdiIcon
          path={ICON_VARIANT_MODIFY_ADD.path}
          fontSize="inherit"
          color="inherit"
        />
      </Fab>
    )
  },
  {
    name: 'AddElementOverlay',
    shouldForwardProp: (prop) => prop !== 'active',
  },
)<AddButtonProps>(({ active }) => ({
  visibility: active ? undefined : 'hidden',
  borderRadius: '50%',
  minWidth: 'unset',
  minHeight: 'unset',
  height: 24,
  width: 24,
  paddingLeft: 4,
  paddingRight: 4,
  paddingTop: 2,
  paddingBottom: 2,
  fontSize: 14,
  boxShadow: 'none',
}))

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
  const { isSelfSelected } = useAglynCanvasElementStatus($id)
  const elementRef = useRenderedCanvasElementRef({ $id })
  const isOpen = Boolean(elementRef?.node)
  const [outline, setOutline] = useState()

  const badgeElement = useMemo(() => {
    if (variant === 'selectedOverlay') {
      return <ElementOverlayActionsComponent $id={$id} />
    }
    return <ElementOverlayLabelComponent $id={$id} />
  }, [$id, variant])

  const addHelperOpen = isOpen && !isSelfSelected

  return (
    <>
      <MuiPopper
        anchorEl={() => elementRef?.node}
        data-aglyn-overlay-popper={`addHelper-${variant}`}
        placement={'bottom'}
        modifiers={innerModifiers}
        open={addHelperOpen}
        disablePortal
        {...rest}
      >
        <div>
          <AddElementOverlay $id={$id} active={addHelperOpen} />
        </div>
      </MuiPopper>
      <MuiPopper
        ref={ref}
        anchorEl={() => elementRef?.node}
        placement="top-start"
        modifiers={outerModifiers}
        data-aglyn-overlay-id={$id}
        data-aglyn-overlay-popper={`outer-${variant}`}
        open={isOpen}
        keepMounted
        disablePortal
        {...rest}
      >
        {({ placement, TransitionProps }) => {
          return (
            <>
              <ElementOverlayOutlineComponent ref={setOutline} $id={$id} />

              <MuiPopper
                anchorEl={() => elementRef?.node}
                data-aglyn-overlay-popper={`inner-${variant}`}
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
})
ElementOverlayPopperComponent.displayName = 'ElementOverlayPopperComponent'
ElementOverlayPopperComponent.aglyn = true
ElementOverlayPopperComponent.defaultProps = {
  variant: 'hoveredOverlay',
}

export { ElementOverlayPopperComponent }
export default ElementOverlayPopperComponent
