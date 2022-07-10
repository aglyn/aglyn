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
  BesignerPanelTabFlag,
  setBesignerPanels,
} from '@aglyn/besigner-data-app'
import { useRenderedCanvasElementRef } from '@aglyn/besigner-feature-app/contexts/rendered-canvas-elements'
import { useAglynCanvasSetHovered } from '@aglyn/besigner-feature-app/hooks/use-aglyn-canvas-hovered'
import { useAglynCanvasSetSelected } from '@aglyn/besigner-feature-app/hooks/use-aglyn-canvas-selected'
import {
  duplicateCanvasElement,
  isRootElementId,
  moveCanvasElement,
} from '@aglyn/core-data-app'
import type { ElementId } from '@aglyn/core-data-foundation'
import {
  useAglynElementData,
  useAglynElementIndexInParent,
} from '@aglyn/core-feature-renderer'
import {
  ICON_VARIANT_MODIFY_DRAG,
  ICON_VARIANT_MODIFY_DUPLICATE,
  ICON_VARIANT_MODIFY_EDIT,
  ICON_VARIANT_MODIFY_MOVE_DOWN,
  ICON_VARIANT_MODIFY_MOVE_UP,
  ICON_VARIANT_SELECT_PARENT,
} from '@aglyn/shared-data-enums'
import { SrOnly, type SrOnlyProps } from '@aglyn/shared-ui-jsx'
import { MdiIcon, type MdiIconProps } from '@aglyn/shared-ui-mdi-jsx'
import { mergeSxProps } from '@aglyn/shared-ui-theme'
import {
  Button as MuiButton,
  ButtonGroup as MuiButtonGroup,
  type ButtonGroupProps,
  type ButtonProps,
  Tooltip as MuiTooltip,
  type TooltipProps,
} from '@mui/material'
import { type ChangeEvent, forwardRef, useCallback } from 'react'
import useBesignerAppContext from '../hooks/use-besigner-app-context'

export interface BadgeButtonProps extends Omit<TooltipProps, 'children'> {
  children?: SrOnlyProps['children']
  icon: MdiIconProps
  ButtonProps?: ButtonProps
  SrOnlyProps?: SrOnlyProps
}

export const BadgeButton = forwardRef<any, BadgeButtonProps>((props, ref) => {
  const { children, ButtonProps, icon, SrOnlyProps, ...rest } = props

  return (
    <MuiTooltip ref={ref} {...rest}>
      <MuiButton
        {...ButtonProps}
        sx={mergeSxProps(
          {
            pt: 0.5,
            pb: 0.5,
            pl: 0.585,
            pr: 0.585,
            fontSize: 16,
            '&.MuiButtonGroup-grouped': { minWidth: 30 },
          },
          ButtonProps?.sx,
        )}
      >
        <MdiIcon fontSize="inherit" {...icon} />
        <SrOnly component="span" {...SrOnlyProps}>
          {children}
        </SrOnly>
      </MuiButton>
    </MuiTooltip>
  )
})
BadgeButton.displayName = 'AglynBadgeButton'

export const MoveButtons = forwardRef<any, { $id: ElementId }>((props, ref) => {
  const { $id } = props
  const app = useBesignerAppContext()
  const { index, isFirst, isLast, parentId } = useAglynElementIndexInParent($id)
  const handleMoveUp = useCallback(
    (e: ChangeEvent<unknown>) => {
      moveCanvasElement(app, { $id, parentId, index: index - 1 })
    },
    [app, $id, index, parentId],
  )
  const handleMoveDown = useCallback(
    (e: ChangeEvent<unknown>) => {
      moveCanvasElement(app, { $id, parentId, index: index + 1 })
    },
    [app, $id, index, parentId],
  )

  return (
    <>
      {!isFirst && (
        <BadgeButton
          ref={ref}
          title="Move up"
          children={'move up'}
          ButtonProps={{ onClick: handleMoveUp }}
          icon={{ path: ICON_VARIANT_MODIFY_MOVE_UP.path }}
        />
      )}
      {!isLast && (
        <BadgeButton
          ref={ref}
          title="Move down"
          children={'move down'}
          ButtonProps={{ onClick: handleMoveDown }}
          icon={{ path: ICON_VARIANT_MODIFY_MOVE_DOWN.path }}
        />
      )}
    </>
  )
})

