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

export type AddElementCallback = {
  bivarianceHack(e, options?: UseAddElementCallbackOptions): Promise<void>
}['bivarianceHack']

export function useAddElementDrawerCallback(
  options?: UseAddElementCallbackOptions,
): AddElementCallback {
  const { elementDrawer } = useElementDrawerContext()

  return useCallback(
    async (e, callback) => {
      await elementDrawer({
        title: 'Add New Element',
        ...options?.drawerOptions,
        ...callback?.drawerOptions,
      })
        .then((res: any) => {
          const data = res?.option?.data
          if (!data) throw new TypeError('invalid response')
          return data
        })
        .then((data: any) => {
          const $id =
            callback?.$id ||
            Besigner.focus.state.lastSelected?.$id ||
            Aglyn.NODE_ROOT_ID
          const parent =
            Aglyn.screen.getNode($id) ||
            Aglyn.screen.getNode(Aglyn.NODE_ROOT_ID)
          const templateData = {
            ...(data as any),
            $id: Aglyn.createNodeId(),
            parentId: parent?.$id,
          }
          Aglyn.screen.setNodes(
            Aglyn.screen.denormalizeNodes([templateData as any], parent?.$id),
          )

          const node = Aglyn.screen.getNode(templateData.$id)
          console.log('Add New Element ', data, templateData)

          Aglyn.screen.addNodeToParent(node, parent, NaN)
          Besigner.focus.setSelectedNode(node)

          options?.onComplete?.(data)
          callback?.onComplete?.(data)
        })
        .catch((reason) => {
          options?.onError?.(reason)
          callback?.onError?.(reason)
        })
    },
    [elementDrawer, options],
  )
}

export default useAddElementDrawerCallback
