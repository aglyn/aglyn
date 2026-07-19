/**
 * @license
 * Copyright 2023 Aglyn LLC
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
import { Leaf, type LeafProps } from '@aglyn/aglyn-node-renderer'
import * as Besigner from '@aglyn/besigner'
import { Box } from '@mui/material'
import { observer } from 'mobx-react-lite'
import { forwardRef, useContext, useMemo } from 'react'
import BindingPickerContext from '../contexts/binding-picker-context'
import useAglynBesignerFlag from '../hooks/use-aglyn-besigner-flag'
import DraggableDroppable from './dnd/draggable-droppable'

export interface NodeLeafProps extends LeafProps {}

/**
 * Visible placement marker for the LayoutSlot while editing a layout. The
 * slot is a passthrough at runtime, so without this it disappears once it
 * has children and designers lose track of where screen content lands.
 */
const SlotMarker = () => (
  <Box
    aria-hidden
    data-aglyn-slot-marker=""
    sx={{
      m: 1,
      p: 2,
      minHeight: 64,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 2,
      borderStyle: 'dashed',
      borderColor: 'divider',
      borderRadius: 1,
      color: 'text.secondary',
      fontSize: 13,
      letterSpacing: 1,
      textTransform: 'uppercase',
    }}
  >
    {'Screen content renders here'}
  </Box>
)

export const NodeLeaf = observer(
  forwardRef<any, NodeLeafProps>((props, ref) => {
    const { node, children, ...rest } = props
    const [viewType] = useAglynBesignerFlag('viewType')
    const showSlotMarker =
      node?.componentId === Aglyn.LAYOUT_SLOT_COMPONENT_ID &&
      viewType === Aglyn.HostViewType.LAYOUT

    // WYSIWYG bindings (AGL-97): resolve variable/function tokens
    // live on the rendered copy (selection/dnd keep the original node).
    // Bound nodes are flagged either way so editors can spot them.
    const [resolveFlag] = useAglynBesignerFlag('resolveBindings')
    const { variables, functions } = useContext(BindingPickerContext)
    const boundProps = useMemo(
      () =>
        Object.entries(node?.props ?? {}).filter(
          ([, value]) =>
            typeof value === 'string' && Aglyn.hasBindings(value),
        ),
      // MobX props are observable; the JSON string keys the memo cheaply.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [node, JSON.stringify(node?.props ?? {})],
    )
    const renderNode = useMemo(() => {
      if (
        !boundProps.length ||
        (!Object.keys(variables ?? {}).length &&
          !Object.keys(functions ?? {}).length)
      ) {
        return node
      }
      const resolved: Record<string, unknown> = { ...(node?.props ?? {}) }
      for (const [key, value] of boundProps) {
        // Resolve toggle off → show friendly token text: id tokens map to
        // the referent's CURRENT name (AGL-186), never raw doc ids.
        resolved[key] =
          resolveFlag === false
            ? Aglyn.displayBindingTokens(
                value as string,
                (variables ?? {}) as any,
                (functions ?? {}) as any,
              )
            : Aglyn.resolveBindings(
                value as string,
                (variables ?? {}) as any,
                (functions ?? {}) as any,
              )
      }
      return { ...node, props: resolved }
    }, [node, boundProps, resolveFlag, variables, functions])

    return (
      <DraggableDroppable
        node={node}
        type={Besigner.DragType.CANVAS}
        accept={Object.values(Besigner.DragType)}
        disableDragging={!Besigner.dnd.canDragNode(node)}
      >
        <Leaf
          ref={ref}
          node={renderNode as typeof node}
          data-aglyn-selected={Besigner.focus.isNodeSelected(node)}
          // Present while the selection lives in this node's subtree (the
          // node itself or any descendant). Canvas-aware components (nav
          // menus, drawers) read this neutral leaf attribute to expand
          // only while they are being authored (AGL-571). Presence-based
          // (''/undefined) so unaffected leaves carry no attribute.
          data-aglyn-selected-within={
            Besigner.focus.isNodeOrDescendantSelected(node) ? '' : undefined
          }
          data-aglyn-bound={boundProps.length ? '' : undefined}
          {...rest}
        >
          {children}
          {showSlotMarker ? <SlotMarker /> : null}
        </Leaf>
      </DraggableDroppable>
    )
  }),
)
NodeLeaf.displayName = 'BesignerLeafComponent'
NodeLeaf.aglyn = true

export default NodeLeaf
