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
  deleteCanvasElement,
  duplicateCanvasElement,
  ELEMENT_ROOT_ID,
} from '@aglyn/core-data-framework'
import { useAglynAppContext, useAglynElementLabel } from '@aglyn/feature-renderer'
import { generateComponentClassKeys, styled } from '@aglyn/shared-feature-themes'
import {
  SrOnlyComponent,
  SvgPathIcon,
  SvgPathIconProps,
  useConfirmationContext,
} from '@aglyn/shared-ui-jsx'
import { CSS } from '@aglyn/shared-util-tools'
import Button, { ButtonProps } from '@mui/material/Button'
import ButtonGroup from '@mui/material/ButtonGroup'
import MuiPopper, { PopperProps } from '@mui/material/Popper'
import Tooltip from '@mui/material/Tooltip'
import { ChangeEvent, forwardRef, SyntheticEvent, useCallback, useRef } from 'react'
import { HoveredOptions } from '../contexts/hover-context'
import { useAddElementCallback } from '../hooks/use-add-element-callback'
import { ElementOutlineComponentProps } from './element-outline.component'


const popperClassKeys = generateComponentClassKeys('AglynPopper', [
  'arrow',
])

const Popper = styled(MuiPopper, {name: 'AglynPopper'})<PopperProps>(({theme}) => ({
  zIndex: 1,
  '& > div': {
    position: 'relative',
  },
  '&[data-popper-placement*="bottom"]': {
    '& > div': {
      marginTop: 2,
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
      marginBottom: 2,
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
      marginLeft: 2,
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
      marginRight: 2,
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


export interface HoverComponentProps extends ElementOutlineComponentProps {
  options?: HoveredOptions
  onClose?: (event?: SyntheticEvent) => void
  anchorEl?: PopperProps['anchorEl']
}

export const HoverComponent = forwardRef<any, HoverComponentProps>(
  function RefRenderFn(props, ref) {
    const {
      open,
      options,
      onClose,
      children,
      variant,
      anchorEl,
      ...rest
    } = props
    const selected = variant === 'selected'
    const {
      $id,
    } = options || {}

    const label = useAglynElementLabel($id)

    const style = {
      width: options?.position?.width ?? 0,
      height: options?.position?.height ?? 0,
      transform: CSS.Translate.toString({
        x: options?.position?.x,
        y: options?.position?.y,
        scaleX: 1,
        scaleY: 1,
      }),
    }

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
          onClose()
          deleteCanvasElement(getApp(), {$id})
        },
        (reason) => {
          console.warn('rejected', reason)
        },
      )
      .catch((e) => {
        console.error(e)
      })
    }, [$id, onClose])

    const handleDuplicateButtonClick = useCallback((e: ChangeEvent<unknown>) => {
      duplicateCanvasElement(getApp(), {$id})
    }, [$id])

    const handleAddElementClick = useAddElementCallback({
      drawerOptions: {
        type: 'edit-element-traits',
      },
    })

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
          onClick: handleAddElementClick,
        },
        svgPathIconProps: {
          iconIds: 'pencil',
        },
      },
    ]

    const arrowRef = useRef<HTMLElement>()

    // const popper = {
    //   selected: (
    //
    //   ),
    //   hovered: null,
    //   hovered2: (
    //     <Popper
    //       disablePortal
    //       open={open}
    //       anchorEl={anchorEl}
    //       placement="top-start"
    //     >
    //       <Paper sx={{bgcolor: 'quaternary.light', color: 'quaternary.contrastText', px: 0.5,
    // py: 0.15}}> <Typography variant="body2" > {label} </Typography> </Paper> </Popper> ),
    // }[selected ? 'selected' : 'hovered']

    // console.log('props', props, className)

    return (
      <>
        {/*<Popper*/}
        {/*  disablePortal*/}
        {/*  open={open}*/}
        {/*  anchorEl={anchorEl}*/}
        {/*  placement="top"*/}
        {/*  modifiers={[*/}
        {/*    {*/}
        {/*      name: 'flip',*/}
        {/*      enabled: true,*/}
        {/*      options: {*/}
        {/*        altBoundary: true,*/}
        {/*        rootBoundary: 'document',*/}
        {/*        padding: 8,*/}
        {/*      },*/}
        {/*    },*/}
        {/*    {*/}
        {/*      name: 'preventOverflow',*/}
        {/*      enabled: true,*/}
        {/*      options: {*/}
        {/*        altAxis: true,*/}
        {/*        altBoundary: true,*/}
        {/*        tether: true,*/}
        {/*        rootBoundary: 'document',*/}
        {/*        padding: 8,*/}
        {/*      },*/}
        {/*    },*/}
        {/*    {*/}
        {/*      name: 'arrow',*/}
        {/*      enabled: true,*/}
        {/*      options: {*/}
        {/*        element: arrowRef.current,*/}
        {/*      },*/}
        {/*    },*/}
        {/*  ]}*/}
        {/*>*/}
        {/*  <div>*/}
        {/*    /!*<PopperArrowComponent className={popperClassKeys.arrow} />*!/*/}
        {/*    <ButtonGroup variant="contained" color="primary" aria-label="element controls">*/}

        {/*      {buttons.map(({id, tooltipProps, srOnlyProps, buttonProps, svgPathIconProps}) => (*/}
        {/*        <Tooltip key={id} {...tooltipProps}>*/}
        {/*          <Button {...buttonProps}>*/}
        {/*            <SvgPathIcon fontSize="small" {...svgPathIconProps} />*/}
        {/*            <SrOnlyComponent component="span" {...srOnlyProps} />*/}
        {/*          </Button>*/}
        {/*        </Tooltip>*/}
        {/*      ))}*/}

        {/*    </ButtonGroup>*/}
        {/*  </div>*/}
        {/*</Popper>*/}
        {/*<ElementOutlineComponent*/}
        {/*  ref={ref}*/}
        {/*  style={style/*options?.clientRect*!/*/}
        {/*  variant={variant}*/}
        {/*  open={open}*/}
        {/*  {...rest}*/}
        {/*>*/}
        {children}
        {/*</ElementOutlineComponent>*/}
      </>
    )
  },
)

HoverComponent.displayName = 'HoverComponent'
HoverComponent.defaultProps = {
  options: {
    $id: ELEMENT_ROOT_ID,
    position: {
      // x: 0, y: 0,
    } as any,
  },
}

export default HoverComponent
