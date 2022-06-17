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

import { type ElementId, type IAglynComponent } from '@aglyn/foundation-data-core'
import { type OrUndef } from '@aglyn/shared-data-types'
import useAglynComponent from './use-aglyn-component'
import useAglynElementData from './use-aglyn-element-data'

export function useAglynElementComponent<P, T>($id: ElementId): OrUndef<IAglynComponent<P, T>> {
  const componentId = useAglynElementData($id, 'componentId')
  const bundleId = useAglynElementData($id, 'bundleId')
  return useAglynComponent(componentId, bundleId)
}
export default useAglynElementComponent
