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
import {
  Branch,
  Leaf,
  type LeafProps,
  RendererComponents,
  Stem,
  Trunk,
} from '@aglyn/aglyn-node-renderer'
import * as Besigner from '@aglyn/besigner'
import { alpha, Box } from '@mui/material'
import { observer } from 'mobx-react-lite'
import { forwardRef, useContext, useMemo } from 'react'
import BindingPickerContext from '../contexts/binding-picker-context'
import ComponentPromotionContext from '../contexts/component-promotion-context'
import useAglynBesignerFlag from '../hooks/use-aglyn-besigner-flag'
import DraggableDroppable from './dnd/draggable-droppable'
import EmptyDocumentSlot from './empty-document-slot'

/**
 * Renderer overrides for the inside of a component instance (AGL-1251).
 *
 * The plain `Leaf`, deliberately, where the canvas otherwise uses `NodeLeaf`:
 * the definition's nodes are NOT in the canvas, so anything that made them
 * draggable, selectable or droppable would be reaching for canvas state that
 * has no entry for them. Rendering them inert is not a restriction bolted on
 * afterwards — it is the only thing these nodes can be.
 */
const INERT_RENDERER = {
  TrunkComponent: Trunk,
  StemComponent: Stem,
  BranchComponent: Branch,
  LeafComponent: Leaf,
}

/**
 * Nested-object form of a normalized node map, which is what `Branch` walks
 * (`node.children`). Cycle-safe via `seen`: a definition that somehow
 * referenced an ancestor would otherwise recurse until the stack gave out.
 */
export function denormalizeTree(
  nodes: Record<string, any>,
  rootId: string,
  seen: Set<string> = new Set(),
): any {
  const node = nodes?.[rootId]
  if (!node || seen.has(rootId)) return undefined
  seen.add(rootId)
  const childIds = Array.isArray(node.nodes) ? node.nodes : []
  return {
    ...node,
    children: childIds
      .map((childId: string) => denormalizeTree(nodes, childId, seen))
      .filter(Boolean),
  }
}

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

    // A component instance renders its definition (AGL-1251) instead of the
    // named dashed box. Authors placed a hero and saw a grey rectangle, so
    // the props they filled in were invisible until Preview.
    //
    // Rendered, never grafted: the definition's nodes stay out of the canvas
    // entirely. That is what makes this safe — there is nothing to lock,
    // nothing to strip before a save, and no way for a definition's node to
    // be persisted into the document that placed it. Same shape as the
    // binding resolution above, which renders a resolved copy while
    // selection and dnd keep the original node.
    const { definitions } = useContext(ComponentPromotionContext)
    const instanceTree = useMemo(() => {
      if (node?.componentId !== Aglyn.REUSABLE_INSTANCE_COMPONENT_ID) {
        return undefined
      }
      // Already expanded into this canvas — the layout-chrome store grafts
      // before it loads (AGL-1218), so its instances arrive with children.
      // Rendering here too would draw the nav twice.
      if (node?.nodes?.length) return undefined
      const props = (node?.props ?? {}) as { refId?: string }
      const definition = props.refId ? definitions?.[props.refId] : undefined
      if (!definition?.nodes || !definition?.rootId) return undefined
      // Reuse the real graft so the canvas resolves `{{prop.*}}` exactly as
      // the published page will — one substitution path, not a second one
      // that could disagree about which value wins.
      const composed = Aglyn.composeReusableComponentNodes(
        {
          [node.$id]: {
            $id: node.$id,
            componentId: Aglyn.REUSABLE_INSTANCE_COMPONENT_ID,
            // Plain snapshot: props are MobX observables and the graft
            // reads nested `propValues` off them.
            props: JSON.parse(JSON.stringify(node.props ?? {})),
            nodes: [],
          } as any,
        },
        { [props.refId as string]: definition } as any,
      )
      const graftedRootId = (composed[node.$id]?.nodes as string[])?.[0]
      return graftedRootId ? denormalizeTree(composed, graftedRootId) : undefined
      // Observable props: the JSON string keys the memo, as above.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [node, JSON.stringify(node?.props ?? {}), definitions])

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
          {instanceTree ? (
            // `pointerEvents: none` so a click anywhere on the rendered
            // component still lands on the instance beneath it — the
            // instance is the only thing here that can be selected, and the
            // only thing whose Attributes are editable.
            <Box sx={{ pointerEvents: 'none' }} data-aglyn-component-preview="">
              <RendererComponents.Provider value={INERT_RENDERER as any}>
                <Stem node={instanceTree} />
              </RendererComponents.Provider>
            </Box>
          ) : null}
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
