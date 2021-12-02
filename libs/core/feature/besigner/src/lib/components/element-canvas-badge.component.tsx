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

import { duplicateCanvasElement, ElementId, setBuilderPanels } from '@aglyn/core-data-framework'
import { useAglynAppContext } from '@aglyn/core-feature-renderer'
import {
  PopperStyledArrowComponent,
  PopperStyledComponent,
  PopperStyledComponentProps,
  SrOnlyComponent,
  SvgPathIcon,
  SvgPathIconProps,
} from '@aglyn/shared-ui-jsx'
import Button, { ButtonProps } from '@mui/material/Button'
import ButtonGroup, { ButtonGroupProps } from '@mui/material/ButtonGroup'
import Tooltip from '@mui/material/Tooltip'
import Zoom from '@mui/material/Zoom'
import { ChangeEvent, forwardRef, memo, useCallback, useState } from 'react'
import useDeleteElementCallback from '../hooks/use-delete-element-callback'

interface ElementBadgeButtonGroupProps extends ButtonGroupProps {
  $id: ElementId
}

const ElementBadgeButtonGroup = forwardRef<any, ElementBadgeButtonGroupProps>(function RefRenderFn(
  props,
  ref
) {
  const { $id, ...rest } = props

  const { getApp } = useAglynAppContext()
  const deleteElementCallback = useDeleteElementCallback({ $id })

  const handleDeleteButtonClick = useCallback(
    (e: ChangeEvent<unknown>) => {
      deleteElementCallback(e)
    },
    [deleteElementCallback]
  )

  const handleDuplicateButtonClick = useCallback(
    (e: ChangeEvent<unknown>) => {
      duplicateCanvasElement(getApp(), { $id })
    },
    [$id]
  )
  const handleModifyButtonClick = useCallback(
    (e: ChangeEvent<unknown>) => {
      setBuilderPanels(getApp(), { right: { toggled: true, tab: 'element-modify' } })
    },
    [$id]
  )

  const buttons = [
    {
      id: 'delete-element',
      tooltipProps: {
        title: 'Delete',
      },
      srOnlyProps: {
        children: 'Delete',
      },
      buttonProps: {
        // disabled: yes(disableZoomResetButton),
        onClick: handleDeleteButtonClick,
      } as ButtonProps,
      svgPathIconProps: {
        iconIds: 'delete-outline',
        color: 'error',
      } as SvgPathIconProps,
    },
    {
      id: 'duplicate-element',
      tooltipProps: {
        title: 'Duplicate',
      },
      srOnlyProps: {
        children: 'Duplicate',
      },
      buttonProps: {
        // disabled: yes(disableZoomResetButton),
        onClick: handleDuplicateButtonClick,
      },
      svgPathIconProps: {
        iconIds: 'content-duplicate',
      },
    },
    {
      id: 'modify-props',
      tooltipProps: {
        title: 'Modify',
      },
      srOnlyProps: {
        children: 'Modify',
      },
      buttonProps: {
        // disabled: yes(disableZoomResetButton),
        onClick: handleModifyButtonClick,
      },
      svgPathIconProps: {
        iconIds: 'pencil',
      },
    },
  ]

  return (
    <ButtonGroup
      ref={ref}
      variant="contained"
      color="primary"
      aria-label="element controls"
      {...rest}
    >
      {buttons.map(({ id, tooltipProps, srOnlyProps, buttonProps, svgPathIconProps }) => (
        <Tooltip key={id} {...tooltipProps}>
          <Button {...buttonProps}>
            <SvgPathIcon fontSize="small" {...svgPathIconProps} />
            <SrOnlyComponent component="span" {...srOnlyProps} />
          </Button>
        </Tooltip>
      ))}
    </ButtonGroup>
  )
})

export interface ElementCanvasBadgeComponentProps extends PopperStyledComponentProps {
  $id: ElementId
}

const ElementCanvasBadgeComponentRaw = forwardRef<any, ElementCanvasBadgeComponentProps>(
  function RefRenderFn(props, ref) {
    const { $id, disableArrow, ...rest } = props

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
        {({ TransitionProps }) => (
          <Zoom {...TransitionProps}>
            <div>
              {!disableArrow && <PopperStyledArrowComponent ref={setArrowRef} />}
              <ElementBadgeButtonGroup $id={$id} />
            </div>
          </Zoom>
        )}
      </PopperStyledComponent>
    )
  }
)

ElementCanvasBadgeComponentRaw.displayName = 'ElementCanvasBadgeComponent'
ElementCanvasBadgeComponentRaw.defaultProps = {}

export const ElementCanvasBadgeComponent = memo(ElementCanvasBadgeComponentRaw)
export default ElementCanvasBadgeComponent
