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

import { canvas } from '@aglyn/aglyn'
import { REPEAT_NODE_ID_PREFIX } from '@aglyn/aglyn/app-utils/expand-repeatables'
import * as Besigner from '@aglyn/besigner'
import { useEffect } from 'react'
import { requestCanvasContextMenu } from '../utils/canvas-context-menu'

const LEAF_STAMP = '[data-aglyn^="leaf:"]'

/** `rep__<repeating id>__<record>__<original id>`, as the expansion names a copy. */
const REPEAT_COPY_ID = new RegExp(`^${REPEAT_NODE_ID_PREFIX}.+?__\\d+__(.+)$`)

/**
 * The id of the node a repeat copy draws: the copy's id with every repeat
 * prefix taken off, so a copy inside a copy names the original too. An id
 * that is not a copy comes back as it is.
 */
export function repeatTemplateIdOf(id: string): string {
  let current = id
  for (let match = REPEAT_COPY_ID.exec(current); match; ) {
    current = match[1]
    match = REPEAT_COPY_ID.exec(current)
  }
  return current
}

/**
 * Points the pointer at a repeat copy back at the element the copy is a
 * picture of.
 *
 * The copies (Sam, Jordan beside the real Avery) are inert drawings: nothing
 * in them is a document, so none of them can be selected. A click on one
 * still means something — the element it draws, which is the one the author
 * edits to change every copy at once. So a press selects that element, the
 * pointer resting on a copy hovers it, and a right-click opens its menu. A
 * press on bare space between copies is left alone, and lands on the
 * repeating element the copies are drawn inside.
 *
 * Native listeners, like every other on the canvas: React never sees an
 * event from inside its closed shadow root.
 */
export function useRepeatCopyPointer(box: HTMLElement | null) {
  useEffect(() => {
    if (!box) return
    const originalAt = (target: EventTarget | null) => {
      const leaf =
        target instanceof Element ? target.closest(LEAF_STAMP) : null
      if (!leaf || !box.contains(leaf)) return null
      const copyId = leaf.getAttribute('data-aglyn')?.slice('leaf:'.length)
      return copyId ? (canvas.getNode(repeatTemplateIdOf(copyId)) ?? null) : null
    }
    const press = (event: Event) => {
      const node = originalAt(event.target)
      if (!node) return
      event.preventDefault()
      event.stopPropagation()
      if (Besigner.pick.isPicking()) {
        Besigner.pick.handlePickClick(node.$id)
        return
      }
      const pointer = event as MouseEvent
      if (pointer.shiftKey) {
        Besigner.focus.rangeSelectNode(node)
      } else {
        Besigner.focus.handleNodeSelection(
          node,
          pointer.metaKey || pointer.ctrlKey,
        )
      }
    }
    const hover = (event: Event) => {
      const node = originalAt(event.target)
      if (!node) return
      event.stopPropagation()
      Besigner.focus.setHoveredNode(node)
    }
    const menu = (event: Event) => {
      const node = originalAt(event.target)
      if (!node) return
      event.preventDefault()
      event.stopPropagation()
      Besigner.focus.setSelectedNode(node)
      requestCanvasContextMenu(node.$id)
    }
    box.addEventListener('pointerdown', press)
    box.addEventListener('mousedown', press)
    box.addEventListener('pointerover', hover)
    box.addEventListener('mouseover', hover)
    box.addEventListener('contextmenu', menu)
    return () => {
      box.removeEventListener('pointerdown', press)
      box.removeEventListener('mousedown', press)
      box.removeEventListener('pointerover', hover)
      box.removeEventListener('mouseover', hover)
      box.removeEventListener('contextmenu', menu)
    }
  }, [box])
}

export default useRepeatCopyPointer
