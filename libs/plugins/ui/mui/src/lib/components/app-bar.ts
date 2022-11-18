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

import type {
  AglynComponentSchema,
  ComponentId,
} from '@aglyn/core-data-foundation'
import { ComponentCategory } from '@aglyn/core-data-foundation'
import { mdiPageLayoutHeader } from '@aglyn/shared-ui-mdi-jsx'
import AppBar, { type AppBarProps } from '@mui/material/AppBar'
import { BUNDLE_ID } from '../constants/bundle-common'
import { FIELD_COLOR_ALT1, FIELD_POSITION } from '../constants/field-presets'
import { generatePresetId } from '../utils/generate-preset-id'
import { schema as toolbarSchema } from './toolbar'

const ID: ComponentId = 'app-bar'

export const schema: AglynComponentSchema<AppBarProps> = {
  $id: ID,
  pluginId: BUNDLE_ID,
  displayName: 'App Toolbar',
  icon: {
    path: mdiPageLayoutHeader.path,
    sx: { color: '#2196f3' },
  },
  attributes: [FIELD_COLOR_ALT1, FIELD_POSITION],
  presets: [
    {
      $id: generatePresetId(ID),
      label: 'App Toolbar',
      icon: {
        path: mdiPageLayoutHeader.path,
        sx: { color: '#2196f3' },
      },
      category: ComponentCategory.SURFACE,
      data: {
        componentId: ID,
        pluginId: BUNDLE_ID,
        props: {
          position: 'sticky',
        },
        nodes: [
          {
            ...toolbarSchema.presets![0]!.data,
          },
        ],
      },
    },
  ],
}

export default AppBar
