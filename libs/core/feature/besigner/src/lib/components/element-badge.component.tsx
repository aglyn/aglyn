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

import {
  BesignerPanelTabFlag,
  CANVAS_ROOT_ELEMENT_ID,
  duplicateCanvasElement,
  type ElementId,
  isRootElementId,
  setBesignerCanvasSelected,
  setBesignerPanels,
} from '@aglyn/core-data-framework'
import {
  useAglynAppContext,
  useAglynComponentSchema,
  useAglynElementData,
} from '@aglyn/core-feature-renderer'
import {IconVariant} from '@aglyn/shared-data-brand'
import {
  PopperStyledArrowComponent,
  PopperStyledComponent,
  type PopperStyledComponentProps,
  SrOnlyComponent,
  useDynamicEffect,
} from '@aglyn/shared-ui-jsx'
import {MdiIcon, type  MdiIconProps} from '@aglyn/shared-ui-mdi-jsx'
import {VirtualElement} from '@aglyn/shared-util-dom'
import {CSS} from '@aglyn/shared-util-tools'
import {useDraggable} from '@dnd-kit/core'
import Button, {type ButtonProps} from '@mui/material/Button'
import ButtonGroup, {type ButtonGroupProps} from '@mui/material/ButtonGroup'
import Tooltip from '@mui/material/Tooltip'
import Zoom from '@mui/material/Zoom'
import {type ChangeEvent, forwardRef, useCallback, useState} from 'react'
import useAglynCanvasElementStatus from '../hooks/use-aglyn-canvas-element-status'
import {useDeleteElementCallback} from '../hooks/use-delete-element-callback'


interface ElementBadgeButtonGroupProps extends ButtonGroupProps {
  $id: ElementId
  anchorEl?: VirtualElement
}

const ElementBadgeButtonGroup = forwardRef<any, ElementBadgeButtonGroupProps>(
  function RefRenderFn(props, ref) {
    const {$id, anchorEl, ...rest} = props

    const {getApp} = useAglynAppContext()
    const deleteElementCallback = useDeleteElementCallback({$id})
    const parentId = useAglynElementData($id, 'parentId') || null
    const componentId = useAglynElementData($id, 'componentId') || null
    const bundleId = useAglynElementData($id, 'bundleId') || null
    const componentSchema = useAglynComponentSchema(componentId, bundleId)
    const {
      setNodeRef: dragRef,
      listeners,
      attributes,
      transform,
      isDragging,
    } = useDraggable({
      disabled: $id === CANVAS_ROOT_ELEMENT_ID,
      id: $id,
      data: {
        $id,
        componentId,
        bundleId,
        hierarchy: componentSchema?.renderFlags?.hierarchy,
      },
    })
    const style = {
      transform: CSS.Translate.toString(transform),
    }

    const handleDeleteClick = useCallback((e: ChangeEvent<unknown>) => {
      deleteElementCallback(e)
    }, [deleteElementCallback])

    const handleDuplicateClick = useCallback((e: ChangeEvent<unknown>) => {
      duplicateCanvasElement(getApp(), {$id})
    }, [$id, getApp])
    const handleModifyClick = useCallback((e: ChangeEvent<unknown>) => {
      setBesignerPanels(getApp(), {
        panelRight: {toggled: true, tab: BesignerPanelTabFlag.ELEMENT_PROPS_FORM},
      })
    }, [$id, getApp])
    const handleSelectParentClick = useCallback((e: ChangeEvent<unknown>) => {
      setBesignerCanvasSelected(getApp(), {selected: {$id: parentId}})
    }, [parentId, getApp])

    useDynamicEffect(() => {
      if (anchorEl) {
        dragRef(anchorEl as HTMLElement)
      }
    }, [anchorEl, dragRef])

    const buttons = [
      ...(isRootElementId($id) ? [] : [
        {
          id: 'drag-element',
          tooltipProps: {
            title: 'Drag',
          },
          srOnlyProps: {
            children: 'drag',
          },
          buttonProps: {
            style,
            ...attributes,
            ...listeners,
          } as ButtonProps,
          svgPathIconProps: {
            path: IconVariant.MODIFY_DRAG,
            color: 'secondary',
          } as MdiIconProps,
        },
        {
          id: 'duplicate-element',
          tooltipProps: {
            title: 'Duplicate',
          },
          srOnlyProps: {
            children: 'duplicate',
          },
          buttonProps: {
            // disabled: yes(disableZoomResetButton),
            onClick: handleDuplicateClick,
          },
          svgPathIconProps: {
            path: IconVariant.MODIFY_DUPLICATE,
          },
        },
      ]),
      {
        id: 'modify-props',
        tooltipProps: {
          title: 'Modify',
        },
        srOnlyProps: {
          children: 'modify',
        },
        buttonProps: {
          // disabled: yes(disableZoomResetButton),
          onClick: handleModifyClick,
        },
        svgPathIconProps: {
          path: IconVariant.MODIFY_EDIT,
        },
      },
      ...(!parentId) ? [] : [
        {
          id: 'select-parent',
          tooltipProps: {
            title: 'Select parent',
          },
          srOnlyProps: {
            children: 'select parent',
          },
          buttonProps: {
            disabled: !parentId || isRootElementId(parentId),
            onClick: handleSelectParentClick,
          },
          svgPathIconProps: {
            path: IconVariant.SELECT_PARENT,
          },
        },
      ],
    ].filter(i => i && !i.buttonProps.disabled)

    return (
      <ButtonGroup
        ref={ref}
        variant="contained"
        color="primary"
        aria-label="element controls"
        sx={{boxShadow: 4}}
        {...rest}
      >
        {buttons.map(({id, tooltipProps, srOnlyProps, buttonProps, svgPathIconProps}) => (
          <Tooltip key={id} {...tooltipProps}>
            <Button {...buttonProps}>
              <MdiIcon fontSize="small" {...svgPathIconProps} />
              <SrOnlyComponent component="span" {...srOnlyProps} />
            </Button>
          </Tooltip>
        ))}
      </ButtonGroup>
    )
  },
)

