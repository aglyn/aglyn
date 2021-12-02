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

import type {
  AglynComponentElementTemplateData,
  AglynComponentSchema,
  BundleUId,
  ComponentId,
} from '@aglyn/core-data-framework'
import { createAglynComponentElement } from '@aglyn/core-data-framework'
import { FieldComponent } from '@aglyn/shared-ui-jsx'
import Button from '@mui/material/Button'

export const loader = () => import('@mui/material/Button').then((i) => i.default)
export const componentId: ComponentId = 'button'
export const bundleId: BundleUId = 'mui'
export const metadata: AglynComponentSchema['metadata'] = {
  displayName: 'Button',
}
export const renderFlags: AglynComponentSchema['renderFlags'] = {
  propsSchema: {
    fields: [
      {
        name: 'variant',
        component: FieldComponent.SELECT,
        label: 'Variant',
        variant: 'outlined',
        options: [
          { value: 'text', label: 'Text' },
          { value: 'outlined', label: 'Outlined' },
          { value: 'contained', label: 'Contained' },
        ],
      },
    ],
  },
}
export const templates: AglynComponentElementTemplateData[] = [
  {
    id: 'mui:button',
    title: 'Outlined Button',
    data: {
      componentId: componentId,
      bundleId: bundleId,
      props: {
        variant: 'outlined',
        children: 'Click Me',
      },
    },
  },
]
export const schema: AglynComponentSchema = {
  componentId,
  bundleId,
  metadata,
  renderFlags,
  templates,
}

export const component = createAglynComponentElement(schema, Button)

export default component
