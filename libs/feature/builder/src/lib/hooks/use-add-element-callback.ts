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

import { createComponentElementData } from '@aglyn/core-data-framework'
import {
  useAglynBuilderStore,
  useAglynCanvasApiEvents,
  useAglynComponentSchema,
  useAglynElementData,
  useAglynElementParentPosition,
} from '@aglyn/feature-renderer'
import { useCallback } from 'react'
import { ElementDrawerOptions, useElementDrawerContext } from '../contexts/element-drawer-context'


export interface UseAddElementCallbackOptions {
  onComplete?: (response: unknown) => void
  onError?: (error: unknown) => void
  drawerOptions?: ElementDrawerOptions
}

export type AddElementCallback = () => void

export function useAddElementCallback(options?: UseAddElementCallbackOptions): AddElementCallback {
  const {onComplete, onError, drawerOptions} = {...options}
  const {elementDrawer} = useElementDrawerContext()
  const {addElement, updateElement} = useAglynCanvasApiEvents()
  const {$id: selectedId} = useAglynBuilderStore('canvas', 'selected') || {}
  const {
    parentId: selectedParentId,
    index: selectedIndex,
    parentElements: selectedParentElements,
  } = useAglynElementParentPosition(selectedId) || {}
  const parentElementsLength = selectedParentElements.length
  const {props, componentId, bundleId} = useAglynElementData(selectedId) || {}
  const {renderFlags} = useAglynComponentSchema(componentId, bundleId) || {}
  const edit = drawerOptions?.type === 'edit-element-traits'

  console.log('==============')
  console.log('selectedId', selectedId)
  console.log('props', props)
  console.log('componentId', componentId)
  console.log('renderFlags', renderFlags)

  return useCallback(async () => {
    const option = await elementDrawer({
      title: 'Add New Element',
      ...(edit ? {
        propsSchema: {...renderFlags?.propsSchema},
        selectedElementProps: {...props},
      } : {}),
      ...drawerOptions,
    })
    .then((res: any) => {
      const data = res?.option?.data
      if (data) {
        const pos = (selectedIndex === -1 ? parentElementsLength : selectedIndex + 1)
        console.log('then newElement', selectedIndex, pos, data)


        if (edit) {
          updateElement({element: {$id: selectedId, props: {...data}}})
        }
        else {
          addElement({
            position: pos,
            parentId: selectedParentId || '__root__',
            element: createComponentElementData(data),
          })
        }

      }
      onComplete && onComplete(res)
    })
    .catch((error) => {
      console.error(error)
      onError && onError(error)
    })

    console.warn('async choice', option)
  }, [drawerOptions, props, renderFlags, selectedId, elementDrawer, addElement, parentElementsLength, selectedParentId, selectedIndex])
}

export default useAddElementCallback
