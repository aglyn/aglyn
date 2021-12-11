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

import { _isArrEmpty } from '@aglyn/shared-util-guards'
import { ModificationHistoryState } from '../types'


export const handleRedoEvent = <S>(state: ModificationHistoryState<S>) => {
  if (!_isArrEmpty(state.future)) {
    return handleStateModificationHistoryRedo(state)
  }
  return undefined
}

export const handleStateModificationHistoryRedo = <S>(
  state: ModificationHistoryState<S>
): ModificationHistoryState<S> => {
  if (!_isArrEmpty(state.future)) {
    return {
      past: [state.present, ...state.past],
      present: state.future.slice(0, 1)[0],
      future: state.future.slice(1),
    }
  }
  return state
}
export default handleStateModificationHistoryRedo
