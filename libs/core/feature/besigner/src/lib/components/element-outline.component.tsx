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

import {type ElementId} from '@aglyn/core-data-framework'
import {useAglynElementData} from '@aglyn/core-feature-renderer'
import {alpha, generateComponentClassKeys, styled} from '@aglyn/shared-feature-themes'
import {useDynamicEffect} from '@aglyn/shared-ui-jsx'
import {getElementClientRectBounding, type VirtualElement} from '@aglyn/shared-util-dom'
import Box, {type BoxProps} from '@mui/material/Box'
import clsx from 'clsx'
import {forwardRef, useState} from 'react'
import useAglynCanvasElementStatus from '../hooks/use-aglyn-canvas-element-status'
import useAglynDndElementStatus from '../hooks/use-aglyn-dnd-element-status'
import useBesignerElementAttributes from '../hooks/use-besigner-element-attributes'


const classKeys = generateComponentClassKeys('AglynElementOutline', [
  'open',
  'hoveringSelf',
  'selectedSelf',
  'hoveringChild',
  'selectedChild',
  'draggingSelf',
  'draggingOverSelf',
])

const ElementOutline = styled(Box, {
  name: 'AglynElementOutline',
})(({theme}) => ({
  pointerEvents: 'none',
  position: 'absolute',
  left: 0,
  top: 0,
  right: 0,
  bottom: 0,
  outlineColor: 'transparent',
  outlineOffset: 0,
  outlineWidth: 1,
  outlineStyle: 'dashed',
  transition: theme.transitions.create([
    'visibility',
    'outlineWidth',
    'outlineOffset',
    'outlineStyle',
    'outlineColor',
    'backgroundColor',
  ], {
    duration: theme.transitions.duration.enteringScreen,
    easing: theme.transitions.easing.easeIn,
  }),
  [`&.${classKeys.open}`]: {
    transition: theme.transitions.create([
      'visibility',
      'outlineWidth',
      'outlineOffset',
      'outlineStyle',
      'outlineColor',
      'backgroundColor',
    ], {
      duration: theme.transitions.duration.leavingScreen,
      easing: theme.transitions.easing.easeOut,
    }),
  },
  [`&.${classKeys.selectedSelf}`]: {
    outlineWidth: 2,
    outlineStyle: 'solid',
    outlineColor: theme.palette.quaternary.main,
  },
  [`&.${classKeys.hoveringChild}`]: {
    outlineColor: theme.palette.grey['A400'],
    backgroundColor: alpha(theme.palette.secondary.light, 0.12),
  },
  [`&.${classKeys.selectedChild}`]: {
    outlineColor: theme.palette.grey['A400'],
  },

  [`&.${classKeys.hoveringSelf}`]: {
    outlineWidth: 2,
    outlineColor: theme.palette.secondary.main,
    backgroundColor: alpha(theme.palette.secondary.dark, 0.12),

    [`&.${classKeys.selectedSelf}`]: {
      outlineWidth: 2,
      outlineOffset: 3,
      outlineStyle: 'solid',
      outlineColor: theme.palette.quaternary.main,
      backgroundColor: alpha(theme.palette.quaternary.dark, 0.12),
    },
    [`&.${classKeys.selectedChild}`]: {
      outlineStyle: 'dashed',
    },
  },

  [`&.${classKeys.draggingSelf}`]: {
    outlineColor: 'transparent',
    backgroundColor: alpha(theme.palette.grey['300'], 0.76),
  },
  [`&.${classKeys.draggingOverSelf}`]: {
    backgroundColor: alpha(theme.palette.quaternary.dark, 0.76),
    outlineColor: theme.palette.quaternary.main,
  },
}))

export interface AglynElementOutlineProps extends BoxProps {
  $id: ElementId
  anchorEl?: VirtualElement
}

const ElementOutlineComponent = forwardRef<any, AglynElementOutlineProps>(
  function RefRenderFn(props, ref) {
    const {
      className: classNameProp,
      $id,
      anchorEl,
      ...rest
    } = props
    const {isOver, isActive} = useAglynDndElementStatus($id)
    const componentId = useAglynElementData($id, 'componentId')
    const bundleId = useAglynElementData($id, 'bundleId')
    const elementAttributes = useBesignerElementAttributes({$id, componentId, bundleId})
    const {
      isSelfSelected,
      isSelfHovered,
      isChildSelected,
      isChildHovered,
    } = useAglynCanvasElementStatus($id, true)

    const className = clsx({
      [classKeys.open]: Boolean(anchorEl),
      [classKeys.draggingSelf]: Boolean(isActive),
      [classKeys.draggingOverSelf]: Boolean(isOver),
      [classKeys.hoveringSelf]: Boolean(isSelfHovered),
      [classKeys.selectedSelf]: Boolean(isSelfSelected),
      [classKeys.selectedChild]: Boolean(isChildSelected),
      [classKeys.hoveringChild]: Boolean(isChildHovered),
    }, classNameProp)


    const [style, setStyle] = useState(null)
    useDynamicEffect(() => {
      const rect = anchorEl && getElementClientRectBounding(anchorEl)
      console.log('anchorEl', anchorEl, rect)
      if (rect) {
        setStyle({
          width: rect.width,
          height: rect.height,
        })
      }
    }, [anchorEl])

    return (
      <ElementOutline
        ref={ref}
        className={className}
        style={style}
        {...elementAttributes}
        {...rest}
      />
    )
  },
)

ElementOutlineComponent.displayName = 'ElementOutlineComponent'
ElementOutlineComponent.defaultProps = {}

export {ElementOutlineComponent}
export default ElementOutlineComponent
