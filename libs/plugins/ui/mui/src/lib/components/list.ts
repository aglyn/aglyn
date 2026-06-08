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

import * as Aglyn from '@aglyn/aglyn'
import { mdiFormatListBulletedSquare } from '@aglyn/shared-ui-jsx'
import List, { type ListProps } from '@mui/material/List'
import { BUNDLE_ID } from '../constants/bundle-common'
import { generatePresetId } from '../utils/generate-preset-id'
import {
  presets as listItemPresets,
  schema as listItemSchema,
} from './list-item'

const ID: Aglyn.ComponentId = 'list'

export const schema: Aglyn.ComponentSchema<ListProps> = {
  $id: ID,
  pluginId: 'mui',
  displayName: 'List',
  icon: { path: mdiFormatListBulletedSquare.path },
  restrictChildren: [
    Aglyn.LinealDirectiveFlag.LIMIT_TO,
    {
      components: [listItemSchema.$id],
    },
  ],
}

export const presets: Aglyn.PresetSchema[] = [
  {
    $id: generatePresetId(ID),
    type: Aglyn.NodeType.PRESET,
    displayName: 'List',
    icon: { path: mdiFormatListBulletedSquare.path },
    category: Aglyn.ComponentCategory.DATA_DISPLAY,
    data: {
      $id: null,
      componentId: ID,
      pluginId: BUNDLE_ID,
      nodes: [
        {
          ...listItemPresets[0].data,
        },
        {
          ...listItemPresets[0].data,
        },
      ],
    },
  },
]

export default List
