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

import {
  type AglynComponentSchema,
  type ComponentId,
  PropertyEditorFieldFlag,
} from '@aglyn/core-data-framework'
import {mdiGestureTapButton} from '@aglyn/shared-ui-mdi-jsx'
import Button, {type ButtonProps} from '@mui/material/Button'
import {BUNDLE_ID} from '../constants/bundle-common'
import {
  FIELD_COLOR,
  FIELD_DISABLED,
  FIELD_FULL_WIDTH,
  FIELD_SIZE,
} from '../constants/field-presets'
import {generateTemplateId} from '../utils/generate-template-id'


const ID: ComponentId = 'button'

export const schema: AglynComponentSchema<ButtonProps> = {
  componentId: ID,
  bundleId: BUNDLE_ID,
  metadata: {
    displayName: 'Button',
    iconPath: mdiGestureTapButton.path,
    iconColor: '#2196f3',
  },
  renderFlags: {
    propsSchema: {
      fields: [
        FIELD_COLOR,
        FIELD_DISABLED,
        FIELD_FULL_WIDTH,
        FIELD_SIZE,
        {
          name: 'variant',
          description: 'The variant to use.',
          component: PropertyEditorFieldFlag.SELECT,
          label: 'Variant',
          options: [
            {value: '', label: 'Default'},
            {value: 'text', label: 'Text'},
            {value: 'outlined', label: 'Outlined'},
            {value: 'contained', label: 'Contained'},
          ],
        },
      ],
    },
  },
  templates: [
    {
      id: generateTemplateId(ID),
      label: 'Outlined Button',
      iconPath: mdiGestureTapButton.path,
      iconColor: '#2196f3',
      data: {
        componentId: ID,
        bundleId: BUNDLE_ID,
        props: {
          variant: 'outlined',
          children: 'Click Me',
        },
      },
    },
  ],
}

export default Button
