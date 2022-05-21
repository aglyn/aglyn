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

import {type ElementId, isRootElementId} from '@aglyn/core-data-framework'
import {
  ICON_VARIANT_MODIFY_DRAG,
  ICON_VARIANT_MODIFY_DUPLICATE,
  ICON_VARIANT_MODIFY_EDIT,
  ICON_VARIANT_SELECT_PARENT,
} from '@aglyn/shared-data-enums'
import {mergeSxProps} from '@aglyn/shared-feature-themes'
import {SrOnlyComponent, type SrOnlyComponentProps} from '@aglyn/shared-ui-jsx'
import {MdiIcon, type MdiIconProps} from '@aglyn/shared-ui-mdi-jsx'
import {
  Button as MuiButton,
  ButtonGroup as MuiButtonGroup,
  type ButtonGroupProps,
  type ButtonProps,
  Tooltip as MuiTooltip,
  type TooltipProps,
} from '@mui/material'
import {type ChangeEvent, forwardRef, useCallback} from 'react'
import type {DragElementWrapper} from 'react-dnd'


export interface BadgeButtonProps extends Omit<TooltipProps, 'children'> {
  children?: SrOnlyComponentProps['children']
  icon: MdiIconProps
  ButtonProps?: ButtonProps
  SrOnlyProps?: SrOnlyComponentProps
}

export const BadgeButton = forwardRef<any, BadgeButtonProps>(
  function RefRenderFn(props, ref) {
    const {
      children,
      ButtonProps,
      icon,
      SrOnlyProps,
      ...rest
    } = props

    return (
      <MuiTooltip ref={ref} {...rest}>
        <MuiButton
          {...ButtonProps}
          sx={mergeSxProps({
            pt: 0.5, pb: 0.5, pl: 0.585, pr: 0.585,
            fontSize: 16,
            '&.MuiButtonGroup-grouped': {minWidth: 30},
          }, ButtonProps?.sx)}
        >
          <MdiIcon fontSize="inherit" {...icon} />
          <SrOnlyComponent component="span" {...SrOnlyProps}>
            {children}
          </SrOnlyComponent>
        </MuiButton>
      </MuiTooltip>
    )
  },
)

export interface ElementOverlayBadgeButtonsComponentProps extends ButtonGroupProps {
  $id: ElementId
  dragHandleRef: DragElementWrapper<any>
  onDuplicateClick?: (e: ChangeEvent<unknown>) => void
  onModifyClick?: (e: ChangeEvent<unknown>) => void
  onSelectParentClick?: (e: ChangeEvent<unknown>) => void
  onHoverParent?: (e: ChangeEvent<unknown>) => void
  onHoverParentLeave?: (e: ChangeEvent<unknown>) => void
}

const ElementOverlayBadgeComponent = forwardRef<any, ElementOverlayBadgeButtonsComponentProps>(
  function RefRenderFn(props, ref) {
    const {
      $id,
      dragHandleRef,
      onDuplicateClick,
      onModifyClick,
      onSelectParentClick,
      onHoverParent,
      onHoverParentLeave,
      ...rest
    } = props


    const handleDuplicateClick = useCallback((e: ChangeEvent<unknown>) => {
      onDuplicateClick && onDuplicateClick(e)
    }, [onDuplicateClick])


    const handleModifyClick = useCallback((e: ChangeEvent<unknown>) => {
      onModifyClick && onModifyClick(e)
    }, [onModifyClick])


    const handleSelectParentClick = useCallback((e: ChangeEvent<unknown>) => {
      onSelectParentClick && onSelectParentClick(e)
    }, [onSelectParentClick])


    const handleParentHover = useCallback((e: ChangeEvent<unknown>) => {
      onHoverParent && onHoverParent(e)
    }, [onHoverParent])


    const handleHoverParentLeave = useCallback((e: ChangeEvent<unknown>) => {
      onHoverParentLeave && onHoverParentLeave(e)
    }, [onHoverParentLeave])


    return (
      <MuiButtonGroup
        ref={ref}
        id="aglyn:overlay-badge"
        variant="contained"
        color="primary"
        aria-label="element controls"
        {...rest}
      >

        {!isRootElementId($id) && (
          <BadgeButton
            title="Drag"
            children="drag"
            ButtonProps={{
              ref: dragHandleRef,
              sx: {'&, &:hover': {cursor: 'move'}},
            }}
            icon={{path: ICON_VARIANT_MODIFY_DRAG.path, color: 'secondary'}}
          />
        )}

        {!isRootElementId($id) && (
          <BadgeButton
            title="Duplicate"
            children="duplicate"
            ButtonProps={{onClick: handleDuplicateClick}}
            icon={{path: ICON_VARIANT_MODIFY_DUPLICATE.path}}
          />
        )}

        <BadgeButton
          title="Modify"
          children="modify"
          onClick={handleModifyClick}
          icon={{path: ICON_VARIANT_MODIFY_EDIT.path}}
        />

        {!isRootElementId($id) && (
          <BadgeButton
            title="Select parent"
            children={'select parent'}
            ButtonProps={{
              onClick: handleSelectParentClick,
              onMouseEnter: handleParentHover,
              onMouseLeave: handleHoverParentLeave,
            }}
            icon={{path: ICON_VARIANT_SELECT_PARENT.path}}
          />
        )}

      </MuiButtonGroup>
    )
  },
)
ElementOverlayBadgeComponent.displayName = 'ElementOverlayBadgeComponent'
ElementOverlayBadgeComponent.aglyn = true

export {ElementOverlayBadgeComponent}
export default ElementOverlayBadgeComponent
