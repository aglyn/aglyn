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
import {
  mdiViewArrayOutline,
} from '@aglyn/shared-data-mdi'
import MuiContainer, { type ContainerProps } from '@mui/material/Container'
import { createElement, forwardRef } from 'react'
import { BUNDLE_ID } from '../constants/bundle-common'
import { dropClearedProps } from '../utils/drop-cleared-props'
import { generatePresetId } from '../utils/generate-preset-id'

/**
 * MUI's Container behind the cleared-prop guard (AGL-1435).
 *
 * `maxWidth` is the one authorable attribute in this plugin where a cleared
 * value changes PAGE LAYOUT instead of showing an obviously wrong value, and
 * it satisfied neither branch of MUI's own logic:
 *
 *  - `''` / `null` is not `undefined`, so the `maxWidth = 'lg'` destructuring
 *    default in `@mui/system/Container/createContainer.js` never fires;
 *  - `''` / `null` is falsy, so the `ownerState.maxWidth &&` guard skips both
 *    the branch that emits the `max-width` rule and the one that emits the
 *    matching utility class.
 *
 * The result is a section with NO width constraint at all — full-bleed, with
 * nothing thrown and nothing visibly wrong in the editor. Clearing the field
 * persists `null` (the AGL-1226 shape; 106 cleared prop values live in the
 * corpus today across other components), so this was reachable, not
 * theoretical. Dropping the key instead lets MUI's own `lg` apply.
 */
const Container = forwardRef<HTMLDivElement, ContainerProps>((props, ref) =>
  createElement(MuiContainer, { ...dropClearedProps(props), ref }),
)
Container.displayName = 'AglynContainer'

// Component ids are persisted in screen documents; keep the legacy ids.
export const ID: Aglyn.ComponentId = 'muiContainer'

export const schema: Aglyn.ComponentSchema<ContainerProps> = {
  $id: ID,
  pluginId: BUNDLE_ID,
  displayName: 'Container',
  category: Aglyn.ComponentCategory.LAYOUT,
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
        'The width this section stops growing at. New containers start at ' +
        'XL (1536px), the standard for full-width page sections. Clearing ' +
        'the field falls back to the MUI default of LG (1200px). There is ' +
        'no "Default" option: "Fluid Responsive" is the only way to render ' +
        'edge-to-edge, and it has to be chosen on purpose.',
      component: Aglyn.FieldComponentType.SELECT,
      label: 'Max Width',
      // Every value here is a real, persistable one. The list used to open
      // with `{ value: '', label: 'Default' }`, which was unpersistable by
      // construction — the attributes form strips `''` on change (AGL-1191)
      // — and, on any path that DID land it, rendered full-bleed rather than
      // any default at all (AGL-1435).
      options: [
        { value: 'xs', label: 'XS - Mobile (444px)' },
        { value: 'sm', label: 'SM - Tablet (600px)' },
        { value: 'md', label: 'MD - Laptop (900px)' },
        { value: 'lg', label: 'LG - Desktop (1200px)' },
        { value: 'xl', label: 'XL - Widescreen (1536px, section standard)' },
        { value: false, label: 'Fluid Responsive (no max width)' },
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
      // Explicit, not implicit: a dropped Container is a page section, and
      // sections are XL here (245 of the 248 authored on the marketing host).
      // Relying on MUI's implicit `lg` is what made "what does no value mean"
      // an open question in the first place (AGL-1435).
      props: { maxWidth: 'xl' },
    },
  },
]

export default Container
