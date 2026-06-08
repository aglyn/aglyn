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
import { ComponentCategory } from '@aglyn/core-data-foundation'
import { mdiPageLayoutHeader } from '@aglyn/shared-data-mdi'
import Toolbar from '@mui/material/AppBar'
import { PLUGIN_ID } from '../constants/common'
import { FIELD_COLOR_ALT1, FIELD_POSITION } from '../constants/field-presets'
import GeneratePresetId from '../utils/generate-preset-id'
import { ID as toolbarId } from './toolbar'

export const ID: Aglyn.ComponentId = 'muiAppBar'

export const schema: Aglyn.ComponentSchema = {
  $id: ID,
  pluginId: PLUGIN_ID,
  displayName: 'App Bar',
  category: Aglyn.ComponentCategory.SURFACE,
  icon: {
    path: mdiPageLayoutHeader.path,
    sx: { color: '#2196f3' },
  },
  attributes: [FIELD_COLOR_ALT1, FIELD_POSITION],
}

export const presets: Aglyn.PresetSchema[] = [
  {
    type: 'preset',
    $id: GeneratePresetId(ID),
    displayName: 'Toolbar (Complete)',
    pluginId: PLUGIN_ID,
    description: 'A toolbar preset with the app bar and toolbar content nodes',
    category: ComponentCategory.DATA_DISPLAY,
    icon: schema.icon,
    data: {
      $id: null,
      componentId: ID,
      pluginId: PLUGIN_ID,
      nodes: [
        {
          $id: null,
          componentId: toolbarId,
          pluginId: PLUGIN_ID,
          props: {},
        },
      ],
    },
  },
]

export default Toolbar
