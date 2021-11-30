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
  SrOnlyComponent,
  SvgPathIcon,
  SvgPathIconProps,
  useCombinedRefs,
  useConfirmationContext,
} from '@aglyn/shared-ui-jsx'
import { getElementClientRectBounding } from '@aglyn/shared-util-dom'
import Box, { BoxProps } from '@mui/material/Box'
import Button, { ButtonProps } from '@mui/material/Button'
import ButtonGroup from '@mui/material/ButtonGroup'
import MuiPopper, { PopperProps as MuiPopperProps } from '@mui/material/Popper'
import Tooltip from '@mui/material/Tooltip'
import clsx from 'clsx'
import { ChangeEvent, forwardRef, RefObject, useCallback, useMemo, useRef } from 'react'
import { useBuilderElementInteractionActivity } from '../hooks/use-builder-element-interaction-activity'


const popperClassKeys = generateComponentClassKeys('AglynPopper', [
  'arrow',
])

const Popper = styled(MuiPopper, {name: 'AglynPopper'})<MuiPopperProps>(({theme}) => ({
  zIndex: 1,
  '& > div': {
    position: 'relative',
  },
  '&[data-popper-placement*="bottom"]': {
    '& > div': {
      marginTop: -2,
    },
    [`& .${popperClassKeys.arrow}`]: {
      top: 0,
      left: 0,
      marginTop: '-0.85em',
      width: '3em',
      height: '1em',
      paddingLeft: 5, paddingRight: 5,
      '&::before': {
        borderWidth: '0 1em 1em 1em',
        borderColor: `transparent transparent ${theme.palette.primary.main} transparent`,
      },
    },
  },
  '&[data-popper-placement*="top"]': {
    '& > div': {
      marginBottom: -2,
    },
    [`& .${popperClassKeys.arrow}`]: {
      bottom: 0,
      left: 0,
      marginBottom: '-0.85em',
      width: '3em',
      height: '1em',
      paddingLeft: 5, paddingRight: 5,
      '&::before': {
        borderWidth: '1em 1em 0 1em',
        borderColor: `${theme.palette.primary.main} transparent transparent transparent`,
      },
    },
  },
  '&[data-popper-placement*="right"]': {
    '& > div': {
      marginLeft: -2,
    },
    [`& .${popperClassKeys.arrow}`]: {
      left: 0,
      marginLeft: '-0.85em',
      height: '3em',
      width: '1em',
      paddingTop: 5, paddingBottom: 5,
      '&::before': {
        borderWidth: '1em 1em 1em 0',
        borderColor: `transparent ${theme.palette.primary.main} transparent transparent`,
      },
    },
  },
  '&[data-popper-placement*="left"]': {
    '& > div': {
      marginRight: -2,
    },
    [`& .${popperClassKeys.arrow}`]: {
      right: 0,
      marginRight: '-0.85em',
      height: '3em',
      width: '1em',
      paddingTop: 5, paddingBottom: 5,
      '&::before': {
        borderWidth: '1em 0 1em 1em',
        borderColor: `transparent transparent transparent ${theme.palette.primary.main}`,
      },
    },
  },
}))


const classKeys = generateComponentClassKeys('AglynElementOutlineComponent', [
  'open',
  'hovered',
  'selected',
])

export interface AglynElementOutlineProps extends BoxProps {
  variant?: 'hovered' | 'selected'
  open?: boolean
}

