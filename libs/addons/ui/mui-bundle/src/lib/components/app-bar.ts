/**
 * @license
 * Copyright 2021 Aglyn LLC
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

import {type AglynComponentSchema, type ComponentId} from '@aglyn/core-data-framework'
import {mdiPageLayoutHeader} from '@aglyn/shared-ui-mdi-jsx'
import AppBar, {type AppBarProps} from '@mui/material/AppBar'
import {BUNDLE_ID} from '../constants/bundle-common'
import {FIELD_COLOR_ALT1, FIELD_POSITION} from '../constants/field-presets'
import {generateTemplateId} from '../utils/generate-template-id'
import {schema as toolbarSchema} from './toolbar'


const ID: ComponentId = 'app-bar'

export const schema: AglynComponentSchema<AppBarProps> = {
  componentId: ID,
  bundleId: BUNDLE_ID,
  metadata: {
    displayName: 'App Toolbar',
    iconPath: mdiPageLayoutHeader.path,
    iconColor: '#2196f3',
  },
  renderFlags: {
    propsSchema: {
      fields: [
        FIELD_COLOR_ALT1,
        FIELD_POSITION,
      ],
    },
  },
  templates: [
    {
      id: generateTemplateId(ID),
      label: 'App Toolbar',
      iconPath: mdiPageLayoutHeader.path,
      iconColor: '#2196f3',
      data: {
        componentId: ID,
        bundleId: BUNDLE_ID,
        elements: [
          toolbarSchema.templates![0]!.data,
        ],
      },
    },
  ],
}

export default AppBar