export interface ElementBadgeComponentProps extends Partial<PopperStyledComponentProps> {
  $id: ElementId
  anchorEl?: VirtualElement
}

const ElementBadgeComponent = forwardRef<any, ElementBadgeComponentProps>(
  function RefRenderFn(props, ref) {
    const {$id, disableArrow, anchorEl, ...rest} = props

    const [arrowRef, setArrowRef] = useState(null)
    const {isSelfSelected} = useAglynCanvasElementStatus($id)

    const modifiers = [
      {
        name: 'flip',
        enabled: true,
        options: {
          altBoundary: true,
          rootBoundary: 'document',
          padding: 8,
        },
      },
      {
        name: 'preventOverflow',
        enabled: true,
        options: {
          altAxis: false,
          altBoundary: true,
          tether: true,
          rootBoundary: 'document',
          padding: 8,
        },
      },
      {
        name: 'arrow',
        enabled: !disableArrow,
        options: {
          element: arrowRef,
        },
      },
    ]

    return (
      <PopperStyledComponent
        ref={ref}
        placement="top"
        disableArrow={disableArrow}
        modifiers={modifiers}
        anchorEl={anchorEl}
        open={isSelfSelected}
        // keepMounted
        disablePortal
        transition
        arrowGap={8}
        {...rest}
      >
        {({TransitionProps}) => (
          <Zoom {...TransitionProps}>
            <div>
              {!disableArrow && <PopperStyledArrowComponent ref={setArrowRef} />}
              <ElementBadgeButtonGroup anchorEl={anchorEl} $id={$id} />
            </div>
          </Zoom>
        )}
      </PopperStyledComponent>
    )
  },
)

ElementBadgeComponent.displayName = 'ElementBadgeComponent'
ElementBadgeComponent.defaultProps = {}

export {ElementBadgeComponent}
export default ElementBadgeComponent
