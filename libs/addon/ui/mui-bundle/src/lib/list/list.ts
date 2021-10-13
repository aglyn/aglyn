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
  ComponentId,
  IAglynComponentSchema,
  createElementComponent,
} from '@aglyn/core-data-components'
import { List } from '@mui/material'

export const loader = () => import('@mui/material/List').then((i) => i.default)
export const componentId: ComponentId = 'list'
export const bundleId: ComponentId = 'mui'
export const metadata: IAglynComponentSchema['metadata'] = {
  displayName: 'List',
  icon: 'format-list-text',
}
export const templates: IAglynComponentSchema['templates'] = [
  {
    id: 'mui:list',
    title: 'List',
    icon: 'format-list-text',
    data: {
      componentId: componentId,
      bundleId: bundleId,
      elements: [
        {
          componentId: 'list-item',
          bundleId: bundleId,
          elements: [
            {
              componentId: 'list-item-text',
              bundleId: bundleId,
              props: {
                primary: 'Item 1 Primary',
                secondary: 'This is the secondary',
              },
            },
          ],
        },
        {
          componentId: 'list-item',
          bundleId: bundleId,
          elements: [
            {
              componentId: 'list-item-text',
              bundleId: bundleId,
              props: {
                primary: 'Item 2 Primary',
                secondary: 'This is the secondary',
              },
            },
          ],
        },
      ],
    },
  },
]

export const component = createElementComponent(
  {
    componentId,
    bundleId,
    metadata,
    templates,
  },
  List
)

export default component
