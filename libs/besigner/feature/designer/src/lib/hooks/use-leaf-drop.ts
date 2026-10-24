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
import * as Besigner from '@aglyn/besigner'
import { useDroppable } from '@dnd-kit/core'

export type NodeDropArea = {
  node?: Aglyn.NodeSchema<any>
}

const acceptAll = Object.values(Besigner.DragType)

export function useLeafDrop(
  node: Aglyn.NodeSchema<any>,
  accept: Besigner.DragType[] = acceptAll,
  /**
   * Distinct surface rendering this droppable (tree, breadcrumbs, ...).
   * Multiple surfaces register droppables for the same node simultaneously;
   * without a discriminator their dnd-kit ids collide and the later mount
   * evicts the earlier one from the registry, leaving dead drop targets.
   *
   * It is also the surface the drop marker reads (`DropSurface`): a hierarchy
   * row is a vertical list item wherever it sits, a breadcrumb a horizontal
   * one.
   */
  area = 'leaf',
  /** Anything else the drop marker needs from this target. */
  extra?: Record<string, unknown>,
): ReturnType<typeof useDroppable> {
  // Disable the droppable for the node that is currently being dragged.
  // Without a DragOverlay the draggable element receives the CSS transform
  // and moves with the cursor, which shifts its droppable rect to the cursor
  // position. This causes it to win every pointerWithin collision check and
  // prevents leaf nodes (like an empty Container) from ever being detected as
  // the drop target.
  const isBeingDragged = Besigner.dnd.isDraggingNode(node)

  return useDroppable({
    id: `drop:${area}:${node?.$id}:${accept}`,
    disabled: isBeingDragged,
    data: {
      accept,
      node,
      surface: area,
      ...extra,
    },
  })
}
export default useLeafDrop
