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

import type { NodeId } from '@aglyn/core-data-foundation'
import useAglynComponentSchema from './use-aglyn-component-schema'
import useAglynElementData from './use-aglyn-element-data'

export function useAglynElementLabel($id: NodeId) {
  const displayName = useAglynElementData($id, 'displayName')
  const componentId = useAglynElementData($id, 'componentId')
  const bundleId = useAglynElementData($id, 'bundleId')
  const schema = useAglynComponentSchema(componentId, bundleId)
  return displayName || schema?.displayName || $id
}
export default useAglynElementLabel
