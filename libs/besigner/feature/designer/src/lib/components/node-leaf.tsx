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

import {
  buildComponentDefaultIconPaths,
  buildComponentDefaultTokens,
  buildComponentDefaultValues,
  composeReusableComponentNodes,
  displayBindingTokens,
  FORM_COMPONENT_ID,
  hasBindings,
  HostViewType,
  LAYOUT_SLOT_COMPONENT_ID,
  NODE_ROOT_ID,
  placedFormPlacement,
  resolveBindings,
  resolveComponentPropTokens,
  REUSABLE_INSTANCE_COMPONENT_ID,
} from '@aglyn/aglyn'
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
import { forwardRef, useCallback, useContext, useMemo, useRef } from 'react'
import BindingPickerContext from '../contexts/binding-picker-context'
import CanvasRevealContext, {
  CanvasMutedClassesContext,
} from '../contexts/canvas-reveal-context'
import ComponentPromotionContext from '../contexts/component-promotion-context'
import { useRenderedCanvasElements } from '../contexts/rendered-canvas-elements'
import useAglynBesignerFlag from '../hooks/use-aglyn-besigner-flag'
import { useNodeWithMediaAssetFacts } from '../hooks/use-media-asset-facts-overlay'
import useNodeWithHostTokens from '../hooks/use-node-with-host-tokens'
import {
  useNodeWithRepeatRecord,
  useRepeatCopies,
  useRepeatPreview,
} from '../hooks/use-repeat-preview'
import { RepeatRecordContext } from '../contexts/repeat-record-context'
import {
  isNodeHiddenOnSite,
  isNodeRevealedOnCanvas,
} from '../utils/canvas-reveal'
import { stripMutedClasses } from '../utils/muted-classes'
import DraggableDroppable from './dnd/draggable-droppable'
import EmptyDocumentSlot from './empty-document-slot'

/**
 * The plain `Leaf`, drawing a node the way the published page composes it: its
 * host variables filled in from the site being edited (AGL-2881), and a placed
 * image or film with its DAM asset's current facts (AGL-2838, AGL-2856).
 *
 * For the nodes the canvas renders that are not canvas nodes — a component
 * instance's definition, a placed form's design, the layout chrome — and so
 * never reach `NodeLeaf`. A footer's `{{host.businessName}}` still has to read
 * as the site's name, an asset inside one of them still has to show the shape
 * the published page gives it, and a film its poster.
 */
export const MediaFactsLeaf = forwardRef<any, LeafProps>((props, ref) => {
  const { node, ...rest } = props
  const withHostTokens = useNodeWithHostTokens(node)
  const withRecord = useNodeWithRepeatRecord(withHostTokens)
  const shown = useNodeWithMediaAssetFacts(withRecord)
  return <Leaf ref={ref} node={shown} {...rest} />
})
MediaFactsLeaf.displayName = 'MediaFactsLeaf'

/**
 * Renderer overrides for the inside of a component instance (AGL-1251).
 *
 * The plain `Leaf` (through `MediaFactsLeaf`), deliberately, where the canvas
 * otherwise uses `NodeLeaf`: the definition's nodes are NOT in the canvas, so
 * anything that made them draggable, selectable or droppable would be reaching
 * for canvas state that has no entry for them. Rendering them inert is not a
 * restriction bolted on afterwards — it is the only thing these nodes can be.
 */
