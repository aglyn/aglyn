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
  useContext,
  useEffect,
  useRef,
} from 'react'
import ComponentPromotionContext from '../../contexts/component-promotion-context'
import { MediaPickerContext } from '../../contexts/media-picker-context'
import {
  findMarkdownAttributeName,
  inlineMarkdownEdit,
} from '../../utils/inline-markdown-edit.store'
import { inlineTextEdit } from '../../utils/inline-text-edit.store'
import { findInstanceLeafAtPoint } from '../../utils/instance-leaf-hit'

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

    const draggable = useDraggable({
      id: `${id}:${type}${idSuffix || ''}`,
      data: { type, node },
      disabled: disableDragging,
    })

    const droppable = useDroppable({
      id: `${id}:${type}${idSuffix || ''}`,
      data: { type, node, accept },
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

    const ref = useRef<HTMLElement>(null)

    // Instance-internals double-click (AGL-1304) needs the component
    // definitions (hit-test) and the host's media picker (image props).
    // Read through a ref so the listener effect below keeps its `[node]`
    // dependency — context updates must not re-register DOM listeners.
    const { definitions } = useContext(ComponentPromotionContext)
    const { onPickMedia } = useContext(MediaPickerContext)
    const instanceEditRef = useRef({ definitions, onPickMedia })
    instanceEditRef.current = { definitions, onPickMedia }

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
      if (el) {
        el.addEventListener('mouseover', handleMouseOver)
        el.addEventListener('pointerover', handleMouseOver)
        el.addEventListener('mousedown', handleMouseDown)
        el.addEventListener('pointerdown', handleMouseDown)
        el.addEventListener('dblclick', handleDoubleClick)

        return () => {
          el.removeEventListener('mouseover', handleMouseOver)
          el.removeEventListener('pointerover', handleMouseOver)
          el.removeEventListener('mousedown', handleMouseDown)
          el.removeEventListener('pointerdown', handleMouseDown)
          el.removeEventListener('dblclick', handleDoubleClick)
        }
      }
      function handleMouseOver(e: Event) {
        e.preventDefault()
        e.stopPropagation()
        Besigner.focus.setHoveredNode(node)
      }
      function handleMouseDown(e: Event) {
        e.preventDefault()
        e.stopPropagation()
        // Element-picker capture (AGL-574): while the interaction builder is
        // picking, this click resolves the target and exits pick mode —
        // never the normal select/navigate, so the designer's selection and
        // the open interaction stay put.
        if (Besigner.pick.isPicking()) {
          Besigner.pick.handlePickClick(node.$id)
          return
        }
        // Canvas multi-selection modifiers (AGL-12), mirroring the
        // hierarchy panel: Shift ranges, Cmd/Ctrl toggles.
        const pointer = e as globalThis.MouseEvent
        if (pointer.shiftKey) {
          Besigner.focus.rangeSelectNode(node)
        } else {
          Besigner.focus.handleNodeSelection(
            node,
            pointer.metaKey || pointer.ctrlKey,
          )
        }
      }
      function handleDoubleClick(e: Event) {
        // Prop-fed instance internals (AGL-1304): the rendered preview sits
        // under `pointer-events: none`, so the double-click lands HERE, on
        // the instance — hit-test the preview geometrically, map the grafted
        // leaf back to the definition, and if a declared prop feeds it, edit
        // that prop inline. Leaves the component owns stay locked (the
        // selection this dblclick's mousedowns already made puts AGL-1303's
        // "Edit component" in the panel — nothing extra to build).
        if (
          node?.componentId === Aglyn.REUSABLE_INSTANCE_COMPONENT_ID &&
          Besigner.dnd.canDragNode(node)
        ) {
          if (handleInstanceDoubleClick(e as globalThis.MouseEvent)) {
            e.preventDefault()
            e.stopPropagation()
          }
          return
        }
        // Locked nodes (layout chrome in the screen besigner) stay read-only —
        // same gate the drag system uses — and while the interaction builder
        // is picking a target, a double-click is two picks, never an edit.
        if (!Besigner.dnd.canDragNode(node) || Besigner.pick.isPicking()) return
        // Inline text editing for components that declare textEditable.
        const flag = node?.componentSchema?.flags?.textEditable
        const editable =
          typeof flag === 'number' && (flag & Aglyn.FEATURE_FLAG.ENABLED) !== 0
        if (editable) {
          e.preventDefault()
          e.stopPropagation()
          const rect = (e.currentTarget as Element).getBoundingClientRect()
          inlineTextEdit.open(node, {
            left: rect.left,
            top: rect.top,
            width: rect.width,
            height: rect.height,
          })
          return
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
        if (!markdownAttribute) return
        e.preventDefault()
        e.stopPropagation()
        const markdownRect = (e.currentTarget as Element).getBoundingClientRect()
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
        )
      }
      /** True when the double-click resolved to a prop edit it opened. */
      function handleInstanceDoubleClick(pointer: globalThis.MouseEvent) {
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
        const text = Aglyn.resolveInstanceLeafBinding(
          hit.graftedId,
          node.$id,
          definition,
        )
        if (text?.boundProp) {
          const rect = hit.element.getBoundingClientRect()
          inlineTextEdit.open(
            node,
            {
              left: rect.left,
              top: rect.top,
              width: rect.width,
              height: rect.height,
            },
            {
              propName: text.boundProp,
              initialText: Aglyn.getInstanceEffectivePropText(
                node.props,
                definition.props,
                text.boundProp,
              ),
            },
          )
          return true
        }
        // Image half: `src` fed by a declared prop opens the host's media
        // picker, committing the picked value to the same propValues slot —
        // the exact pipeline the Attributes panel's Browse button uses.
        const src = Aglyn.resolveInstanceLeafBinding(
          hit.graftedId,
          node.$id,
          definition,
          'src',
        )
        if (src?.boundProp && onPickMedia) {
          const propName = src.boundProp
          onPickMedia((value) => {
            // Written through verbatim (media reference or raw URL — the
            // host app decides; AGL-1215). Snapshot via toJSON like the
            // panel: updateNodeProps REPLACES the props object.
            const current = (
              Aglyn.canvas.toJSON().nodes as Record<string, any>
            )[node.$id]
            Aglyn.canvas.updateNodeProps(node, {
              ...current?.props,
              [Aglyn.REUSABLE_INSTANCE_PROP_VALUES_KEY]: {
                ...current?.props?.[Aglyn.REUSABLE_INSTANCE_PROP_VALUES_KEY],
                [propName]: value,
              },
            })
          })
          return true
        }
        return false
      }
    }, [node])

    return cloneElement(
      child,
      mergeProps(child.props, draggable.attributes, {
        ref: mergeRefs(
          ref,
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
