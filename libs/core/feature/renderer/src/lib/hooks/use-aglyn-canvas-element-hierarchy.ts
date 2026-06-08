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

import { getCanvasNormalizedNodesStore } from '@aglyn/core-data-app'
import type { AglynNodeHierarchy, NodeId } from '@aglyn/core-data-foundation'
import { getComponentElementHierarchy } from '@aglyn/core-util-app'
import { useSubscribable } from '@aglyn/shared-ui-jsx'
import { useAglynAppContext } from '../contexts/aglyn-app-context'

export function useAglynCanvasElementHierarchy<T extends NodeId>(
  $id: T,
): AglynNodeHierarchy<T> {
  const app = useAglynAppContext()
  return useSubscribable(
    getCanvasNormalizedNodesStore(app),
    [] as any,
    (state) => getComponentElementHierarchy($id, state),
    [$id, app],
  ) as AglynNodeHierarchy<T>
}
export default useAglynCanvasElementHierarchy
