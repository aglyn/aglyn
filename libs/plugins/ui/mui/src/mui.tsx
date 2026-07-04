/**
 * @license
 * Copyright 2026 Aglyn LLC
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
  AglynBundleSchema,
  ComponentRegisterPayload,
} from '@aglyn/aglyn'
import { createAglynComponent } from '@aglyn/aglyn-node-renderer'
import { createComponentsBundle } from '@aglyn/aglyn'
import { mdiViewArray } from '@aglyn/shared-data-mdi'

import appBar, { schema as appBarSchema } from './lib/components/app-bar'
import button, { schema as buttonSchema } from './lib/components/button'
import container, {
  schema as containerSchema,
} from './lib/components/container'
import list, { schema as listSchema } from './lib/components/list'
import listItem, { schema as listItemSchema } from './lib/components/list-item'
import listItemText, {
  schema as listItemTextSchema,
} from './lib/components/list-item-text'
import stack, { schema as stackSchema } from './lib/components/stack'
import toolbar, { schema as toolbarSchema } from './lib/components/toolbar'
import typography, {
  schema as typographySchema,
} from './lib/components/typography'

import { BUNDLE_ID } from './lib/constants/bundle-common'

export const components: ComponentRegisterPayload[] = [
  createAglynComponent<any>(appBarSchema, appBar),
  createAglynComponent<any>(buttonSchema, button),
  createAglynComponent<any>(containerSchema, container),
  createAglynComponent<any>(listSchema, list),
  createAglynComponent<any>(listItemSchema, listItem),
  createAglynComponent<any>(listItemTextSchema, listItemText),
  createAglynComponent<any>(stackSchema, stack),
  createAglynComponent<any>(toolbarSchema, toolbar),
  createAglynComponent<any>(typographySchema, typography),
]

export const schema: AglynBundleSchema = {
  pluginId: BUNDLE_ID,
  displayName: 'Mui Components',
  description: 'Material-UI view components',
  icon: { path: mdiViewArray.path },
}

export const bundle = createComponentsBundle(schema, components)
export default bundle
// export function activate(unknown, context) {}
