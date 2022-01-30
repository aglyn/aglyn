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

import {canvasRedo, canvasUndo, getCanvasStore} from '@aglyn/core-data-framework'
import {useAglynAppContext} from '@aglyn/core-feature-renderer'
import {useStoreMap} from 'effector-react'
import {useCallback} from 'react'


export type UseAglynCanvasHistory = [
  undo: () => void,
  redo: () => void,
  canUndoTimes: number | false,
  canRedoTimes: number | false,
]

export function useAglynCanvasHistoryControls(): UseAglynCanvasHistory {
  const {getApp} = useAglynAppContext()
  const handleUndo = useCallback(() => canvasUndo(getApp(), {}), [getApp])
  const handleRedo = useCallback(() => canvasRedo(getApp(), {}), [getApp])
  const store = getCanvasStore(getApp())
  const [canUndo, canRedo]: [number | false, number | false] = useStoreMap({
    store,
    keys: [],
    fn: (state) => [
      state.past.length > 0 ? state.past.length : false,
      state.future.length > 0 ? state.future.length : false,
    ],
  })
  return [handleUndo, handleRedo, canUndo, canRedo]
}
export default useAglynCanvasHistoryControls
