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

import type { AglynComponentSchema, ComponentId } from '@aglyn/core-data-framework'
import { aglynElementComponent, dynamicLoader } from '@aglyn/core-feature-renderer'
import ListItemText, { ListItemTextProps } from '@mui/material/ListItemText'
import { BUNDLE_ID } from '../../constants'
import { generateTemplateId } from '../../utils/generate-template-id'


const ID: ComponentId = 'list-item-text'

export const loader = dynamicLoader(() => import('@mui/material/ListItemText'))
export const schema: AglynComponentSchema<ListItemTextProps> = {
  componentId: ID,
  bundleId: BUNDLE_ID,
  metadata: {
    displayName: 'List Item Text',
    iconIds: 'format-list-checks',
  },
  templates: [
    {
      id: generateTemplateId(ID),
      label: 'List Item Text',
      iconIds: 'format-list-checks',
      data: {
        componentId: ID,
        bundleId: BUNDLE_ID,
        props: {
          primary: 'Item Primary',
          secondary: 'This is the secondary',
        },
      },
    },
  ],
}
export const component = aglynElementComponent(schema, ListItemText)

export default component
