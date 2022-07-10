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

import { canvasRedo, canvasUndo } from '@aglyn/core-data-app'
import { useSubscribable } from '@aglyn/shared-ui-jsx'
import { useMemo } from 'react'
import useBesignerAppContext from './use-besigner-app-context'

export type UseAglynCanvasHistory = [
  undo: () => void,
  redo: () => void,
  canUndoTimes: number | false,
  canRedoTimes: number | false,
]

export function useAglynCanvasHistoryControls(): UseAglynCanvasHistory {
  const app = useBesignerAppContext()
  const undoCount = useSubscribable<number | 0>(
    app.canvas?.pastElements,
    0,
    (past) => {
      return past?.length || 0
    },
    [app],
  )
  const redoCount = useSubscribable<number | 0>(
    app.canvas?.futureElements,
    0,
    (future) => {
      return future?.length || 0
    },
    [app],
  )
  return useMemo(() => {
    return [
      () => canvasUndo(app, {}),
      () => canvasRedo(app, {}),
      undoCount > 0 ? undoCount : false,
      redoCount > 0 ? redoCount : false,
    ]
  }, [undoCount, redoCount, app])
}
export default useAglynCanvasHistoryControls
