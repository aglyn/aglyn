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
import { ComponentsLinealDirectiveFlag } from '@aglyn/core-data-framework'
import { aglynElementComponent, dynamicLoader } from '@aglyn/core-feature-renderer'
import List, { ListProps } from '@mui/material/List'
import { BUNDLE_ID } from '../../constants'
import { schema as listItemSchema } from '../list-item'
import { generateTemplateId } from '../../utils/generate-template-id'


const ID: ComponentId = 'list'

export const loader = dynamicLoader(() => import('@mui/material/List'))
export const schema: AglynComponentSchema<ListProps> = {
  componentId: ID,
  bundleId: 'mui',
  metadata: {
    displayName: 'List',
    iconIds: 'format-list-bulleted-square',
    iconColor: '#2196f3',
  },
  renderFlags: {
    hierarchy: {
      restrictChildren: [
        ComponentsLinealDirectiveFlag.LIMIT_TO, {
          components: [listItemSchema.componentId],
        },
      ],
    },
  },
  templates: [
    {
      id: generateTemplateId(ID),
      label: 'List',
      iconIds: 'format-list-bulleted-square',
      iconColor: '#2196f3',
      data: {
        componentId: ID,
        bundleId: BUNDLE_ID,
        elements: [
          listItemSchema.templates![0]!.data,
          listItemSchema.templates![0]!.data,
        ],
      },
    },
  ],
}
export const component = aglynElementComponent(schema, List)

export default component
