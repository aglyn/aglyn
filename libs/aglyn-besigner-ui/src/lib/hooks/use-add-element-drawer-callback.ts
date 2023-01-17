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
import { type NodeId } from '@aglyn/core-data-foundation'
import { useCallback } from 'react'
import {
  type ElementDrawerOptions,
  useElementDrawerContext,
} from '../contexts/element-drawer-context'

export interface UseAddElementCallbackOptions {
  onComplete?: (data: unknown) => void
  onError?: (error: unknown) => void
  drawerOptions?: ElementDrawerOptions
  $id?: NodeId
}

type Response = (
  parent?: Aglyn.NodeSchema<any>,
  options?: ElementDrawerOptions,
) => Promise<void | Aglyn.NodeSchema<any>>

export function useAddElementDrawerCallback(): Response {
  const { elementDrawer } = useElementDrawerContext()

  return useCallback(
    async (parent?: Aglyn.NodeSchema<any>, options?: ElementDrawerOptions) => {
      const drawerOptions = { title: 'Add New Element', ...options }
      return await elementDrawer(drawerOptions)
        .then((res: { option: Aglyn.PresetSchema<any> }) => {
          if (!res?.option) throw new TypeError('invalid response')
          return res.option
        })
        .then((preset) => {
          const parentNode = parent || Aglyn.canvas.getNode(Aglyn.NODE_ROOT_ID)
          const node = Aglyn.canvas.addNodeFromPreset(preset, parentNode, NaN)

          // const templateData = {
          //   ...(data as any),
          //   $id: Aglyn.createNodeId(),
          //   parentId: parent?.$id,
          // }
          // Aglyn.canvas.setNodes(
          //   Aglyn.canvas.denormalizeNodes([templateData as any], parent?.$id),
          // )
          //
          // const node = Aglyn.canvas.getNode(templateData.$id)
          console.log('Add New Element ', node)

          Besigner.focus.setSelectedNode(node)

          return node
        })
        .catch(console.error)
    },
    [elementDrawer],
  )
}

export default useAddElementDrawerCallback
