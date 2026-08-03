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
import { generateComponentClassKeys } from '@aglyn/shared-ui-theme'
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
})(({ theme }) => {
  const tv = (theme as any).vars || theme
  // Everything below rides `tv`, so both the outline colour and the fill
  // alphas follow the previewed scheme. `tertiary` carries the generated
  // light/dark/mainChannel tokens (addShadeVariants + the CSS-vars theme),
  // verified against the running console's computed custom properties.
  const slate = tv.palette.tertiary.main
  const slateChannel = tv.palette.tertiary.mainChannel
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
    content: '""',

    // Canvas chrome is the SLATE (AGL-1194). Selected used to be
    // `secondary` and hover `primary` — two different accent hues on the
    // same control, both competing with the design being edited. The four
    // states now differ by STYLE and WEIGHT on one hue, which is what
    // distinguishes them anyway: dashed hover, solid selection, a fill for
    // the node in flight, and the heaviest treatment for the drop target.
    [`&.${classKeys.selectedSelf}`]: {
      outlineWidth: 2,
      outlineStyle: 'solid',
      outlineColor: slate,
    },
    [`&.${classKeys.hoveringSelf}`]: {
      outlineColor: slate,
      backgroundColor: `rgba(${slateChannel} / 0.08)`,
    },
    [`&.${classKeys.draggingSelf}`]: {
      outlineColor: 'transparent',
      backgroundColor: `rgba(${slateChannel} / 0.12)`,
    },
    // The drop target is momentary and must be unmistakable, so it keeps
    // the strongest treatment rather than a second hue.
    [`&.${classKeys.draggingOver}`]: {
      outlineWidth: 2,
      outlineStyle: 'solid',
      outlineColor: slate,
      backgroundColor: `rgba(${slateChannel} / 0.16)`,
    },
    [`&.${classKeys.draggingOver}.${classKeys.draggingSelf}`]: {
      outlineColor: tv.palette.grey['500'],
      backgroundColor: 'rgba(158 158 158 / 0.64)',
    },
  }
})

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
