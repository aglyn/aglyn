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
import { mdiViewColumn, mdiViewSequential } from '@aglyn/shared-ui-jsx'
import Stack from '@mui/material/Stack'
import { PLUGIN_ID } from '../constants/common'
import generatePresetId from '../utils/generate-preset-id'

export const ID: Aglyn.ComponentId = 'muiStack'

export const schema: Aglyn.ComponentSchema = {
  $id: ID,
  pluginId: PLUGIN_ID,
  displayName: 'Stack',
  category: Aglyn.ComponentCategory.LAYOUT,
  icon: {
    path: mdiViewColumn.path,
    sx: { color: '#2196f3' },
  },
  attributes: [
    {
      name: 'direction',
      label: 'Direction',
      description:
        'Defines the directional flow using the `flex-direction` style property. It is applied for all screen sizes.',
      component: Aglyn.FieldComponentType.SELECT,
      options: [
        { value: '', label: 'Default' },
        { value: 'column', label: 'Column' },
        { value: 'column-reverse', label: 'Column Reversed' },
        { value: 'row', label: 'Row' },
        { value: 'row-reverse', label: 'Row Reversed' },
      ],
    },
    {
      name: 'justifyContent',
      label: 'Justify Content',
      description:
        'Defines how the browser distributes space between and around content items along the main-axis of the container.',
      component: Aglyn.FieldComponentType.SELECT,
      options: [
        { value: '', label: 'Default' },
        { value: 'flex-start', label: 'Flex Start' },
        { value: 'center', label: 'Center' },
        { value: 'flex-end', label: 'Flex End' },
        { value: 'space-between', label: 'Space Between' },
        { value: 'space-around', label: 'Space Around' },
        { value: 'space-evenly', label: 'Space Evenly' },
      ],
    },
    {
      name: 'spacing',
      label: 'Spacing',
      description: 'Defines the space/gap between its immediate children.',
      component: Aglyn.FieldComponentType.TEXT_FIELD,
      type: 'number',
    },
  ],
}

export const presets: Aglyn.PresetSchema[] = [
  {
    type: 'preset',
    $id: generatePresetId(ID),
    displayName: 'Stack Horizontal',
    icon: {
      path: mdiViewColumn.path,
      sx: { color: '#2196f3' },
    },
    category: Aglyn.ComponentCategory.LAYOUT,
    data: {
      $id: null,
      componentId: ID,
      pluginId: PLUGIN_ID,
      props: {},
      sx: { flexDirection: 'row' },
    },
  },
  {
    type: 'preset',
    $id: generatePresetId(ID, 'vertical'),
    displayName: 'Stack Vertical',
    icon: {
      path: mdiViewSequential.path,
      sx: { color: '#2196f3' },
    },
    category: Aglyn.ComponentCategory.LAYOUT,
    data: {
      $id: null,
      componentId: ID,
      pluginId: PLUGIN_ID,
      props: {},
      sx: { flexDirection: 'column' },
    },
  },
]

export default Stack
