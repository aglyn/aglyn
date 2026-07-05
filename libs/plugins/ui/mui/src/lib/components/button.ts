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
import {
  mdiGestureTapButton,
} from '@aglyn/shared-data-mdi'
import Button, { type ButtonProps } from '@mui/material/Button'
import { BUNDLE_ID } from '../constants/bundle-common'
import {
  FIELD_COLOR,
  FIELD_DISABLED,
  FIELD_FULL_WIDTH,
  FIELD_SIZE,
} from '../constants/field-presets'
import { generatePresetId } from '../utils/generate-preset-id'

// Component ids are persisted in screen documents; keep the legacy ids.
export const ID: Aglyn.ComponentId = 'muiButton'

export const schema: Aglyn.ComponentSchema<ButtonProps> = {
  $id: ID,
  pluginId: BUNDLE_ID,
  displayName: 'Button',
  category: Aglyn.ComponentCategory.INPUT,
  icon: {
    path: mdiGestureTapButton.path,
    sx: { color: '#2196f3' },
  },
  attributes: [
    FIELD_COLOR,
    FIELD_DISABLED,
    FIELD_FULL_WIDTH,
    FIELD_SIZE,
    {
      name: 'variant',
      description: 'The variant to use.',
      component: Aglyn.FieldComponentType.SELECT,
      label: 'Variant',
      options: [
        { value: '', label: 'Default' },
        { value: 'text', label: 'Text' },
        { value: 'outlined', label: 'Outlined' },
        { value: 'contained', label: 'Contained' },
      ],
    },
  ],
}

export const presets: Aglyn.PresetSchema[] = [
  {
    $id: generatePresetId(ID),
    type: Aglyn.NodeType.PRESET,
    displayName: 'Outlined Button',
    icon: {
      path: mdiGestureTapButton.path,
      sx: { color: '#2196f3' },
    },
    category: Aglyn.ComponentCategory.INPUT,
    data: {
      $id: null,
      componentId: ID,
      pluginId: BUNDLE_ID,
      props: {
        variant: 'outlined',
        children: 'Click Me',
      },
    },
  },
]

export default Button
