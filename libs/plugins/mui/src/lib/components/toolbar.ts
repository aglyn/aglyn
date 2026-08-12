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
  mdiBorderInside,
} from '@aglyn/shared-data-mdi'
import MuiToolbar, { type ToolbarProps } from '@mui/material/Toolbar'
import { createElement, forwardRef } from 'react'
import { BUNDLE_ID } from '../constants/bundle-common'
import { FIELD_DISABLE_GUTTERS } from '../constants/field-presets'
import { dropClearedProps } from '../utils/drop-cleared-props'
import { generatePresetId } from '../utils/generate-preset-id'

/**
 * MUI's Toolbar behind the cleared-prop guard (AGL-1451).
 *
 * This was the one component in the AGL-1451 set where `''` reached MUI
 * untouched, so it carried the AGL-1435 defect exactly: MUI's Toolbar
 * destructures `variant = 'regular'` and then applies its height from
 * `ownerState.variant === 'regular' && theme.mixins.toolbar`. `''` is not
 * `undefined`, so the default never fires, and it is falsy, so neither the
 * `regular` nor the `dense` branch matches — the toolbar renders with NO
 * min-height at all and the app bar collapses to its content. Nothing
 * throws and the editor looks fine.
 *
 * `createElement` rather than JSX keeps this a `.ts` file.
 */
const Toolbar = forwardRef<HTMLDivElement, ToolbarProps>((props, ref) =>
  createElement(MuiToolbar, { ...dropClearedProps(props), ref }),
)
Toolbar.displayName = 'AglynToolbar'

// Component ids are persisted in screen documents; keep the legacy ids.
export const ID: Aglyn.ComponentId = 'muiToolbar'

export const schema: Aglyn.ComponentSchema<ToolbarProps> = {
  $id: ID,
  pluginId: BUNDLE_ID,
  displayName: 'Toolbar Content',
  category: Aglyn.ComponentCategory.NAVIGATION,
  icon: {
    path: mdiBorderInside.path,
    sx: { color: '#2196f3' },
  },
  restrictParent: [
    Aglyn.LinealDirectiveFlag.LIMIT_TO,
    { components: ['muiAppBar'], plugins: [BUNDLE_ID] },
  ],
  attributes: [
    FIELD_DISABLE_GUTTERS,
    {
      name: 'variant',
      description:
        'Regular is the standard bar height; dense compacts it. Clearing ' +
        'the field falls back to Regular, which is MUI’s own default.',
      component: Aglyn.FieldComponentType.SELECT,
      label: 'Variant',
      // No "Default" option: MUI has exactly two toolbar heights and
      // `regular` IS the default, so "Default" was a second name for a
      // choice already in the list — carrying the `''` value that rendered
      // a toolbar with no min-height at all (AGL-1451). Deleted rather
      // than given a sentinel for that reason; every value here is real
      // and persistable.
      options: [
        { value: 'dense', label: 'Dense' },
        { value: 'regular', label: 'Regular (default)' },
      ],
    },
  ],
}

export const presets: Aglyn.PresetSchema[] = [
  {
    $id: generatePresetId(ID),
    type: Aglyn.NodeType.PRESET,
    displayName: 'Toolbar Content',
    icon: {
      path: mdiBorderInside.path,
      sx: { color: '#2196f3' },
    },
    category: Aglyn.ComponentCategory.NAVIGATION,
    data: {
      $id: null,
      componentId: ID,
      pluginId: BUNDLE_ID,
    },
  },
]

export default Toolbar
