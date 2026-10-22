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

import type * as Aglyn from '@aglyn/aglyn'
import { canvas } from '@aglyn/aglyn'
import { REPEAT_NODE_ID_PREFIX } from '@aglyn/aglyn/app-utils/expand-repeatables'

const LEAF_STAMP = '[data-aglyn^="leaf:"]'

/** `rep__<repeating id>__<record>__<original id>`, as the expansion names a copy. */
const REPEAT_COPY_ID = new RegExp(`^${REPEAT_NODE_ID_PREFIX}.+?__\\d+__(.+)$`)

/** The attribute the canvas puts on each repeat copy's root, for its outline. */
export const REPEAT_COPY_ATTR = 'data-aglyn-repeat-copy'

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
 * The real element a repeat copy under the pointer is a picture of, or null
 * when the pointer is not on a copy.
 *
 * The copies (Sam, Jordan beside the real Avery) are inert drawings: nothing
 * in them is a document, so none of them can be selected. A click on one
 * still means something — the element it draws, the one an author edits to
 * change every copy at once — and the repeating element's own handlers,
 * which the copies are drawn inside, send it there.
 */
export function repeatOriginalAt(
  target: EventTarget | null,
): Aglyn.NodeSchema<any> | null {
  const leaf = target instanceof Element ? target.closest(LEAF_STAMP) : null
  const id = leaf?.getAttribute('data-aglyn')?.slice('leaf:'.length)
  if (!id?.startsWith(REPEAT_NODE_ID_PREFIX)) return null
  return canvas.getNode(repeatTemplateIdOf(id)) ?? null
}

/**
 * Every drawn copy of the node `id` in the canvas `element` lives in: the
 * copies a repeat draws of it, at any depth — a Typography inside a repeated
 * card has a copy inside each copy of the card.
 *
 * Read off the rendered stamps (`leaf:rep__…__<id>`), because the copies are
 * pictures, not canvas nodes: the refs registry has no entry for them.
 */
export function repeatCopyElementsOf(element: Element, id: string): Element[] {
  const root = element.getRootNode() as ParentNode | null
  if (!root?.querySelectorAll || !id) return []
  const escaped = typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(id) : id
  return Array.from(
    root.querySelectorAll(
      `[data-aglyn^="leaf:${REPEAT_NODE_ID_PREFIX}"][data-aglyn$="__${escaped}"]`,
    ),
  ).filter(
    (copy) =>
      repeatTemplateIdOf(
        copy.getAttribute('data-aglyn')?.slice('leaf:'.length) ?? '',
      ) === id,
  )
}
