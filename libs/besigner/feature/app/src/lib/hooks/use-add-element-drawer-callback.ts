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

import { addCanvasElement } from '@aglyn/core-data-app'
import {
  CANVAS_ROOT_ELEMENT_ID,
  type NodeId,
} from '@aglyn/core-data-foundation'
import { useAglynAppContext } from '@aglyn/core-feature-renderer'
import { createComponentElementData } from '@aglyn/core-util-app'
import { useCallback } from 'react'
import {
  type ElementDrawerOptions,
  useElementDrawerContext,
} from '../contexts/element-drawer-context'
import useAglynCanvasSelected from './use-aglyn-canvas-selected'

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
  const [selected, setSelected] = useAglynCanvasSelected()
  const { $id } = selected || {}
  const app = useAglynAppContext()

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
          const newElement = {
            index: NaN,
            parentId: callback?.$id || $id || CANVAS_ROOT_ELEMENT_ID,
            element: createComponentElementData({ data }),
          }
          console.log('Add New Element ', data, newElement)
          addCanvasElement(app, newElement)
          setSelected({ $id: newElement.element.$id })

          options?.onComplete?.(data)
          callback?.onComplete?.(data)
        })
        .catch((reason) => {
          options?.onError?.(reason)
          callback?.onError?.(reason)
        })
    },
    [elementDrawer, options, $id, app, setSelected],
  )
}

export default useAddElementDrawerCallback
