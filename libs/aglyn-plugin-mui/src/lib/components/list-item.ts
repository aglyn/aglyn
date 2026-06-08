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
import { mdiFormatListText } from '@aglyn/shared-ui-jsx'
import ListItem from '@mui/material/ListItem'
import { PLUGIN_ID } from '../constants/common'
import generatePresetId from '../utils/generate-preset-id'
import {
  presets as listItemTextPresets,
  schema as listItemTextSchema,
} from './list-item-text'

export const ID: Aglyn.ComponentId = 'muiListItem'

export const schema: Aglyn.ComponentSchema = {
  $id: ID,
  pluginId: PLUGIN_ID,
  displayName: 'List Item',
  category: Aglyn.ComponentCategory.DATA_DISPLAY,
  icon: { path: mdiFormatListText.path },
  restrictChildren: [
    Aglyn.LinealDirectiveFlag.LIMIT_TO,
    {
      components: [listItemTextSchema.$id],
    },
  ],
}

export const presets: Aglyn.PresetSchema[] = [
  {
    type: 'preset',
    $id: generatePresetId(ID),
    displayName: 'List Item',
    icon: { path: mdiFormatListText.path },
    category: Aglyn.ComponentCategory.DATA_DISPLAY,
    data: {
      $id: null,
      componentId: ID,
      pluginId: PLUGIN_ID,
      nodes: [
        {
          ...listItemTextPresets[0].data,
        },
      ],
    },
  },
]

export default ListItem
