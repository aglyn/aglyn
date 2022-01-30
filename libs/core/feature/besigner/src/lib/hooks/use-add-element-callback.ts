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

import {
  addCanvasElement,
  CANVAS_ROOT_ELEMENT_ID,
  createComponentElementData,
} from '@aglyn/core-data-framework'
import {useAglynAppContext} from '@aglyn/core-feature-renderer'
import {type SyntheticEvent, useCallback} from 'react'
import {
  type ElementDrawerOptions,
  useElementDrawerContext,
} from '../contexts/element-drawer-context'
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
  options?: UseAddElementCallbackOptions,
): AddElementCallback<E> {
  const {onComplete, onError, drawerOptions} = {...options}
  const {elementDrawer} = useElementDrawerContext()
  const {$id} = useAglynCanvasSelected() || {}
  const {getApp} = useAglynAppContext()

  return useCallback((e, opts) => {
    elementDrawer({title: 'Add New Element', ...drawerOptions, ...opts?.drawerOptions})
      .then((res: any) => {
        const data = res?.option?.data
        if (data) {
          const newElement = {
            index: -1,
            parentId: $id || CANVAS_ROOT_ELEMENT_ID,
            element: createComponentElementData(data),
          }
          console.log('addElement', newElement)
          addCanvasElement(getApp(), newElement)
        }
        else {
          console.warn('Invalid data returned for addElement callback', data)
        }
        onComplete && onComplete(e, res)
        opts?.onComplete && opts?.onComplete(e, res)
      })

      .catch((error) => {
        console.error(error)
        onError && onError(e, error)
        opts?.onError && opts?.onError(e, error)
      })
  }, [$id, getApp, elementDrawer, drawerOptions, onComplete, onError])
}

export default useAddElementCallback
