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

import {
  type AglynComponentSchema,
  ComponentCategory,
  type ComponentId,
  ComponentsLinealDirectiveFlag,
} from '@aglyn/core-data-foundation'
import { mdiFormatListBulletedSquare } from '@aglyn/shared-ui-mdi-jsx'
import List, { type ListProps } from '@mui/material/List'
import { BUNDLE_ID } from '../constants/bundle-common'
import { generateTemplateId } from '../utils/generate-template-id'
import { schema as listItemSchema } from './list-item'

const ID: ComponentId = 'list'

export const schema: AglynComponentSchema<ListProps> = {
  componentId: ID,
  bundleId: 'mui',
  displayName: 'List',
  icon: { path: mdiFormatListBulletedSquare.path },
  hierarchy: {
    restrictChildren: [
      ComponentsLinealDirectiveFlag.LIMIT_TO,
      {
        components: [listItemSchema.componentId],
      },
    ],
  },
  templates: [
    {
      id: generateTemplateId(ID),
      label: 'List',
      icon: { path: mdiFormatListBulletedSquare.path },
      category: ComponentCategory.DATA_DISPLAY,
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

export default List