export interface ElementOverlayActionsProps extends ButtonGroupProps {
  $id: ElementId
}

const ElementOverlayActionsComponent = forwardRef<
  any,
  ElementOverlayActionsProps
>((props, ref) => {
  const { $id, ...rest } = props

  const app = useBesignerAppContext()
  const setHovered = useAglynCanvasSetHovered()
  const setSelected = useAglynCanvasSetSelected()
  const parentId = useAglynElementData($id, 'parentId')
  const elementRef = useRenderedCanvasElementRef({ $id })

  const handleParentOnMouseLeave = useCallback(
    (e: ChangeEvent<unknown>) => {
      setHovered(undefined)
    },
    [setHovered],
  )

  const handleDuplicateClick = useCallback(
    (e: ChangeEvent<unknown>) => {
      duplicateCanvasElement(app, { $id })
    },
    [$id, app],
  )

  const handleModifyClick = useCallback(
    (e: ChangeEvent<unknown>) => {
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
    },
    [app],
  )

  const handleParentOnClick = useCallback(
    (e: ChangeEvent<unknown>) => {
      setSelected({ $id: parentId })
    },
    [parentId, setSelected],
  )

  const handleParentOnMouseEnter = useCallback(
    (e: ChangeEvent<unknown>) => {
      setHovered({ $id: parentId })
    },
    [parentId, setHovered],
  )

  return (
    <MuiButtonGroup
      ref={ref}
      id="aglyn:element-overlay-badge"
      data-aglyn-overlay-id={$id}
      data-aglyn-overlay-variant="actions"
      variant="contained"
      color="secondary"
      aria-label="element controls"
      sx={{
        boxShadow: 4,
        pointerEvents: 'auto',
      }}
      {...rest}
    >
      {!isRootElementId($id) && (
        <BadgeButton
          title="Drag"
          children="drag"
          sx={{ '&, &:hover, &:focus': { cursor: 'move' } }}
          // ref={dragHandleRef}
          ButtonProps={{
            ref: elementRef?.dragHandle,
            sx: { '&, &:hover, &:focus': { cursor: 'move' } },
          }}
          icon={{ path: ICON_VARIANT_MODIFY_DRAG.path }}
        />
      )}

      {!isRootElementId($id) && (
        <BadgeButton
          title="Duplicate"
          children="duplicate"
          ButtonProps={{ onClick: handleDuplicateClick }}
          icon={{ path: ICON_VARIANT_MODIFY_DUPLICATE.path }}
        />
      )}

      <BadgeButton
        title="Modify"
        children="modify"
        onClick={handleModifyClick}
        icon={{ path: ICON_VARIANT_MODIFY_EDIT.path }}
      />

      {!isRootElementId($id) && (
        <BadgeButton
          title="Select parent"
          children={'select parent'}
          ButtonProps={{
            onClick: handleParentOnClick,
            onMouseEnter: handleParentOnMouseEnter,
            onMouseLeave: handleParentOnMouseLeave,
          }}
          icon={{ path: ICON_VARIANT_SELECT_PARENT.path }}
        />
      )}

      {!isRootElementId($id) && <MoveButtons $id={$id} />}
    </MuiButtonGroup>
  )
})
ElementOverlayActionsComponent.displayName = 'ElementOverlayActionsComponent'
ElementOverlayActionsComponent.aglyn = true

export { ElementOverlayActionsComponent }
export default ElementOverlayActionsComponent