const INERT_RENDERER = {
  TrunkComponent: Trunk,
  StemComponent: Stem,
  BranchComponent: Branch,
  LeafComponent: MediaFactsLeaf,
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

/**
 * The repeat badge (AGL-3111).
 *
 * Editor chrome, so it holds its accent literally for the reason
 * {@link SLOT_ACCENT} does: the canvas renders under the SITE's palette, and a
 * theme token here would repaint the editor's own furniture whenever a
 * subscriber restyled their site.
 *
 * It cannot reach a published page: only `NodeLeaf` draws it, and a published
 * page is composed from stored nodes and rendered through the plain `Leaf`.
 * The stored node is untouched either way — this is a render copy, like every
 * other thing the canvas lays over a node.
 */
const REPEAT_ACCENT = '#7C4DFF'

/** The chip's own ink, for the same reason and read against that accent. */
const REPEAT_INK = '#FFFFFF'

const RepeatBadge = ({ label, count }: { label: string; count: number }) => (
  <Box
    aria-hidden
    data-aglyn-repeat-badge=""
    sx={{
      // Out of the element's own layout: a badge that took part in a flex row
      // would move the design it is describing.
      position: 'absolute',
      top: 0,
      right: 0,
      zIndex: 2,
      // Never swallows a click — the element under it stays selectable.
      pointerEvents: 'none',
      px: 0.75,
      py: 0.25,
      maxWidth: '100%',
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      whiteSpace: 'nowrap',
      borderBottomLeftRadius: 3,
      backgroundColor: REPEAT_ACCENT,
      color: REPEAT_INK,
      fontSize: 11,
      fontWeight: 700,
      lineHeight: 1.6,
      letterSpacing: 0.2,
    }}
  >
    {`⟳ ${label} · ${count} ${count === 1 ? 'record' : 'records'}`}
  </Box>
)

export const NodeLeaf = observer(
  forwardRef<any, NodeLeafProps>((props, ref) => {
    const { node, children, ...rest } = props
    const [viewType] = useAglynBesignerFlag('viewType')
    // The canvas element registry, finally given a WRITER (AGL-2486).
    //
    // `RenderedCanvasElementsProvider` has existed since the registry was
    // introduced and `setElementRef`/`deleteElementRef` were called from
    // NOWHERE in the repo — `elements.current` was `{}` for the life of every
    // session. Everything that reads it therefore read an empty map and
    // failed the only way an empty map can: silently.
    //
    // Two features were void because of it, and neither logged anything:
    //
    //   `usePresence`'s cursor broadcast resolves the canvas root through
    //   this registry and bails with `if (!root) return`, so no editor has
    //   EVER written a cursor position. Confirmed against production RTDB on
    //   2026-08-22: three live presence entries across three rooms, not one
    //   carrying `cursorX`/`cursorY`.
    //
    //   `CollaboratorOverlays` resolves both the canvas root and each peer's
    //   selected node here, so `placements` was always empty and the overlay
    //   returned null. Confirmed live in the running console: a collaborator
    //   entry carrying both a cursor and a selection rendered its avatar and
    //   drew no cursor, no selection box and no name label.
    //
    // Registering here rather than in the renderer keeps it to the canvas:
    // `NodeLeaf` is the besigner's leaf component, so component-definition
    // previews (which render the plain `Leaf` through `INERT_RENDERER`) stay
    // out of the registry — they are not in the canvas and must not be
    // addressable as though they were.
    //
    // `NODE_ROOT_ID` and `CANVAS_ROOT_ELEMENT_ID` are the same string
    // (`'_@_'`), so keying on `$id` registers the canvas root under the id
    // the cursor code already looks for, with no special case.
    const { elements, setElementRef, deleteElementRef } =
      useRenderedCanvasElements()
    const $id = node?.$id
    // What THIS leaf last put in the registry. A remount can hand the new
    // element its ref before the old one is cleared, so an unconditional
    // delete on `null` would evict the live registration and put the
    // registry back to the state this whole change exists to fix.
    const registered = useRef<Element | null>(null)
    const registerElement = useCallback(
      (element: unknown) => {
        // Forward FIRST and unconditionally: dnd and the renderer already
        // depend on this ref, and registration must never change what they
        // observe.
        if (typeof ref === 'function') ref(element)
        else if (ref) (ref as { current: unknown }).current = element
        if (!$id) return
        if (element instanceof Element) {
          registered.current = element
          setElementRef($id, {
            $id,
            node: element,
            dragHandle: undefined,
          } as never)
          return
        }
        // Cleared (or never a DOM element — a class instance, say). Only
        // withdraw the registration if it is still OURS.
        const current = elements?.current?.[$id]?.node
        if (!registered.current || current === registered.current) {
          deleteElementRef($id)
        }
        registered.current = null
      },
      [ref, $id, elements, setElementRef, deleteElementRef],
    )
    const showSlotMarker =
      node?.componentId === LAYOUT_SLOT_COMPONENT_ID &&
      viewType === HostViewType.LAYOUT
    // A document with no nodes has nothing to aim at. Wrapped in a shared
    // layout it is worse than empty — the slot passes its children straight
    // through, so the root collapses to a zero-height strip between locked
    // chrome and the nav renders directly into the footer. Hung off the ROOT
    // leaf, which is already inside `DraggableDroppable`, so giving it height
    // is all a drop needs to resolve against the document root.
    const showEmptyDocumentSlot =
      node?.$id === NODE_ROOT_ID &&
      !node?.nodes?.length &&
      viewType !== HostViewType.LAYOUT

    // Nodes the author has opened up for designing (AGL-592). Through a
    // context rather than the flag itself: the canvas subscribes once and
    // every leaf reads the result.
    const revealedNodeIds = useContext(CanvasRevealContext)
    const mutedClasses = useContext(CanvasMutedClassesContext)

    // WYSIWYG bindings (AGL-97): resolve variable/function tokens
    // live on the rendered copy (selection/dnd keep the original node).
    // Bound nodes are flagged either way so editors can spot them.
    const [resolveFlag] = useAglynBesignerFlag('resolveBindings')
    const { variables, functions, componentProps } = useContext(
      BindingPickerContext,
    )
    const boundProps = useMemo(
      () =>
        Object.entries(node?.props ?? {}).filter(
          ([, value]) => typeof value === 'string' && hasBindings(value),
        ),
      // MobX props are observable; the JSON string keys the memo cheaply.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [node, JSON.stringify(node?.props ?? {})],
    )
    /**
     * A component editor draws with the definition's OWN defaults
     * (AGL-2870), so `{{prop.headline}}` shows the headline and a film with a
     * default source actually plays.
     *
     * Only props that HAVE a default are substituted. One without stays a
     * visible token, which is the signal an author needs: the slot is real
     * and nothing fills it yet. Substituting `''` there would draw an empty
     * component and hide the very thing they still have to decide.
     *
     * On a screen this path does nothing — the props belong to the component
     * route, and an instance is composed through `composeReusableComponentNodes`
     * below, which is the single substitution path a published page uses.
     */
    const defaultPropTokens = useMemo(
      () => buildComponentDefaultTokens(componentProps),
      [componentProps],
    )
    // The paths of the default icons, which a field bound to an icon property
    // draws with — the editor has no reason to have loaded the icon catalog.
    const defaultIconPaths = useMemo(
      () => buildComponentDefaultIconPaths(componentProps),
      [componentProps],
    )
    // The values the defaults hand their bound fields (AGL-2893), so a list
    // stays a list and a theme multiple a number on the editor's canvas too.
    const defaultValues = useMemo(
      () => buildComponentDefaultValues(componentProps),
      [componentProps],
    )
    const renderNode = useMemo(() => {
      const hasDeclaredProps = Boolean(componentProps?.length)
      if (
        !boundProps.length ||
        (!Object.keys(variables ?? {}).length &&
          !Object.keys(functions ?? {}).length &&
          !hasDeclaredProps)
      ) {
        return node
      }
      const resolved: Record<string, unknown> = { ...(node?.props ?? {}) }
      for (const [key, value] of boundProps) {
        // Resolve toggle off → show friendly token text: id tokens map to
        // the referent's CURRENT name (AGL-186), never raw doc ids.
        resolved[key] =
          resolveFlag === false
            ? displayBindingTokens(
                value as string,
                (variables ?? {}) as any,
                (functions ?? {}) as any,
              )
            : resolveBindings(
                value as string,
                (variables ?? {}) as any,
                (functions ?? {}) as any,
              )
      }
      const next = { ...node, props: resolved }
      if (!hasDeclaredProps) return next
      // Through the same substitution a placed instance uses, keyed by this
      // node alone — one code path deciding what a token becomes, never two
      // that could disagree.
      //
      // The raw-token view substitutes no defaults: an author who turned
      // resolution OFF asked to see the tokens, and a default is a resolved
      // value like any other. A field bound to a Yes/no property still
      // receives a yes or a no there, because a switch has no way to show a
      // token and reads the token's text as a yes.
      return (
        resolveComponentPropTokens(
          { [String(node?.$id)]: next as any },
          componentProps,
          resolveFlag === false ? undefined : defaultPropTokens,
          resolveFlag === false ? undefined : defaultIconPaths,
          resolveFlag === false ? undefined : defaultValues,
        )[String(node?.$id)] ?? next
      )
    }, [
      node,
      boundProps,
      resolveFlag,
      variables,
      functions,
      componentProps,
      defaultPropTokens,
      defaultIconPaths,
      defaultValues,
    ])

    // Host variables (AGL-2881), filled in on the same render copy and after
    // the bindings and the component's own defaults, which is the order the
    // published page composes in: a default that names the host resolves
    // too. The raw-token view reaches this leaf as no site at all
    // (`CanvasHostTokensProvider`), so its tokens stay as written. Keyed by
    // `boundProps`, which follows the observable props this copy reads.
    const hostResolvedNode = useNodeWithHostTokens(renderNode, boundProps)

    // Classes switched off for comparison (AGL-2486). Composed onto the SAME
    // render copy the binding resolution builds, never onto the canvas node:
    // selection, the hierarchy and every save keep reading the element's real
    // class list, and the canvas paints without the switched-off names.
    const renderNodeUnclassed = useMemo(
      () =>
        stripMutedClasses(hostResolvedNode as never, node?.$id, mutedClasses),
      [hostResolvedNode, node, mutedClasses],
    )

    /**
     * The record a repeat above this one is drawing (AGL-3111).
     *
     * Applied in the same place, and for the same reason, as the host tokens
     * and the DAM facts above: the published page substitutes `{{item.*}}`
     * when it composes, so the canvas substitutes it on the render copy while
     * the node keeps the tokens every save writes.
     */
    const withRepeatRecord = useNodeWithRepeatRecord(renderNodeUnclassed)

    // A placed asset's shape, and a film's length and poster, as its DAM
    // document records them NOW (AGL-2838, AGL-2856). The published page lays
    // the asset over the node when it is composed, so the canvas lays it over
    // the same render copy: a replace shows here as it shows to a visitor,
    // while selection, the panels and every save keep reading the node's
    // stored props.
    const shownNode = useNodeWithMediaAssetFacts(withRepeatRecord)

    /**
     * What this element repeats over, and the copies it draws (AGL-3111).
     *
     * The first record's copy is the element's own children — real canvas
     * nodes an author selects, drags and edits — with that record laid over
     * their render copies through {@link RepeatRecordContext}. Records 2..n
     * are inert pictures of the same template, built by the page's own
     * expansion. Editing the template therefore edits every copy, because
     * there is only ever one.
     */
    const repeatPreview = useRepeatPreview(node)
    const repeatCopies = useRepeatCopies(node, repeatPreview)
    const firstRecord = useMemo(
      () =>
        repeatPreview
          ? {
              record: repeatPreview.records[0],
              model: repeatPreview.dataset?.model,
              datasetsByKey: repeatPreview.datasetsByKey,
            }
          : undefined,
      [repeatPreview],
    )

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
    const { definitions, formDesigns } = useContext(ComponentPromotionContext)
    const instanceTree = useMemo(() => {
      if (node?.componentId !== REUSABLE_INSTANCE_COMPONENT_ID) {
        return undefined
      }
      // Already expanded into this canvas — the layout-chrome store grafts
      // before it loads (AGL-1218), so its instances arrive with children.
      // Rendering here too would draw the nav twice.
      if (node?.nodes?.length) return undefined
      const props = (node?.props ?? {}) as { refId?: string }
      const definition = props.refId ? definitions?.[props.refId] : undefined
      if (!definition?.nodes || !definition?.rootId) return undefined
      // Plain snapshot: props are MobX observables and the graft reads nested
      // `propValues` off them. The placement's classes stay out of it, as its
      // `sx` does: this leaf already renders both on the element around the
      // preview, and the graft joins a placement's classes onto the root it
      // becomes. Handed them here, the preview's root would apply every class
      // a second time, and keep `aglyn-hidden` collapsed inside a placement
      // the canvas has revealed for designing.
      const { className: _placementClasses, ...snapshotProps } = JSON.parse(
        JSON.stringify(node.props ?? {}),
      ) as Record<string, unknown>
      // Reuse the real graft so the canvas resolves `{{prop.*}}` exactly as
      // the published page will — one substitution path, not a second one
      // that could disagree about which value wins.
      const composed = composeReusableComponentNodes(
        {
          [node.$id]: {
            $id: node.$id,
            componentId: REUSABLE_INSTANCE_COMPONENT_ID,
            props: snapshotProps,
            // Root style overrides (AGL-1306) ride the same snapshot so
            // the canvas renders the SAME merged root sx the published
            // page will — the graft is the one merge point.
            ...(node.styleOverrides && {
              styleOverrides: JSON.parse(JSON.stringify(node.styleOverrides)),
            }),
            // Attribute overrides ride the same snapshot for the same
            // reason (AGL-1899). Leaving them out is invisible rather than
            // broken: Preview and tenant SSR compose from the stored node
            // and WOULD apply them, so the canvas alone would draw the
            // component's own attributes and disagree with both.
            ...(node.attrOverrides && {
              attrOverrides: JSON.parse(JSON.stringify(node.attrOverrides)),
            }),
            nodes: [],
          } as any,
        },
        // The host's WHOLE definitions map, not just this instance's own
        // (AGL-1898). A definition may contain instances of OTHER
        // definitions, and `composeReusableComponentNodes` expands those —
        // but only the ones it is handed. Preview, tenant SSR and the
        // layout-chrome graft all pass the full map, so a one-entry map
        // here made the canvas the only surface that left a nested
        // component as an unexpanded placeholder.
        //
        // It also silently voided propagation for the inner component:
        // publishing a shared button re-rendered every canvas showing it
        // directly and none of the ones showing it through the nav that
        // contains it — which is the case a shared component is usually in.
        //
        // Safe to widen because the `nodes` argument above is this ONE
        // instance: the extra definitions can only be reached from inside
        // the subtree being grafted, never applied to some other node.
        definitions as any,
      )
      // The graft puts the definition's root IN the instance's place rather
      // than under it (AGL-2521), so the component to draw is at the
      // instance's own id. Reading `nodes[0]` here would render the root's
      // FIRST CHILD and drop the component's outer element with its siblings.
      const grafted = composed[node.$id]
      return grafted && grafted.componentId !== REUSABLE_INSTANCE_COMPONENT_ID
        ? denormalizeTree(composed, node.$id)
        : undefined
      // Observable props/overrides: the JSON strings key the memo, as above.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [
      node,
      JSON.stringify(node?.props ?? {}),
      JSON.stringify(node?.styleOverrides ?? {}),
      JSON.stringify(node?.attrOverrides ?? {}),
      definitions,
    ])

    /**
     * A placed form draws its ENTITY'S published fields, not the page's copy
     * of them (`docs/specs/reusable-forms.md`).
     *
     * The same render-copy treatment the instance above gets, and for the same
     * reason: the entity's nodes stay out of the canvas, so there is nothing to
     * lock, nothing to strip before a save, and no way for a form's fields to
     * be persisted into the screen that placed it.
     *
     * It runs the REAL graft rather than reading `design.nodes` directly, so a
     * component nested inside the form design expands here exactly as it will
     * on the published page — one resolution path, not a second that could
     * disagree.
     *
     * When it resolves, the node's own children are not rendered (below): the
     * published page discards them, and a canvas that drew both would show the
     * author a page that does not exist. Where the entity has no published
     * design the memo is `undefined`, the children render, and the form the
     * author drew is the form they see — which is every form built before the
     * entity existed.
     */
    const placedForm = useMemo(() => {
      if (node?.componentId !== FORM_COMPONENT_ID) return undefined
      const formId = (node?.props as { formId?: unknown } | undefined)?.formId
      if (typeof formId !== 'string' || !formId) return undefined
      const composed = composeReusableComponentNodes(
        {
          [node.$id]: {
            $id: node.$id,
            componentId: FORM_COMPONENT_ID,
            // Plain snapshot: props are MobX observables, as above.
            props: JSON.parse(JSON.stringify(node.props ?? {})),
            nodes: [],
          } as any,
        },
        // Component definitions ride along so an instance INSIDE the form
        // design expands; the map is safe to pass whole for the reason the
        // instance graft above states — the one node handed in is this form.
        definitions as any,
        [placedFormPlacement(formDesigns as any)],
      )
      /*
       * The composed REPLACEMENT is the node the published page draws in this
       * placement's place — the design's root, carrying the placement's id
       * (AGL-2521) — and its children are the design's own.
       *
       * Reading the replacement rather than the placement is what keeps the
       * canvas honest about the element itself. A real form design is a
       * container holding the `form` node, so the placement's `form` used to
       * be drawn AROUND the design's: two `<form>` elements nested, each
       * drawing its own send button, where a visitor sees one. Taking only
       * the first child also dropped everything a design put beside its form.
       */
      const replacement = composed[node.$id]
      const childIds = (replacement?.nodes as string[] | undefined) ?? []
      if (!replacement || !childIds.length) return undefined
      const trees = childIds
        .map((childId) => denormalizeTree(composed, childId))
        .filter(Boolean)
      return trees.length ? { replacement, trees } : undefined
      // Observable props: the JSON string keys the memo, as above.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [node, JSON.stringify(node?.props ?? {}), definitions, formDesigns])

    /**
     * The element this leaf DRAWS, once a placed form resolves.
     *
     * The published page renders the entity's root here, not the placement:
     * the two denote the same element and the graft merges them. The canvas
     * draws the same one, so an author sees the form their visitors will. As
     * with the DAM facts and the host tokens above, this is a render copy —
     * selection, the panels and every save keep reading `node`.
     */
    const shownLeafNode = useMemo(
      () =>
        placedForm
          ? ({
              ...(shownNode as Record<string, unknown>),
              componentId: placedForm.replacement.componentId,
              props: (placedForm.replacement.props ?? {}) as never,
              ...(placedForm.replacement.sx === undefined
                ? {}
                : { sx: placedForm.replacement.sx }),
            } as typeof shownNode)
          : shownNode,
      [placedForm, shownNode],
    )

    return (
      <DraggableDroppable
        node={node}
        type={Besigner.DragType.CANVAS}
        accept={Object.values(Besigner.DragType)}
        disableDragging={!Besigner.dnd.canDragNode(node)}
      >
        <Leaf
          ref={registerElement}
          node={shownLeafNode as typeof node}
          data-aglyn-selected={Besigner.focus.isNodeSelected(node)}
          // Present while the selection lives in this node's subtree (the
          // node itself or any descendant). Canvas-aware components (nav
          // menus, drawers) read this neutral leaf attribute to expand
          // only while they are being authored (AGL-571). Presence-based
          // (''/undefined) so unaffected leaves carry no attribute.
          data-aglyn-selected-within={
            Besigner.focus.isNodeOrDescendantSelected(node) ? '' : undefined
          }
          // Present on an element that carries the hidden class while the
          // canvas is showing it anyway (AGL-592) — the flag the canvas
          // stylesheet checks before collapsing it. Stamped on the hidden
          // element itself, so no wrapper a component renders around its
          // children can come between the two.
          data-aglyn-revealed={
            isNodeHiddenOnSite(node) &&
            isNodeRevealedOnCanvas(node, revealedNodeIds)
              ? ''
              : undefined
          }
          data-aglyn-bound={boundProps.length ? '' : undefined}
          {...rest}
        >
          {/* A resolved form entity REPLACES the page's own fields, exactly
              as the published page composes it — see `placedForm`. */}
          {placedForm ? null : firstRecord ? (
            // The template IS the first copy: the real children, drawing the
            // first record. Provided around them rather than applied to them,
            // so every descendant leaf resolves its own tokens the way the
            // page's substitution walks the whole cloned subtree.
            <RepeatRecordContext.Provider value={firstRecord}>
              {children}
            </RepeatRecordContext.Provider>
          ) : (
            children
          )}
          {repeatCopies.length ? (
            // Inert and click-through like the component and form previews
            // below, and for the same reason: a copy is a picture of the
            // template, not a document. Selecting one would offer an author
            // an element no save can reach.
            <Box
              sx={{ pointerEvents: 'none' }}
              data-aglyn-repeat-preview=""
              aria-hidden
            >
              <RendererComponents.Provider value={INERT_RENDERER as any}>
                {repeatCopies.map((copy) => (
                  <Stem key={copy.$id} node={copy} />
                ))}
              </RendererComponents.Provider>
            </Box>
          ) : null}
          {repeatPreview ? (
            <RepeatBadge
              label={repeatPreview.label}
              count={repeatPreview.records.length}
            />
          ) : null}
          {placedForm ? (
            // Inert and click-through like the instance preview below: the
            // fields belong to the form, and they are edited in the form's own
            // besigner, so the only selectable thing here is the placement.
            <Box sx={{ pointerEvents: 'none' }} data-aglyn-form-preview="">
              <RendererComponents.Provider value={INERT_RENDERER as any}>
                {placedForm.trees.map((tree) => (
                  <Stem key={tree.$id} node={tree} />
                ))}
              </RendererComponents.Provider>
            </Box>
          ) : null}
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
            <SlotMarker
              caption={node?.props?.['caption'] as string | undefined}
            />
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
