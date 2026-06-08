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
import { mdiViewArrayOutline } from '@aglyn/shared-ui-jsx'
import Container, { type ContainerProps } from '@mui/material/Container'
import { BUNDLE_ID } from '../constants/bundle-common'
import { generatePresetId } from '../utils/generate-preset-id'

const ID: Aglyn.ComponentId = 'container'

export const schema: Aglyn.ComponentSchema<ContainerProps> = {
  $id: ID,
  pluginId: BUNDLE_ID,
  displayName: 'Container',
  icon: {
    path: mdiViewArrayOutline.path,
    sx: { color: '#2196f3' },
  },
  attributes: [
    {
      name: 'fixed',
      description:
        "If true, set the max-width to match the min-width of the current breakpoint. This is useful if you'd prefer to design for a fixed set of sizes instead of trying to accommodate a fully fluid viewport. It's fluid by default.",
      component: Aglyn.FieldComponentType.SWITCH,
      label: 'Fixed Breakpoints',
    },
    {
      name: 'disableGutters',
      description: 'If true, the left and right padding is removed.',
      component: Aglyn.FieldComponentType.SWITCH,
      label: 'Disable Gutters?',
    },
    {
      name: 'maxWidth',
      description:
        'Determine the max-width of the container. The container width grows with the size of the screen. Set to `false` to disable `maxWidth`',
      component: Aglyn.FieldComponentType.SELECT,
      label: 'Max Width',
      options: [
        { value: '', label: 'Default' },
        { value: 'xs', label: 'XS - Mobile' },
        { value: 'sm', label: 'SM - Tablet' },
        { value: 'md', label: 'MD - Laptop' },
        { value: 'lg', label: 'LG - Desktop' },
        { value: 'xl', label: 'XL - Widescreen' },
        { value: false, label: 'Fluid Responsive' },
      ],
    },
  ],
}

export const presets: Aglyn.PresetSchema[] = [
  {
    $id: generatePresetId(ID),
    type: Aglyn.NodeType.PRESET,
    displayName: 'Container',
    icon: {
      path: mdiViewArrayOutline.path,
      sx: { color: '#2196f3' },
    },
    category: Aglyn.ComponentCategory.LAYOUT,
    data: {
      $id: null,
      componentId: ID,
      pluginId: BUNDLE_ID,
      props: {},
    },
  },
]

export default Container
