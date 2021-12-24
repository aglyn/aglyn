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


import {type ElementId, getBesignerStore} from '@aglyn/core-data-framework'
import {useAglynAppContext} from '@aglyn/core-feature-renderer'
import {useStoreMap} from 'effector-react'


export const useAglynDndElementStatus = ($id: ElementId) => {
  const {getApp} = useAglynAppContext()
  const app = getApp()
  const dndStore = getBesignerStore(app, {store: 'dnd'})
  return useStoreMap({
    store: dndStore,
    keys: [$id],
    fn: (store, [$id]) => {
      return {
        isActive: $id && store.active?.data?.current?.$id === $id,
        isOver: $id && store.over?.data?.current?.$id === $id,
      }
    },
  })
}

export default useAglynDndElementStatus
