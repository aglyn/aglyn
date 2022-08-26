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
} from '@aglyn/core-data-foundation'
import { mdiViewColumn, mdiViewSequential } from '@aglyn/shared-ui-mdi-jsx'
import Stack, { type StackProps } from '@mui/material/Stack'
import { BUNDLE_ID } from '../constants/bundle-common'
import { generatePresetId } from '../utils/generate-preset-id'

const ID: ComponentId = 'stack'

export const schema: AglynComponentSchema<StackProps> = {
  componentId: ID,
  bundleId: BUNDLE_ID,
  displayName: 'Stack',
  icon: {
    path: mdiViewColumn.path,
    sx: { color: '#2196f3' },
  },
  attributes: [],
  presets: [
    {
      presetId: generatePresetId(ID),
      label: 'Stack Horizontal',
      icon: {
        path: mdiViewColumn.path,
        sx: { color: '#2196f3' },
      },
      category: ComponentCategory.LAYOUT,
      data: {
        componentId: ID,
        bundleId: BUNDLE_ID,
        props: {},
        sx: { flexDirection: 'row' },
      },
    },
    {
      presetId: generatePresetId(ID, 'vertical'),
      label: 'Stack Vertical',
      icon: {
        path: mdiViewSequential.path,
        sx: { color: '#2196f3' },
      },
      category: ComponentCategory.LAYOUT,
      data: {
        componentId: ID,
        bundleId: BUNDLE_ID,
        props: {},
        sx: { flexDirection: 'column' },
      },
    },
  ],
}

export default Stack
