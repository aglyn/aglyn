/**
 * @license
 * Copyright 2022 Aglyn LLC
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
import { useDraggable } from '@dnd-kit/core'

export type NodeDragItem = {
  node?: Aglyn.NodeSchema<any>
}

export function useLeafDrag(
  node: NodeDragItem['node'],
  type: Besigner.DragType,
): ReturnType<typeof useDraggable> {
  return useDraggable({
    id: `${type}:${node?.$id}`,
    data: {
      type,
      node,
    },
  })
}
export default useLeafDrag
