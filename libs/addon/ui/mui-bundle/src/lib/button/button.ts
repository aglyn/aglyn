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
  createElementComponent,
  IAglynComponentSchema,
} from '@aglyn/core-data-framework'
import { Button } from '@mui/material'


export const loader = () => import('@mui/material/Button').then((i) => i.default)
export const componentId: ComponentId = 'button'
export const bundleId: ComponentId = 'mui'
export const metadata: IAglynComponentSchema['metadata'] = {
  displayName: 'Button',
}
export const templates: IAglynComponentSchema['templates'] = [
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

export const component = createElementComponent(
  {
    componentId,
    bundleId,
    metadata,
    templates,
  },
  Button,
)

export default component
