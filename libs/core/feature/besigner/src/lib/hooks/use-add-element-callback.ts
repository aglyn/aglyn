/**
 * @license
 * Copyright 2021 Aglyn LLC
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

import { CANVAS_ROOT_ELEMENT_ID, createComponentElementData } from '@aglyn/core-data-framework'
import {
  useAglynCanvasApiEvents,
  useAglynElementParentPosition,
} from '@aglyn/core-feature-renderer'
import { SyntheticEvent, useCallback } from 'react'
import { ElementDrawerOptions, useElementDrawerContext } from '../contexts/element-drawer-context'
import useAglynBesignerStoreState from './use-aglyn-besigner-store-state'
import useAglynCanvasSelected from './use-aglyn-canvas-selected'

export interface UseAddElementCallbackOptions<E extends SyntheticEvent<any> = SyntheticEvent<any>> {
  onComplete?: (event: E | null, response: unknown) => void
  onError?: (event: E | null, error: unknown) => void
  drawerOptions?: ElementDrawerOptions
}

export type AddElementCallback<E extends SyntheticEvent<any> = SyntheticEvent<any>> = {
  bivarianceHack(event: E | null, options?: UseAddElementCallbackOptions): void
}['bivarianceHack']

export function useAddElementCallback<E extends SyntheticEvent<any>>(
  options?: UseAddElementCallbackOptions
): AddElementCallback<E> {
  const { onComplete, onError, drawerOptions } = { ...options }
  const { elementDrawer } = useElementDrawerContext()
  const { addElement } = useAglynCanvasApiEvents()
  const { $id } = useAglynBesignerStoreState('canvas', 'selected') || {}
  const { parentId, index, parentElements } = useAglynElementParentPosition($id) || {}
  const siblingCount = parentElements.length

  return useCallback(
    (e, options) => {
      elementDrawer({
        title: 'Add New Element',
        ...drawerOptions,
        ...options?.drawerOptions,
      })
        .then((res: any) => {
          const data = res?.option?.data
          if (data) {
            const newElement = {
              index: index === -1 ? siblingCount : index + 1,
              parentId: parentId || CANVAS_ROOT_ELEMENT_ID,
              element: createComponentElementData(data),
            }
            console.log('addElement', newElement)
            addElement(newElement)
          } else {
            console.warn('Invalid data returned for addElement callback', data)
          }
          onComplete && onComplete(e, res)
          options?.onComplete && options?.onComplete(e, res)
        })

        .catch((error) => {
          console.error(error)
          onError && onError(e, error)
          options?.onError && options?.onError(e, error)
        })
    },
    [elementDrawer, addElement, siblingCount, parentId, index, onComplete, onError, drawerOptions]
  )
}

export default useAddElementCallback
