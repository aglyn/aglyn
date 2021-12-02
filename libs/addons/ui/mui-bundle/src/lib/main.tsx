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

import {
  AglynComponentsBundle,
  BundleUId,
  ComponentRegisterPayload,
  ComponentsBundleRegisterPayload,
  createComponentsBundle,
} from '@aglyn/core-data-framework'

import button from './button'
import list from './list'
import listItem from './list-item'
import listItemText from './list-item-text'

export const bundleId: BundleUId = 'mui'
export const metadata: AglynComponentsBundle['metadata'] = {
  displayName: 'Mui Components',
  description: 'Material-UI view components',
  icon: 'view-array',
}
export const components: ComponentRegisterPayload[] = [button, list, listItem, listItemText]

export const bundle: ComponentsBundleRegisterPayload = createComponentsBundle(
  {
    bundleId,
    metadata,
  },
  components
)
export default bundle