export const AglynElementOutline = styled(
  forwardRef<any, AglynElementOutlineProps>(
    function RefRenderFn(props, ref) {
      const {className: classNameProp, variant, open, ...rest} = props
      const className = clsx({
        [classKeys.open]: Boolean(open),
        [classKeys.hovered]: variant === 'hovered' || !variant,
        [classKeys.selected]: variant === 'selected',
      }, classNameProp)
      return <Box ref={ref} className={className} {...rest} />
    },
  ),
  {
    name: 'AglynElementOutline',
  },
)(({theme}) => ({
  pointerEvents: 'none',
  position: 'absolute',
  left: 0, top: 0, right: 0, bottom: 0,
  marginLeft: -2, marginTop: -2,
  visibility: 'hidden',
  transition: theme.transitions.create(['visibility', 'transform', 'width', 'height', 'left', 'right', 'top', 'bottom'], {
    duration: theme.transitions.duration.short,
    easing: theme.transitions.easing.easeInOut,
  }),
  overflow: 'hidden',
  [`&.${classKeys.open}`]: {
    visibility: 'visible',
  },
  [`&.${classKeys.hovered}`]: {
    outlineWidth: 3,
    outlineOffset: 2,
    outlineColor: theme.palette.secondary.light,
    outlineStyle: 'dashed',
  },
  [`&.${classKeys.selected}`]: {
    outlineWidth: 3,
    outlineOffset: -1,
    outlineColor: theme.palette.quaternary.main,
    outlineStyle: 'solid',
  },
}))

export interface ElementOutlineComponentProps extends Partial<MuiPopperProps> {
  $id: ElementId
  anchorRef?: RefObject<any>
  isOver?: boolean
  isDragging?: boolean
}

const ElementOutlineComponent = forwardRef<any, ElementOutlineComponentProps>(
  function RefRenderFn(props, ref) {
    const {
      $id,
      anchorRef,
      isOver,
      isDragging,
      ...rest
    } = props

    const anchorEl = anchorRef?.current

    const {width, height} = useMemo(() => {
      const rect = anchorRef?.current
        ? getElementClientRectBounding(anchorRef.current as any)
        : {} as any
      return {width: (rect.width || 0) + 4, height: (rect.height || 0) + 4}
    }, [anchorRef?.current])

    const {isSelfHovered, isSelfSelected} = useBuilderElementInteractionActivity($id)
    const open = Boolean((isOver || isDragging || isSelfHovered || isSelfSelected) && anchorEl)
    console.log('is open ', open, isOver, isDragging, isSelfHovered, isSelfSelected)
    const tooltipOpen = Boolean((isDragging || isSelfSelected) && anchorEl)
    const variant = (isDragging || isSelfSelected) ? 'selected' : 'hovered'

    const localRef = useRef()
    const outlineRef = useRef()

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

    const arrowRef = useRef<HTMLElement>()

    return (
      <>
        <MuiPopper
          ref={useCombinedRefs(localRef, ref)}
          open={open}
          anchorEl={anchorEl}
          placement="top-start"
          keepMounted
          disablePortal={true}
          modifiers={[
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
                tether: true,
                rootBoundary: 'viewport',
                padding: 0,
              },
            },
            // {
            //   name: 'arrow',
            //   enabled: true,
            //   options: {
            //     element: arrowRef,
            //   },
            // },
          ]}
          {...rest}
        >
          <AglynElementOutline
            style={{width, height}}
            ref={outlineRef}
            variant={variant}
            open
          />
          {/*<PopperArrowComponent className={popperClassKeys.arrow} />*/}

          <Popper
            anchorEl={outlineRef?.current}
            open={Boolean(outlineRef?.current && tooltipOpen)}
            placement="top"
            disablePortal={true}
            keepMounted
            modifiers={[
              {
                name: 'flip',
                enabled: false,
                options: {
                  altBoundary: false,
                  rootBoundary: 'viewport',
                  padding: 8,
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
                  padding: 8,
                },
              },
              // {
              //   name: 'arrow',
              //   enabled: false,
              //   options: {
              //     element: arrowRef,
              //   },
              // },
            ]}
          >
            <div>
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
          </Popper>


        </MuiPopper>


      </>
    )
  },
)
ElementOutlineComponent.displayName = 'ElementOutlineComponent'
ElementOutlineComponent.defaultProps = {}

export { ElementOutlineComponent }
export default ElementOutlineComponent
