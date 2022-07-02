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

import { useRenderedCanvasElementRef } from '@aglyn/besigner-feature-app/contexts/rendered-canvas-elements'
import type { ElementId } from '@aglyn/core-data-foundation'
import {
  alpha,
  generateComponentClassKeys,
  styled,
} from '@aglyn/shared-ui-theme'
import { getElementClientRectBounding } from '@aglyn/shared-util-dom'
import { Box, type BoxProps } from '@mui/material'
import clsx from 'clsx'
import { forwardRef, useMemo } from 'react'
import useAglynCanvasElementStatus from '../hooks/use-aglyn-canvas-element-status'
import useAglynDndElementStatus from '../hooks/use-aglyn-dnd-element-status'

const classKeys = generateComponentClassKeys('AglynElementOverlayOutline', [
  'hoveringSelf',
  'selectedSelf',
  'draggingSelf',
  'draggingOver',
])

const ElementOverlayOutline = styled(Box, {
  name: 'AglynElementOverlayOutline',
})(({ theme }) => {
  return {
    pointerEvents: 'none',
    position: 'absolute',
    left: 0,
    top: 0,
    right: 0,
    bottom: 0,
    outlineColor: 'transparent',
    outlineOffset: 1,
    outlineWidth: 1,
    outlineStyle: 'dashed',
    // transition: theme.transitions.create([
    //   'outline-width',
    //   'outline-offset',
    //   'outline-style',
    //   'outline-color',
    //   'background-color',
    // ], {
    //   duration: theme.transitions.duration.standard,
    //   easing: theme.transitions.easing.easeInOut,
    // }),

    cursor: 'copy',
    [`&.${classKeys.selectedSelf}`]: {
      outlineWidth: 2,
      outlineStyle: 'solid',
      outlineColor: theme.palette.quaternary.main,
    },
    [`&.${classKeys.hoveringSelf}`]: {
      outlineColor: theme.palette.secondary.main,
      backgroundColor: alpha(theme.palette.secondary.main, 0.12),
    },
    [`&.${classKeys.draggingSelf}`]: {
      outlineColor: 'transparent',
      backgroundColor: alpha(theme.palette.secondary.light, 0.76),
    },
    [`&.${classKeys.draggingOver}`]: {
      outlineColor: theme.palette.quaternary.main,
      backgroundColor: alpha(theme.palette.quaternary.dark, 0.76),
    },
    [`&.${classKeys.draggingOver}.${classKeys.draggingSelf}`]: {
      outlineColor: theme.palette.grey['500'],
      backgroundColor: alpha(theme.palette.grey['500'], 0.64),
    },
  }
})

export interface ElementOverlayOutlineProps extends BoxProps {
  $id: ElementId
}

const ElementOverlayOutlineComponent = forwardRef<
  any,
  ElementOverlayOutlineProps
>((props, ref) => {
  const { className, $id, ...rest } = props
  const [isDragging, isDraggingOver] = useAglynDndElementStatus($id)
  const { isSelfSelected, isSelfHovered } = useAglynCanvasElementStatus($id)
  const elementRef = useRenderedCanvasElementRef({ $id })
  const rect = getElementClientRectBounding(elementRef?.node)
  const style = useMemo(
    () => ({
      width: rect?.width,
      height: rect?.height,
    }),
    [rect],
  )

  return (
    <ElementOverlayOutline
      ref={ref}
      id="aglyn:element-overlay-outline"
      data-aglyn-overlay-id={$id}
      data-aglyn-overlay-type="outline"
      style={style}
      className={clsx(
        {
          [classKeys.selectedSelf]: Boolean(isSelfSelected),
          [classKeys.hoveringSelf]: Boolean(isSelfHovered),
          [classKeys.draggingSelf]: Boolean(isDragging),
          [classKeys.draggingOver]: Boolean(isDraggingOver),
        },
        className,
      )}
      {...rest}
    />
  )
})

ElementOverlayOutlineComponent.displayName = 'ElementOverlayOutlineComponent'
ElementOverlayOutlineComponent.aglyn = true
ElementOverlayOutlineComponent.defaultProps = {}

export { ElementOverlayOutlineComponent }
export default ElementOverlayOutlineComponent
