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

import * as Aglyn from '@aglyn/aglyn'
import * as Besigner from '@aglyn/besigner'
import { alpha, generateComponentClassKeys } from '@aglyn/shared-ui-theme'
import mergeSxProps from '@aglyn/shared-ui-theme/util/merge-sx-props'
import { getElementClientRectBounding } from '@aglyn/shared-util-dom'
import { Box, BoxProps } from '@mui/material'
import clsx from 'clsx'
import { observer } from 'mobx-react-lite'
import { forwardRef } from 'react'

const classKeys = generateComponentClassKeys('NodeOutline', [
  'hoveringSelf',
  'selectedSelf',
  'draggingSelf',
  'draggingOver',
])

export interface NodeOutlineProps extends BoxProps {
  node: Aglyn.NodeSchema<any>
}

const NodeOutlineRaw = forwardRef<any, NodeOutlineProps>((props, ref) => {
  const { className, node, sx, ...rest } = props
  const $id = node?.$id
  const elementRef = Besigner.refs.get($id)
  const isSelected = Besigner.focus.isNodeSelected(node)
  const isHovered = Besigner.focus.isNodeHovered(node)
  const isDragging = Besigner.dnd.state.isDraggingNode(node)
  const isDraggingOver = Besigner.dnd.isDraggingOverDropNode(node)
  const rect = getElementClientRectBounding(elementRef?.node.current)

  return (
    <Box
      ref={ref}
      data-aglyn={`outline:${$id}`}
      style={{ width: rect?.width, height: rect?.height }}
      className={clsx(
        {
          [classKeys.selectedSelf]: Boolean(isSelected),
          [classKeys.hoveringSelf]: Boolean(isHovered),
          [classKeys.draggingSelf]: Boolean(isDragging),
          [classKeys.draggingOver]: Boolean(isDraggingOver),
        },
        className,
      )}
      sx={mergeSxProps(
        {
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
            outlineColor: (theme) => theme.palette.tertiary.main,
          },
          [`&.${classKeys.hoveringSelf}`]: {
            outlineColor: (theme) => theme.palette.secondary.main,
            backgroundColor: (theme) =>
              alpha(theme.palette.secondary.main, 0.12),
          },
          [`&.${classKeys.draggingSelf}`]: {
            outlineColor: 'transparent',
            backgroundColor: (theme) =>
              alpha(theme.palette.secondary.light, 0.76),
          },
          [`&.${classKeys.draggingOver}`]: {
            outlineColor: (theme) => theme.palette.tertiary.main,
            backgroundColor: (theme) =>
              alpha(theme.palette.tertiary.dark, 0.76),
          },
          [`&.${classKeys.draggingOver}.${classKeys.draggingSelf}`]: {
            outlineColor: (theme) => theme.palette.grey['500'],
            backgroundColor: (theme) => alpha(theme.palette.grey['500'], 0.64),
          },
        },
        sx,
      )}
      {...rest}
    />
  )
})

NodeOutlineRaw.displayName = 'NodeOutline'

export const NodeOutline = observer(NodeOutlineRaw)
export default NodeOutline
