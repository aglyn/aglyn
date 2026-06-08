/**
 * @license
 * Copyright 2026 Aglyn LLC
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

import * as Aglyn from '@aglyn/aglyn'
import * as Besigner from '@aglyn/besigner'
import { alpha, generateComponentClassKeys } from '@aglyn/shared-ui-theme'
import { getElementClientRectBounding } from '@aglyn/shared-util-dom'
import { styled } from '@mui/material'
import clsx from 'clsx'
import { observer } from 'mobx-react-lite'
import type { ComponentProps } from 'react'
import { forwardRef } from 'react'

const classKeys = generateComponentClassKeys('NodeOutline', [
  'root',
  'hoveringSelf',
  'selectedSelf',
  'draggingSelf',
  'draggingOver',
])

const NodeOutlineRoot = styled('div', {
  name: 'NodeOutline',
  slot: 'Root',
})(({ theme }) => ({
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
  content: '""',
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

  [`&.${classKeys.selectedSelf}`]: {
    outlineWidth: 2,
    outlineStyle: 'solid',
    outlineColor: theme.palette.tertiary.main,
  },
  [`&.${classKeys.hoveringSelf}`]: {
    outlineColor: theme.palette.secondary.main,
    backgroundColor: alpha(theme.palette.secondary.main, 0.12),
  },
  [`&.${classKeys.draggingSelf}`]: {
    outlineColor: 'transparent',
    backgroundColor: alpha(theme.palette.secondary.light, 0.12),
  },
  [`&.${classKeys.draggingOver}`]: {
    outlineColor: theme.palette.tertiary.main,
    backgroundColor: alpha(theme.palette.tertiary.dark, 0.12),
  },
  [`&.${classKeys.draggingOver}.${classKeys.draggingSelf}`]: {
    outlineColor: theme.palette.grey['500'],
    backgroundColor: alpha(theme.palette.grey['500'], 0.64),
  },
}))

export interface NodeOutlineProps
  extends ComponentProps<typeof NodeOutlineRoot> {
  node: Aglyn.NodeSchema<any>
}

export const NodeOutline = observer(
  forwardRef<HTMLDivElement, NodeOutlineProps>((props, ref) => {
    const { className, node, style, ...rest } = props
    const $id = node?.$id
    const elementRef = Besigner.refs.get($id)
    const isSelected = Besigner.focus.isNodeSelected(node)
    const isHovered = Besigner.focus.isNodeHovered(node)
    const isDragging = Besigner.dnd.isDraggingNode(node)
    const isDraggingOver = Besigner.dnd.isDraggingOverDropNode(node)
    const rect = getElementClientRectBounding(elementRef?.current)

    return (
      <NodeOutlineRoot
        ref={ref}
        data-aglyn={`outline:${$id}`}
        style={{ width: rect?.width, height: rect?.height, ...style }}
        className={clsx(
          {
            [classKeys.selectedSelf]: Boolean(isSelected),
            [classKeys.hoveringSelf]: Boolean(isHovered),
            [classKeys.draggingSelf]: Boolean(isDragging),
            [classKeys.draggingOver]: Boolean(isDraggingOver),
          },
          classKeys.root,
          className,
        )}
        {...rest}
      />
    )
  }),
)

NodeOutline.displayName = 'NodeOutline'

export default NodeOutline
