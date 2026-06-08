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

import type {
  AglynNodeItemDenormalized,
  AglynNodesById,
  NodeId,
} from '@aglyn/core-data-foundation'
import createComponentElementData from './create-component-element-data'
import nodeDataDenormalize from './node-data-denormalize'

export const createComponentElementDataCopy = (
  $id: NodeId,
  state: AglynNodesById,
): AglynNodeItemDenormalized => {
  const element = nodeDataDenormalize(state, state[$id].parentId).find(
    (i) => i.$id === $id,
  )
  return createComponentElementData({ data: element })
}
export default createComponentElementDataCopy
