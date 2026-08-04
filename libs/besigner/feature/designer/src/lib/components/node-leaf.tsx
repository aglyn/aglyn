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
import { alpha, Box } from '@mui/material'
import { observer } from 'mobx-react-lite'
import { forwardRef, useContext, useMemo } from 'react'
import BindingPickerContext from '../contexts/binding-picker-context'
import useAglynBesignerFlag from '../hooks/use-aglyn-besigner-flag'
import DraggableDroppable from './dnd/draggable-droppable'
import EmptyDocumentSlot from './empty-document-slot'

export interface NodeLeafProps extends LeafProps {}

/**
 * The slot marker is EDITOR CHROME, so it holds the brand accent literally
 * rather than reading `secondary` from the theme: the canvas renders under
 * the host's palette, so a token would repaint the editor's own furniture
 * whenever a subscriber restyles their site — and it already rendered pink
 * instead of the design's blue.
 */
const SLOT_ACCENT = '#00B0FF'

/**
 * Visible placement marker for the LayoutSlot while editing a layout. The
 * slot is a passthrough at runtime, so without this it disappears once it
 * has children and designers lose track of where screen content lands.
 */
const SlotMarker = ({ caption }: { caption?: string }) => (
  <Box
    aria-hidden
    data-aglyn-slot-marker=""
    sx={{
      m: 1,
      p: 2,
      minHeight: 64,
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 0.5,
      borderWidth: 2,
      borderStyle: 'dashed',
      // Brand blue on a faint tint, not a grey dashed box: the slot is the
      // one region the layout does not own, and it should not read as just
      // another empty container.
      borderColor: SLOT_ACCENT,
      backgroundColor: alpha(SLOT_ACCENT, 0.06),
      borderRadius: 1,
      color: 'text.secondary',
      fontSize: 13,
      textAlign: 'center',
    }}
  >
    <Box component="span" sx={{ color: SLOT_ACCENT, fontWeight: 700 }}>
      {'◇ layout-slot'}
    </Box>
    <Box component="span">{caption || 'Screen content renders here'}</Box>
  </Box>
)

export const NodeLeaf = observer(
  forwardRef<any, NodeLeafProps>((props, ref) => {
    const { node, children, ...rest } = props
    const [viewType] = useAglynBesignerFlag('viewType')
    const showSlotMarker =
      node?.componentId === Aglyn.LAYOUT_SLOT_COMPONENT_ID &&
      viewType === Aglyn.HostViewType.LAYOUT
    // A document with no nodes has nothing to aim at. Wrapped in a shared
    // layout it is worse than empty — the slot passes its children straight
    // through, so the root collapses to a zero-height strip between locked
    // chrome and the nav renders directly into the footer. Hung off the ROOT
    // leaf, which is already inside `DraggableDroppable`, so giving it height
    // is all a drop needs to resolve against the document root.
    const showEmptyDocumentSlot =
      node?.$id === Aglyn.NODE_ROOT_ID &&
      !node?.nodes?.length &&
      viewType !== Aglyn.HostViewType.LAYOUT

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
          {showSlotMarker ? (
            <SlotMarker caption={node?.props?.['caption'] as string | undefined} />
          ) : null}
          {showEmptyDocumentSlot ? <EmptyDocumentSlot /> : null}
        </Leaf>
      </DraggableDroppable>
    )
  }),
)
NodeLeaf.displayName = 'BesignerLeafComponent'
NodeLeaf.aglyn = true

export default NodeLeaf
