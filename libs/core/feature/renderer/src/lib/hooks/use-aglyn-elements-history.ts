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

import { getCanvasApiEvents, getCanvasStore } from '@aglyn/core-data-framework'
import { useStoreMap } from 'effector-react'
import { useMemo } from 'react'
import { useAglynAppContext } from '../contexts/aglyn-app-context'

export function useAglynElementHistory() {
  const { getApp } = useAglynAppContext()
  const app = getApp()
  const store = getCanvasStore(app)
  const { undo, redo } = getCanvasApiEvents(app)
  const { past, future } = useStoreMap(store, (state) => {
    return { past: state.past.length, future: state.future.length }
  })
  return useMemo(
    () => ({
      undo,
      redo,
      past,
      future,
    }),
    [undo, redo, past, future]
  )
}
export default useAglynElementHistory
