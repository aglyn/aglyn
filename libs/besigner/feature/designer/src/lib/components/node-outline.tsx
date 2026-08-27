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
  // The two accents the canvas is allowed, one rule each: pink says WHAT IS
  // SELECTED, blue says WHAT THE POINTER WOULD SELECT. See the rules below
  // for why these two states — and no others — are exempt from the slate;
  // `canvas-chrome-palette.spec.ts` pins each exemption to its declaration.
  const selectionAccent = tv.palette.secondary.main
  const hoverAccent = tv.palette.primary.main
  const hoverAccentChannel = tv.palette.primary.mainChannel
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

    // Canvas chrome is the SLATE (AGL-1194) for DRAG and DROP-OVER: those
    // are momentary, so they differ by STYLE and WEIGHT on one hue — a fill
    // for the node in flight, and the heaviest treatment for the drop
    // target.
    //
    // The two states that answer "what am I editing" carry an accent
    // instead. Selection (AGL-1221) is a persistent statement about what the
    // panels on the right are editing, it has to survive against an
    // arbitrary subscriber palette, and pink is the one hue on this canvas
    // that never competes with the design being edited.
    //
    // Hover is the pointer's half of that same question, and the slate
    // cannot answer it: the slate is a DESATURATED BLUE, ~17 degrees of hue
    // from `primary`, so on the dark canvas it reads as the disabled version
    // of an affordance rather than a live one. It carries `primary`, which
    // is the same one hue in both schemes.
    //
    // Selection stays the stronger of the two by weight and by style: 2px
    // solid against the 1px dashed the root sets. It claims the border and
    // nothing else, so it never cancels the wash underneath it.
    [`&.${classKeys.selectedSelf}`]: {
      outlineWidth: 2,
      outlineStyle: 'solid',
      outlineColor: selectionAccent,
    },
    // The two hover affordances answer different questions, so they are
    // scoped differently.
    //
    // The WASH tracks the POINTER, so it is unconditional: the pointer is
    // over this node whether or not the node is also the selected one, and a
    // selected node that loses its wash gives the pointer no feedback at all.
    [`&.${classKeys.hoveringSelf}`]: {
      backgroundColor: `rgba(${hoverAccentChannel} / 0.08)`,
    },
    // The OUTLINE is the one that defers, because selection already owns
    // that border and says something stronger with it. The `:not()` is
    // load-bearing — this rule and the selected rule have equal specificity
    // and this one is declared second, so without it the blue would repaint
    // the pink outline of whichever element the pointer happens to rest on.
    [`&.${classKeys.hoveringSelf}:not(.${classKeys.selectedSelf})`]: {
      outlineColor: hoverAccent,
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

export interface NodeOutlineProps extends ComponentProps<
  typeof NodeOutlineRoot
> {
  node: Aglyn.NodeSchema<any>
}

export const NodeOutline = observer(
  forwardRef<HTMLDivElement, NodeOutlineProps>((props, ref) => {
    const { className, node, style, ...rest } = props
    const $id = node?.$id
    const isSelected = Besigner.focus.isNodeSelected(node)
    const isHovered = Besigner.focus.isNodeHovered(node)
    const isDragging = Besigner.dnd.isDraggingNode(node)
    const isDraggingOver = Besigner.dnd.isDraggingOverDropNode(node)

    return (
      <NodeOutlineRoot
        ref={ref}
        data-aglyn={`outline:${$id}`}
        // Geometry comes from the caller and ONLY from the caller
        // (AGL-2486). This used to take a second, independent
        // `getBoundingClientRect()` of the node and then let `style`
        // override it — a forced layout on every observer tick whose result
        // was always discarded. Now that one outline is drawn per line
        // FRAGMENT that read would happen once per fragment per render, and
        // it could never answer the question anyway: a single rect cannot
        // say which fragment this one is.
        style={style}
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
