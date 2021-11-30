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

import { deleteCanvasElement, duplicateCanvasElement, ElementId } from '@aglyn/core-data-framework'
import { useAglynAppContext } from '@aglyn/feature-renderer'
import { generateComponentClassKeys, styled } from '@aglyn/shared-feature-themes'
import {
  PopperArrowComponent,
  SrOnlyComponent,
  SvgPathIcon,
  SvgPathIconProps,
  useConfirmationContext,
} from '@aglyn/shared-ui-jsx'
import Button, { ButtonProps } from '@mui/material/Button'
import ButtonGroup from '@mui/material/ButtonGroup'
import MuiPopper, { PopperProps as MuiPopperProps } from '@mui/material/Popper'
import Tooltip from '@mui/material/Tooltip'
import { ChangeEvent, forwardRef, memo, useCallback, useState } from 'react'


const classKeys = generateComponentClassKeys('AglynElementBadge', [
  'arrow',
])

export interface ElementBadgePopperProps extends MuiPopperProps {
  arrow?: boolean
}

const ElementBadgePopper = styled(MuiPopper, {
  name: 'AglynElementBadge',
  shouldForwardProp: (prop) => prop !== 'arrow',
})<ElementBadgePopperProps>(({theme, arrow}) => ({
  zIndex: 1,
  '& > div': {
    position: 'relative',
  },
  '&[data-popper-placement*="bottom"]': {
    '& > div': {
      marginTop: arrow ? 2 : 0,
    },
    [`& .${classKeys.arrow}`]: {
      top: 0,
      left: 0,
      marginTop: '-0.9em',
      width: '3em',
      height: '1em',
      '&::before': {
        borderWidth: '0 1em 1em 1em',
        borderColor: `transparent transparent ${theme.palette.primary.main} transparent`,
      },
    },
  },
  '&[data-popper-placement*="top"]': {
    '& > div': {
      marginBottom: arrow ? 2 : 0,
    },
    [`& .${classKeys.arrow}`]: {
      bottom: 0,
      left: 0,
      marginBottom: '-0.9em',
      width: '3em',
      height: '1em',
      '&::before': {
        borderWidth: '1em 1em 0 1em',
        borderColor: `${theme.palette.primary.main} transparent transparent transparent`,
      },
    },
  },
  '&[data-popper-placement*="right"]': {
    '& > div': {
      marginLeft: arrow ? 2 : 0,
    },
    [`& .${classKeys.arrow}`]: {
      left: 0,
      marginLeft: '-0.9em',
      height: '3em',
      width: '1em',
      '&::before': {
        borderWidth: '1em 1em 1em 0',
        borderColor: `transparent ${theme.palette.primary.main} transparent transparent`,
      },
    },
  },
  '&[data-popper-placement*="left"]': {
    '& > div': {
      marginRight: arrow ? 2 : 0,
    },
    [`& .${classKeys.arrow}`]: {
      right: 0,
      marginRight: '-0.9em',
      height: '3em',
      width: '1em',
      '&::before': {
        borderWidth: '1em 0 1em 1em',
        borderColor: `transparent transparent transparent ${theme.palette.primary.main}`,
      },
    },
  },
}))

export interface ElementBadgeComponentProps extends ElementBadgePopperProps {
  $id: ElementId
}

const ElementBadgeComponentRaw = forwardRef<any, ElementBadgeComponentProps>(
  function RefRenderFn(props, ref) {
    const {
      $id,
      arrow,
      ...rest
    } = props

    const [arrowRef, setArrowRef] = useState(null)

    const {confirm} = useConfirmationContext()
    const {getApp} = useAglynAppContext()

    const handleDeleteButtonClick = useCallback((e: ChangeEvent<unknown>) => {
      confirm({
        title: 'Are you sure?',
        description: 'You are about to delete an element from the canvas, please confirm the desired option. Press \'Delete\' to confirm and delete the item. Press \'Cancel\' to void the operation and close this dialog.',
        confirmationText: 'Delete',
        confirmationButtonProps: {
          color: 'error',
        },
      })
      .then(
        (res) => {
          // onClose()
          deleteCanvasElement(getApp(), {$id})
        },
        (reason) => {
          console.warn('rejected', reason)
        },
      )
      .catch((e) => {
        console.error(e)
      })
    }, [$id])

    const handleDuplicateButtonClick = useCallback((e: ChangeEvent<unknown>) => {
      duplicateCanvasElement(getApp(), {$id})
    }, [$id])

    // const handleAddElementClick = useAddElementCallback({
    //   drawerOptions: {
    //     type: 'edit-element-traits',
    //   },
    // })

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
          // onClick: handleAddElementClick,
        },
        svgPathIconProps: {
          iconIds: 'pencil',
        },
      },
    ]


    return (
      <ElementBadgePopper
        ref={ref}
        placement="top"
        disablePortal
        keepMounted
        arrow={arrow}
        modifiers={[
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
            enabled: arrow,
            options: {
              element: arrowRef,
            },
          },
        ]}
        {...rest}
      >
        <div>

          {arrow && <PopperArrowComponent ref={setArrowRef} className={classKeys.arrow} />}

          <ButtonGroup variant="contained" color="primary" aria-label="element controls">

            {buttons.map(({id, tooltipProps, srOnlyProps, buttonProps, svgPathIconProps}) => (
              <Tooltip key={id} {...tooltipProps}>
                <Button {...buttonProps}>
                  <SvgPathIcon fontSize="small" {...svgPathIconProps} />
                  <SrOnlyComponent component="span" {...srOnlyProps} />
                </Button>
              </Tooltip>
            ))}

          </ButtonGroup>
        </div>
      </ElementBadgePopper>
    )
  },
)

ElementBadgeComponentRaw.displayName = 'ElementBadgeComponent'
ElementBadgeComponentRaw.defaultProps = {
  arrow: false,
}

export const ElementBadgeComponent = memo(ElementBadgeComponentRaw)
export default ElementBadgeComponent
