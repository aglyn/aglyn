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

import type { AglynComponentSchema, ComponentId } from '@aglyn/core-data-framework'
import { ComponentsLinealDirectiveFlag, PropertyEditorFieldFlag } from '@aglyn/core-data-framework'
import { aglynElementComponent, dynamicLoader } from '@aglyn/core-feature-renderer'
import Button, { ButtonProps } from '@mui/material/Button'
import { BUNDLE_ID } from '../../constants'
import { schema as listItemSchema } from '../list-item'
import { generateTemplateId } from '../../utils/generate-template-id'


const ID: ComponentId = 'button'

export const loader = dynamicLoader(() => import('@mui/material/Button'))
export const schema: AglynComponentSchema<ButtonProps> = {
  componentId: ID,
  bundleId: BUNDLE_ID,
  metadata: {
    displayName: 'Button',
    iconIds: 'gesture-tap-button',
    iconColor: '#4caf50',
  },
  renderFlags: {
    hierarchy: {
      restrictChildren: [
        ComponentsLinealDirectiveFlag.LIMIT_TO, {
          components: [listItemSchema.componentId],
        },
      ],
    },
    propsSchema: {
      fields: [
        {
          name: 'variant',
          component: PropertyEditorFieldFlag.SELECT,
          label: 'Variant',
          variant: 'outlined',
          options: [
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
      iconIds: 'gesture-tap-button',
      iconColor: '#4caf50',
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

export const component = aglynElementComponent(schema, Button)
export default component
