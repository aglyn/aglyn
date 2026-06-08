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
import { mdiPageLayoutHeader } from '@aglyn/shared-ui-jsx'
import AppBar, { type AppBarProps } from '@mui/material/AppBar'
import { BUNDLE_ID } from '../constants/bundle-common'
import { FIELD_COLOR_ALT1, FIELD_POSITION } from '../constants/field-presets'
import { generatePresetId } from '../utils/generate-preset-id'
import { presets as toolbarPresets } from './toolbar'

const ID: Aglyn.ComponentId = 'app-bar'

export const schema: Aglyn.ComponentSchema<AppBarProps> = {
  $id: ID,
  pluginId: BUNDLE_ID,
  displayName: 'App Toolbar',
  icon: {
    path: mdiPageLayoutHeader.path,
    sx: { color: '#2196f3' },
  },
  attributes: [FIELD_COLOR_ALT1, FIELD_POSITION],
}

export const presets: Aglyn.PresetSchema[] = [
  {
    $id: generatePresetId(ID),
    type: Aglyn.NodeType.PRESET,
    displayName: 'App Toolbar',
    icon: {
      path: mdiPageLayoutHeader.path,
      sx: { color: '#2196f3' },
    },
    category: Aglyn.ComponentCategory.SURFACE,
    data: {
      $id: null,
      componentId: ID,
      pluginId: BUNDLE_ID,
      props: {
        position: 'sticky',
      },
      nodes: [
        {
          ...toolbarPresets[0].data,
        },
      ],
    },
  },
]

export default AppBar
