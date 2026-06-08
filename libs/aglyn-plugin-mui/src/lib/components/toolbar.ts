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
import { mdiBorderInside } from '@aglyn/shared-ui-jsx'
import ToolbarInner from '@mui/material/Toolbar'
import { PLUGIN_ID } from '../constants/common'
import { FIELD_DISABLE_GUTTERS } from '../constants/field-presets'
import generatePresetId from '../utils/generate-preset-id'

export const ID: Aglyn.ComponentId = 'muiToolbar'

export const schema: Aglyn.ComponentSchema = {
  $id: ID,
  pluginId: PLUGIN_ID,
  displayName: 'Toolbar Content',
  category: Aglyn.ComponentCategory.SURFACE,
  icon: {
    path: mdiBorderInside.path,
    sx: { color: '#2196f3' },
  },
  restrictParent: [
    Aglyn.LinealDirectiveFlag.LIMIT_TO,
    { components: ['muiAppBar'], plugins: [PLUGIN_ID] },
  ],
  attributes: [
    FIELD_DISABLE_GUTTERS,
    {
      name: 'variant',
      description: 'The variant to use.',
      component: Aglyn.FieldComponentType.SELECT,
      label: 'Variant',
      options: [
        { value: '', label: 'Default' },
        { value: 'dense', label: 'Dense' },
        { value: 'regular', label: 'Regular' },
      ],
    },
  ],
}

export const presets: Aglyn.PresetSchema[] = [
  {
    type: 'preset',
    $id: generatePresetId(ID),
    displayName: 'Toolbar Content',
    icon: {
      path: mdiBorderInside.path,
      sx: { color: '#2196f3' },
    },
    category: Aglyn.ComponentCategory.SURFACE,
    data: {
      $id: null,
      componentId: ID,
      pluginId: PLUGIN_ID,
    },
  },
]

export default ToolbarInner
