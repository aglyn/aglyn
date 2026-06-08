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
import Toolbar from '@mui/material/Toolbar'
import { BUNDLE_ID } from '../constants/bundle-common'
import { FIELD_DISABLE_GUTTERS } from '../constants/field-presets'
import { generatePresetId } from '../utils/generate-preset-id'

const ID: Aglyn.ComponentId = 'toolbar'

export const schema: Aglyn.ComponentSchema = {
  $id: ID,
  pluginId: BUNDLE_ID,
  displayName: 'Toolbar Content',
  icon: {
    path: mdiBorderInside.path,
    sx: { color: '#2196f3' },
  },
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
    $id: generatePresetId(ID),
    type: Aglyn.NodeType.PRESET,
    displayName: 'Toolbar Content',
    icon: {
      path: mdiBorderInside.path,
      sx: { color: '#2196f3' },
    },
    category: Aglyn.ComponentCategory.SURFACE,
    data: {
      $id: null,
      componentId: ID,
      pluginId: BUNDLE_ID,
    },
  },
]

export default Toolbar
