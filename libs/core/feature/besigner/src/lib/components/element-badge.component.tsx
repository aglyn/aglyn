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
  duplicateCanvasElement,
  ElementId,
  isRootElementId,
  setBesignerCanvasSelected,
  setBesignerPanels,
} from '@aglyn/core-data-framework'
import {useAglynAppContext, useAglynElementData} from '@aglyn/core-feature-renderer'
import {IconVariant} from '@aglyn/shared-data-brand'
import {
  PopperStyledArrowComponent,
  PopperStyledComponent,
  PopperStyledComponentProps,
  SrOnlyComponent,
  SvgPathIcon,
  SvgPathIconProps,
} from '@aglyn/shared-ui-jsx'
import Button, {ButtonProps} from '@mui/material/Button'
import ButtonGroup, {ButtonGroupProps} from '@mui/material/ButtonGroup'
import Tooltip from '@mui/material/Tooltip'
import Zoom from '@mui/material/Zoom'
import {ChangeEvent, forwardRef, memo, useCallback, useState} from 'react'
import {useDeleteElementCallback} from '../hooks/use-delete-element-callback'


interface ElementBadgeButtonGroupProps extends ButtonGroupProps {
  $id: ElementId
}

const ElementBadgeButtonGroup = forwardRef<any, ElementBadgeButtonGroupProps>(
  function RefRenderFn(props, ref) {
    const {$id, ...rest} = props

    const {getApp} = useAglynAppContext()
    const deleteElementCallback = useDeleteElementCallback({$id})
    const parentId = useAglynElementData($id, 'parentId') || null

    const handleDeleteClick = useCallback((e: ChangeEvent<unknown>) => {
      deleteElementCallback(e)
    }, [deleteElementCallback])

    const handleDuplicateClick = useCallback((e: ChangeEvent<unknown>) => {
      duplicateCanvasElement(getApp(), {$id})
    }, [$id])
    const handleModifyClick = useCallback((e: ChangeEvent<unknown>) => {
      setBesignerPanels(getApp(), {
        panelRight: {toggled: true, tab: BesignerPanelTabFlag.ELEMENT_PROPS_FORM},
      })
    }, [$id])
    const handleSelectParentClick = useCallback((e: ChangeEvent<unknown>) => {
      setBesignerCanvasSelected(getApp(), {selected: {$id: parentId}})
    }, [parentId])

    const buttons = [
      {
        id: 'delete-element',
        tooltipProps: {
          title: 'Delete',
        },
        srOnlyProps: {
          children: 'delete',
        },
        buttonProps: {
          // disabled: yes(disableZoomResetButton),
          onClick: handleDeleteClick,
        } as ButtonProps,
        svgPathIconProps: {
          iconIds: IconVariant.MODIFY_DELETE,
          color: 'error',
        } as SvgPathIconProps,
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
          iconIds: IconVariant.MODIFY_DUPLICATE,
        },
      },
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
          iconIds: IconVariant.MODIFY_EDIT,
        },
      },
      (parentId && !isRootElementId(parentId)) ? ({
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
          iconIds: IconVariant.SELECT_PARENT,
        },
      }) : null,
    ].filter(i => i && !i.buttonProps.disabled)

    return (
      <ButtonGroup
        ref={ref}
        variant="contained"
        color="primary"
        aria-label="element controls"
        {...rest}
      >
        {buttons.map(({id, tooltipProps, srOnlyProps, buttonProps, svgPathIconProps}) => (
          <Tooltip key={id} {...tooltipProps}>
            <Button {...buttonProps}>
              <SvgPathIcon fontSize="small" {...svgPathIconProps} />
              <SrOnlyComponent component="span" {...srOnlyProps} />
            </Button>
          </Tooltip>
        ))}
      </ButtonGroup>
    )
  },
)

export interface ElementBadgeComponentProps extends PopperStyledComponentProps {
  $id: ElementId
}

const ElementBadgeComponentRaw = forwardRef<any, ElementBadgeComponentProps>(
  function RefRenderFn(props, ref) {
    const {$id, disableArrow, ...rest} = props

    const [arrowRef, setArrowRef] = useState(null)

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
              <ElementBadgeButtonGroup $id={$id} />
            </div>
          </Zoom>
        )}
      </PopperStyledComponent>
    )
  },
)

ElementBadgeComponentRaw.displayName = 'ElementBadgeComponent'
ElementBadgeComponentRaw.defaultProps = {}

export const ElementBadgeComponent = memo(ElementBadgeComponentRaw)
export default ElementBadgeComponent
