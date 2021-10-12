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

import { ComponentId, createElementComponent, IAglynComponentSchema } from '@aglyn/data-components'
import { ListItemText } from '@mui/material'


export const loader = () => import('@mui/material/ListItemText').then(i => i.default)
export const componentId: ComponentId = 'list-item-text'
export const bundleId: ComponentId = 'mui'
export const metadata: IAglynComponentSchema['metadata'] = {
  displayName: 'List Item Text',
}
export const templates: IAglynComponentSchema['templates'] = [
  {
    id: 'mui:list-item-text',
    title: 'List Item Text',
    data: {
      componentId: componentId,
      bundleId: bundleId,
      props: {
        primary: 'Item Primary',
        secondary: 'This is the secondary',
      },
    }
  },
]

export const component = createElementComponent({
  componentId,
  bundleId,
  metadata,
  templates,
}, ListItemText)

export default component
