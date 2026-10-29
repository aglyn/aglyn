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

import type * as Aglyn from '@aglyn/aglyn'
import {
  canvas,
  components,
  FEATURE_FLAG,
  getInstanceEffectivePropHtml,
  getInstanceEffectivePropText,
  inheritedMediaAlt,
  isDefinitionPlacement,
  listPropFedTextNodeIds,
  placementDefinitionFor,
  resolveInstanceLeafBinding,
  REUSABLE_INSTANCE_COMPONENT_ID,
  REUSABLE_INSTANCE_PROP_VALUES_KEY,
} from '@aglyn/aglyn'
import * as Besigner from '@aglyn/besigner'
import { mergeRefs, useId } from '@aglyn/shared-ui-jsx'
import { useDraggable, useDroppable } from '@dnd-kit/core'
import { CSS as css } from '@dnd-kit/utilities'
import { mergeProps } from '@react-aria/utils'
import { observer } from 'mobx-react-lite'
import {
  Children,
  cloneElement,
  CSSProperties,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react'
import ComponentPromotionContext from '../../contexts/component-promotion-context'
import { MediaPickerContext } from '../../contexts/media-picker-context'
import {
  findMarkdownAttributeName,
  inlineMarkdownEdit,
} from '../../utils/inline-markdown-edit.store'
import {
  inlineTextEdit,
  isInlineEditWithin,
} from '../../utils/inline-text-edit.store'
import { requestCanvasContextMenu } from '../../utils/canvas-context-menu'
import {
  findInstanceLeafAtPoint,
  findPlacementPartAtPoint,
} from '../../utils/instance-leaf-hit'
import { pickPlacementPart } from '../../utils/placement-part-pick'
import { findLeafTextElement } from '../../utils/in-place-edit-surface'
import { holdKeyboardForEdit } from '../../utils/touch-keyboard'
import { repeatCopyAt, repeatCopyStandIns } from '../../utils/repeat-copy'
import { DropSurface } from './drop-surface'

/** A pointer position, from a mouse event or a touch. */
type ClientPoint = { clientX: number; clientY: number }

/** A finger's position and the event time it was read at. */
type TapPoint = { x: number; y: number; at: number }

/** The furthest a finger may slide and still be tapping, in px. */
const TAP_SLOP_PX = 10
/** The longest a press may last and still be a tap, in ms; longer is a hold. */
const TAP_MAX_MS = 300
/** How soon the second tap of a double-tap must follow the first, in ms. */
const DOUBLE_TAP_WITHIN_MS = 350
/** How far from the first tap the second may land, in px. */
const DOUBLE_TAP_SLOP_PX = 24

const distance = (a: { x: number; y: number }, b: { x: number; y: number }) =>
  Math.hypot(a.x - b.x, a.y - b.y)

export interface DraggableDroppableProps<T extends Aglyn.NodeSchema<any>> {
  children: JSX.Element
  node: T
  type: Besigner.DragType
  accept: Besigner.DragType[]
  disableDragging?: boolean
  disableDropping?: boolean
  idSuffix?: string
}

export const DraggableDroppable = observer(
  <T extends Aglyn.NodeSchema<any>>(props: DraggableDroppableProps<T>) => {
    const {
      node,
      type,
      disableDragging,
      disableDropping,
      accept,
      children,
      idSuffix,
    } = props
    const id = useId(node?.$id)
    const ref = useRef<HTMLElement>(null)
    /**
     * The element as STATE, beside the ref, so the listeners below follow it.
     *
     * A component may render a different element for the same node: a
     * Typography whose text gains a line break holds block content, which a
     * `<p>` cannot, so it re-renders as a `<div>`. The listeners were bound
     * once per node, to the element that was there first, and stayed on the
     * detached `<p>` — a click on the text then reached the parent instead,
     * which selected the Stack around it, and a double-click opened nothing.
     */
    const [element, setElement] = useState<HTMLElement | null>(null)
    // Records a real element only. The merged ref below is a fresh callback
    // every render, so React hands it `null` and then the element on each
    // commit; setting the same element again bails out, a `null` would not.
    const trackElement = useCallback((next: HTMLElement | null) => {
      if (next) setElement(next)
    }, [])

    const draggable = useDraggable({
      id: `${id}:${type}${idSuffix || ''}`,
      data: { type, node },
      disabled: disableDragging,
    })

    const droppable = useDroppable({
      id: `${id}:${type}${idSuffix || ''}`,
      data: {
        type,
        node,
        accept,
        surface: DropSurface.CANVAS,
        // Measured live by the drop marker: dnd-kit's cached rect cannot
        // follow the canvas scrolling from inside its shadow root.
        getElement: () => ref.current,
      },
      disabled: disableDropping,
    })

    const transform = draggable.transform
    const isTransforming = Boolean(draggable.transform)
    const child = Children.only(children)
    const style: CSSProperties = {
      ...child.props.style,
      // cursor: 'move',
      outlineWidth: 2,
      outlineOffset: -1,
      outlineColor: 'grey',
      outlineStyle: 'dotted',
      // transform: css.Transform.toString(transform),
      // scale: css.Scale.toString(transform),
      translate: css.Translate.toString(transform),

      ...(isTransforming
        ? {
            // transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`,
            // cursor: 'grab',
          }
        : {}),
      ...(droppable.isOver
        ? {
            outlineColor: 'lime',
            outlineStyle: 'solid',
            outlineOffset: '3',
          }
        : {}),
      ...(draggable.isDragging
        ? {
            outlineColor: 'grey',
            outlineStyle: 'double',
            outlineOffset: -1 as any,
            opacity: 0.5,
            cursor: 'move',
          }
        : {}),
      // Element-picker affordance (AGL-574): while the interaction builder
      // is picking a target, every leaf shows the crosshair and the hovered
      // one gets a distinct violet ring — deliberately unlike the normal
      // selection/drop outlines so "pick this" reads as its own mode.
      ...(Besigner.pick.isPicking() ? { cursor: 'crosshair' } : {}),
      ...(Besigner.pick.isPicking() && Besigner.focus.isNodeHovered(node)
        ? {
            outlineColor: '#7c4dff',
            outlineStyle: 'solid',
            outlineWidth: 2,
            outlineOffset: 2 as any,
          }
        : {}),
    }

    // Instance-internals double-click (AGL-1304) needs the component
    // definitions (hit-test) and the host's media picker (image props).
    // Read through a ref so the listener effect below keeps its `[node]`
    // dependency — context updates must not re-register DOM listeners.
    const { definitions, formDesigns } = useContext(ComponentPromotionContext)
    const { onPickMedia } = useContext(MediaPickerContext)
    const instanceEditRef = useRef({ definitions, formDesigns, onPickMedia })
    instanceEditRef.current = { definitions, formDesigns, onPickMedia }
    // Same reason: the touch listener below reads the live dnd-kit handlers.
    const listenersRef = useRef(draggable.listeners)
    listenersRef.current = draggable.listeners

    useEffect(() => {
      Besigner.refs.set(node.$id, ref)
      return () => {
        Besigner.refs.delete(node.$id)
      }
    }, [node?.$id])

    useEffect(() => {
      Besigner.handles.set(node.$id, {
        ...draggable.listeners,
        style: isTransforming ? { cursor: 'grab' } : { cursor: 'move' },
      })
      return () => {
        Besigner.handles.delete(node.$id)
      }
    }, [node.$id, draggable.listeners, isTransforming])

    useEffect(() => {
      const el = ref.current
      /**
       * Whether this element was already selected when the latest press on
       * it began. Read by the touch drag below, and reset by it, because the
       * press that selects an element must not also pick it up.
       */
      let selectedAtPress = false
      /** Where and when the finger on this element came down. */
      let pressStart: TapPoint | null = null
      /** The last quick, still tap on this element, waiting for its pair. */
      let lastTap: TapPoint | null = null
      /** When a double-tap opened an editor here, by event time. */
      let editOpenedByTapAt = -Infinity
      if (el) {
        el.addEventListener('mouseover', handleMouseOver)
        el.addEventListener('pointerover', handleMouseOver)
        el.addEventListener('mousedown', handleMouseDown)
        el.addEventListener('pointerdown', handleMouseDown)
        el.addEventListener('dblclick', handleDoubleClick)
        el.addEventListener('contextmenu', handleContextMenu)
        el.addEventListener('touchstart', handleTouchStart)
        el.addEventListener('touchend', handleTouchEnd)

        return () => {
          el.removeEventListener('mouseover', handleMouseOver)
          el.removeEventListener('pointerover', handleMouseOver)
          el.removeEventListener('mousedown', handleMouseDown)
          el.removeEventListener('pointerdown', handleMouseDown)
          el.removeEventListener('dblclick', handleDoubleClick)
          el.removeEventListener('contextmenu', handleContextMenu)
          el.removeEventListener('touchstart', handleTouchStart)
          el.removeEventListener('touchend', handleTouchEnd)
        }
      }
      /**
       * Press and hold a selected element to drag it on a touch screen.
       *
       * The element itself has never been a drag source: a mouse drags it by
       * the grip in its toolbar, and on a mouse that costs nothing, because a
       * press on the body selects it and the page stays put. A finger pressing
       * the body scrolls the page instead, which is what an author trying to
       * move the element saw. Handing the press to dnd-kit's TouchSensor
       * keeps a swipe a scroll — the sensor waits for a still hold before it
       * takes over — and makes a hold a drag.
       *
       * Native, like its neighbours: the canvas is a closed shadow root, so a
       * React `onTouchStart` would never fire. The sensor reads only
       * `nativeEvent`, and marks it, so an ancestor that is also selected
       * cannot claim the same touch.
       */
      function handleTouchStart(e: TouchEvent) {
        const touch = e.touches.length === 1 ? e.touches[0] : undefined
        pressStart = touch
          ? { x: touch.clientX, y: touch.clientY, at: e.timeStamp }
          : null
        const selected = selectedAtPress
        selectedAtPress = false
        if (!selected || isInlineEditWithin(el) || Besigner.pick.isPicking()) {
          return
        }
        listenersRef.current?.onTouchStart?.({ nativeEvent: e } as any)
      }
      /**
       * Double-tap a text element to edit it in place on a touch screen.
       *
       * A mouse gets there by `dblclick`, and on a touch screen that event is
       * the browser's to give. Chrome on Android turns two taps into one; on
       * a phone the in-place editor, and the B / I / U toolbar that comes
       * with it, did not open. So the two taps are counted here, by rules
       * that are this canvas's own rather than each browser's, and the same
       * open runs.
       *
       * Opening this way also puts the keyboard up (`holdKeyboardForEdit`),
       * which iOS only allows while the tap is still being handled — and the
       * `preventDefault` keeps Safari from zooming on the second tap, or
       * sending the `dblclick` Chrome would have sent after it.
       *
       * Two taps make a double-tap when each is quick and still, and the
       * second lands near the first soon after it. A hold is a drag, a slide
       * is a scroll, and neither counts.
       */
      function handleTouchEnd(e: TouchEvent) {
        const start = pressStart
        pressStart = null
        const touch = e.changedTouches[0]
        if (
          !start ||
          !touch ||
          e.touches.length > 0 ||
          // Inside an open edit, a double-tap selects a word.
          isInlineEditWithin(el) ||
          Besigner.pick.isPicking()
        ) {
          lastTap = null
          return
        }
        const tap = { x: touch.clientX, y: touch.clientY, at: e.timeStamp }
        if (
          distance(tap, start) > TAP_SLOP_PX ||
          tap.at - start.at > TAP_MAX_MS
        ) {
          lastTap = null
          return
        }
        const first = lastTap
        lastTap = tap
        if (
          !first ||
          tap.at - first.at > DOUBLE_TAP_WITHIN_MS ||
          distance(tap, first) > DOUBLE_TAP_SLOP_PX
        ) {
          return
        }
        lastTap = null
        if (!openEditAt({ clientX: tap.x, clientY: tap.y })) return
        e.preventDefault()
        e.stopPropagation()
        editOpenedByTapAt = e.timeStamp
        // A prop-fed image opens the media picker instead, which wants no
        // keyboard.
        if (inlineTextEdit.node || inlineMarkdownEdit.node) {
          holdKeyboardForEdit(tap)
        }
      }
      /**
       * Right-click opens this element's ⋮ menu (AGL-1405).
       *
       * A native listener like its neighbours, not an `onContextMenu` prop:
       * React delegates at the root container and the canvas is a closed
       * shadow root, so a delegated handler never sees the event.
       *
       * Selects first. The menu is rendered by the overlay, which only mounts
       * for a selected or hovered node — and right-clicking an element is a
       * statement about THAT element, so leaving the previous selection in
       * place would open the wrong menu.
       */
      function handleContextMenu(e: Event) {
        if (isInlineEditWithin(el)) {
          // An open text editor keeps the browser's own menu: cut, paste and
          // spellcheck are the whole point of a right-click there.
          e.stopPropagation()
          return
        }
        e.preventDefault()
        e.stopPropagation()
        // On a repeat copy, the menu is the element the copy draws, and the
        // selection is outlined on the copy (`repeatCopyStandIns`).
        const copy = repeatCopyAt(e.target)
        const target = copy?.original ?? node
        Besigner.focus.setSelectedNode(target)
        repeatCopyStandIns.set('selected', copy)
        requestCanvasContextMenu(target?.$id)
      }
      function handleMouseOver(e: Event) {
        // Same stand-down, same reason to consume it: a hover repaint while
        // the author is typing is a re-render of the subtree they are
        // editing, and an ancestor leaf would repaint for them instead.
        if (isInlineEditWithin(el)) {
          e.stopPropagation()
          return
        }
        e.preventDefault()
        e.stopPropagation()
        // On a repeat copy: the element it draws, outlined on the copy.
        const copy = repeatCopyAt(e.target)
        Besigner.focus.setHoveredNode(copy?.original ?? node)
        repeatCopyStandIns.set('hovered', copy)
      }
      function handleMouseDown(e: Event) {
        // Stand down while an edit is open in this leaf OR ANY LEAF INSIDE
        // IT (AGL-2486) — but CONSUME the event rather than ignoring it.
        //
        // Two different mistakes produced the same symptom, an editor that
        // was open, styled and completely uninteractive. First, asking only
        // "is this leaf the node being edited?": a nested run — a Span
        // typography inside a Typography — silenced its OWN leaf, the event
        // bubbled to the ancestor leaf, and the ancestor called the
        // `preventDefault` that suppresses caret placement. Second, standing
        // down by simply returning: that also skipped `stopPropagation`, so
        // the gesture carried on up to the viewport, which treats a
        // mousedown on empty canvas as a deselect — and moving the selection
        // off the node closes the editor. A drag meant to select three words
        // tore the editor down instead.
        //
        // So: no `preventDefault`, because that is the caret; but still
        // `stopPropagation`, because nothing else on this canvas should see
        // a gesture aimed at text being edited. `stopPropagation` does not
        // suppress a default action, only delivery.
        if (isInlineEditWithin(el)) {
          e.stopPropagation()
          return
        }
        if (e.type === 'pointerdown') {
          selectedAtPress = Besigner.focus.isNodeSelected(node)
        }
        e.preventDefault()
        e.stopPropagation()
        // A press on one of this element's repeat copies (Sam, Jordan) means
        // the element that copy draws, not this one around it — see
        // `repeatCopyAt`. Its selection is outlined on the copy pressed.
        const copy = repeatCopyAt(e.target)
        const original = copy?.original ?? null
        const target = original ?? node
        // Element-picker capture (AGL-574): while the interaction builder is
        // picking, this click resolves the target and exits pick mode —
        // never the normal select/navigate, so the designer's selection and
        // the open interaction stay put.
        if (Besigner.pick.isPicking()) {
          Besigner.pick.handlePickClick(target.$id)
          return
        }
        // Canvas multi-selection modifiers (AGL-12), mirroring the
        // hierarchy panel: Shift ranges, Cmd/Ctrl toggles.
        const pointer = e as globalThis.MouseEvent
        if (pointer.shiftKey) {
          Besigner.focus.rangeSelectNode(target)
        } else {
          Besigner.focus.handleNodeSelection(
            target,
            pointer.metaKey || pointer.ctrlKey,
          )
          if (!original && !pointer.metaKey && !pointer.ctrlKey) {
            pickPartUnder(pointer)
          }
        }
        repeatCopyStandIns.set('selected', copy)
      }
      /**
       * A plain click on a placement (a component instance or a placed form)
       * also says WHICH part of it was under the pointer (AGL-3288), so the
       * Styles and Attributes tabs aim "Which part?" at what the author just
       * clicked. The parts themselves stay unselectable — they are drawn
       * inert — so this is the only way a click can reach one.
       */
      function pickPartUnder(pointer: globalThis.MouseEvent) {
        if (!isDefinitionPlacement(node)) return
        const container = ref.current
        if (!container || typeof pointer.clientX !== 'number') return
        const { definitions, formDesigns } = instanceEditRef.current
        const definition = placementDefinitionFor(node, {
          definitions,
          formDesigns,
        })
        if (!definition) return
        const key = findPlacementPartAtPoint(
          container,
          pointer.clientX,
          pointer.clientY,
          node.$id,
          (graftedId) =>
            resolveInstanceLeafBinding(
              graftedId,
              node.$id,
              definition,
              'children',
              definition.rootId,
            ),
          definition.rootId,
        )
        pickPlacementPart(node.$id, key ?? '')
      }
      function handleDoubleClick(e: Event) {
        // The `dblclick` a browser may still send for two taps that already
        // opened an editor (see handleTouchEnd): consumed, not run twice.
        if (e.timeStamp - editOpenedByTapAt < DOUBLE_TAP_WITHIN_MS * 2) {
          e.preventDefault()
          e.stopPropagation()
          return
        }
        // Inside an open edit, a double-click selects a word, as the
        // double-tap does (see handleTouchEnd). The default is the word
        // selection, so it is left alone; only delivery stops, or an
        // instance would reopen its prop edit over the text being typed.
        if (isInlineEditWithin(el)) {
          e.stopPropagation()
          return
        }
        if (!openEditAt(e as globalThis.MouseEvent)) return
        e.preventDefault()
        e.stopPropagation()
      }
      /**
       * Opens this element's in-place editor for a double-click or a
       * double-tap at `point`, and says whether one opened — which is also
       * whether the gesture is spent here or goes on to an ancestor.
       */
      function openEditAt(point: ClientPoint): boolean {
        if (!el) return false
        // Prop-fed instance internals (AGL-1304): the rendered preview sits
        // under `pointer-events: none`, so the double-click lands HERE, on
        // the instance — hit-test the preview geometrically, map the grafted
        // leaf back to the definition, and if a declared prop feeds it, edit
        // that prop inline. Leaves the component owns stay locked (the
        // selection this dblclick's mousedowns already made puts AGL-1303's
        // "Edit component" in the panel — nothing extra to build).
        if (
          node?.componentId === REUSABLE_INSTANCE_COMPONENT_ID &&
          Besigner.dnd.canDragNode(node)
        ) {
          return handleInstanceDoubleClick(point)
        }
        // Locked nodes (layout chrome in the screen besigner) stay read-only —
        // same gate the drag system uses — and while the interaction builder
        // is picking a target, a double-click is two picks, never an edit.
        if (!Besigner.dnd.canDragNode(node) || Besigner.pick.isPicking()) {
          return false
        }
        // Inline text editing for components that declare textEditable.
        const flag = node?.componentSchema?.flags?.textEditable
        const editable =
          typeof flag === 'number' && (flag & FEATURE_FLAG.ENABLED) !== 0
        if (editable) {
          const root = el
          // The node's own `<aglyn-text>` whenever it renders one, and the
          // root only as a fallback (AGL-2556). In-place editing EMPTIES
          // whatever it is given, so handing it a composite's root deletes
          // the chrome that composite built — for Accordion Summary that is
          // the content div carrying MUI's `textAlign: 'start'`, without
          // which the UA stylesheet centres the label inside the `<button>`
          // for as long as the edit is open.
          const element = findLeafTextElement(root) ?? root
          const rect = element.getBoundingClientRect()
          inlineTextEdit.open(
            node,
            {
              left: rect.left,
              top: rect.top,
              width: rect.width,
              height: rect.height,
            },
            undefined,
            // The measured element travels with the rect so the overlay can
            // re-measure on scroll instead of drifting (AGL-1644).
            element,
          )
          return true
        }
        // In-place markdown editing (AGL-1624): a component whose schema
        // declares a MARKDOWN attribute — the Markdown element's `content` is
        // the one that exists — opens the WYSIWYG over the element, editing
        // the whole document without a trip to the attributes panel.
        //
        // `stopPropagation` on the NATIVE event is what keeps the canvas still:
        // React delegates `onDoubleClick` at the root container, so an event
        // consumed here never reaches `ZoomablePanningComponent`'s
        // double-click-to-zoom. That is the same guarantee the textEditable
        // branch above has always relied on, not a new mechanism.
        const markdownAttribute = findMarkdownAttributeName(node)
        if (!markdownAttribute) return false
        const markdownElement = el
        const markdownRect = markdownElement.getBoundingClientRect()
        const stored = (node.props as Record<string, unknown> | undefined)?.[
          markdownAttribute
        ]
        // The two mousedowns of a double-click TOGGLE selection, so by the time
        // this fires the node has been selected and then deselected again.
        // Editing an element is selecting it — the attributes panel should be
        // showing it — and the editor closes when the selection moves off the
        // node, so it has to be put back before the editor opens.
        Besigner.focus.setSelectedNode(node)
        inlineMarkdownEdit.open(
          node,
          {
            left: markdownRect.left,
            top: markdownRect.top,
            width: markdownRect.width,
            height: markdownRect.height,
          },
          markdownAttribute,
          typeof stored === 'string' ? stored : '',
          markdownElement,
        )
        return true
      }
      /** True when the double-click resolved to a prop edit it opened. */
      function handleInstanceDoubleClick(pointer: ClientPoint) {
        const { definitions, onPickMedia } = instanceEditRef.current
        const refId = (node?.props as { refId?: string } | undefined)?.refId
        const definition = refId ? definitions?.[refId] : undefined
        const container = ref.current
        if (!definition || !container) return false
        const hit = findInstanceLeafAtPoint(
          container,
          pointer.clientX,
          pointer.clientY,
        )
        if (!hit) return false
        // Text first: a leaf whose `children` a declared prop feeds opens
        // the EXISTING inline editor, anchored on the clicked leaf, and the
        // commit writes propValues[prop] on the instance (one undo entry,
        // mirrored to peers like any node edit).
        const text = resolveInstanceLeafBinding(
          hit.graftedId,
          node.$id,
          definition,
        )
        if (text?.boundProp) {
          const rect = hit.element.getBoundingClientRect()
          const propName = text.boundProp
          // The schema of the element the prop fills decides the toolbar, as
          // a node's own schema does. Formatting is offered only when EVERY
          // element the prop fills draws markup: the graft hands the markup
          // to each of them, and one that ignores it would show bold that
          // never renders.
          const schemaOf = (id: string) =>
            components.getSchema(
              (definition.nodes as Record<string, { componentId?: string }>)[
                id
              ]?.componentId as Aglyn.ComponentId,
            )
          const rich = listPropFedTextNodeIds(definition.nodes, propName).every(
            (id) =>
              ((schemaOf(id)?.flags?.richTextEditable ??
                FEATURE_FLAG.DISABLED) &
                FEATURE_FLAG.ENABLED) !==
              0,
          )
          inlineTextEdit.open(
            node,
            {
              left: rect.left,
              top: rect.top,
              width: rect.width,
              height: rect.height,
            },
            {
              propName,
              initialText: getInstanceEffectivePropText(
                node.props,
                definition.props,
                propName,
              ),
              schema: schemaOf(text.componentInternalId),
              rich,
              initialHtml: rich
                ? getInstanceEffectivePropHtml(
                    node.props,
                    definition.props,
                    propName,
                  )
                : '',
            },
            // The GRAFTED leaf, not the instance node: it is what was measured,
            // and it is the one anchor `Besigner.refs` could never supply
            // because it is not a canvas node (AGL-1644).
            hit.element,
          )
          return true
        }
        // Image half: `src` fed by a declared prop opens the host's media
        // picker, committing the picked value to the same propValues slot —
        // the exact pipeline the Attributes panel's Browse button uses.
        const src = resolveInstanceLeafBinding(
          hit.graftedId,
          node.$id,
          definition,
          'src',
        )
        if (src?.boundProp && onPickMedia) {
          const propName = src.boundProp
          // The SAME leaf's `alt`, if the component author bound one to a
          // declared prop too (AGL-1896). Resolvable here and nowhere else
          // in the instance pipeline: this path starts from a concrete leaf
          // in the definition tree, so "which declared prop feeds this
          // image's alt" is a lookup rather than a guess. The attributes
          // panel only ever sees a declared prop's NAME, and no convention
          // says which other prop is its alt — so it does not try.
          const altBinding = resolveInstanceLeafBinding(
            hit.graftedId,
            node.$id,
            definition,
            'alt',
          )
          onPickMedia((value, asset) => {
            // Written through verbatim (media reference or raw URL — the
            // host app decides; AGL-1215). Snapshot via toJSON like the
            // panel: updateNodeProps REPLACES the props object.
            const current = (canvas.toJSON().nodes as Record<string, any>)[
              node.$id
            ]
            // What the instance renders for the alt prop TODAY — its own
            // override, else the component's default. Not the raw override:
            // a component whose default alt is already a real sentence must
            // not have it replaced just because this instance never set one.
            const altPropName = altBinding?.boundProp
            const effectiveAlt = altPropName
              ? getInstanceEffectivePropText(
                  current?.props,
                  definition.props,
                  altPropName,
                )
              : undefined
            const inheritedAlt = altPropName
              ? inheritedMediaAlt({
                  placementAlt: effectiveAlt,
                  assetAlt: asset?.alt,
                })
              : undefined
            canvas.updateNodeProps(node, {
              ...current?.props,
              [REUSABLE_INSTANCE_PROP_VALUES_KEY]: {
                ...current?.props?.[REUSABLE_INSTANCE_PROP_VALUES_KEY],
                [propName]: value,
                ...(inheritedAlt && altPropName
                  ? { [altPropName]: inheritedAlt }
                  : {}),
              },
            })
          })
          return true
        }
        return false
      }
    }, [node, element])

    return cloneElement(
      child,
      mergeProps(child.props, draggable.attributes, {
        ref: mergeRefs(
          ref,
          trackElement,
          child.props.ref,
          draggable.setNodeRef,
          droppable.setNodeRef,
        ),
        style,
        sx: {
          '&, &:hover, &:focus': {
            cursor: draggable.isDragging ? 'move' : 'initial',
          },
        },
      }),
    )
  },
)

DraggableDroppable.displayName = 'DraggableDroppable'

export default DraggableDroppable
