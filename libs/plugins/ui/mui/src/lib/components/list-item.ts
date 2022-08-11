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
import { mdiFormatListText } from '@aglyn/shared-ui-mdi-jsx'

import ListItem, { type ListItemProps } from '@mui/material/ListItem'
import { BUNDLE_ID } from '../constants/bundle-common'
import { generateTemplateId } from '../utils/generate-template-id'
import { schema as listItemTextSchema } from './list-item-text'

const ID: ComponentId = 'list-item'

export const schema: AglynComponentSchema<ListItemProps> = {
  componentId: ID,
  bundleId: BUNDLE_ID,
  displayName: 'List Item',
  icon: { path: mdiFormatListText.path },
  restrictChildren: [
    ComponentsLinealDirectiveFlag.LIMIT_TO,
    {
      components: [listItemTextSchema.componentId],
    },
  ],
  templates: [
    {
      id: generateTemplateId(ID),
      label: 'List Item',
      icon: { path: mdiFormatListText.path },
      category: ComponentCategory.DATA_DISPLAY,
      data: {
        componentId: ID,
        bundleId: BUNDLE_ID,
        elements: [
          {
            ...listItemTextSchema.templates![0]!.data,
          },
        ],
      },
    },
  ],
}

export default ListItem
