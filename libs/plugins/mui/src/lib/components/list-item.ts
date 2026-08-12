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
  mdiFormatListText,
} from '@aglyn/shared-data-mdi'
import MuiListItem, { type ListItemProps } from '@mui/material/ListItem'
import { createElement, forwardRef } from 'react'
import { BUNDLE_ID } from '../constants/bundle-common'
import { dropClearedProps } from '../utils/drop-cleared-props'
import { generatePresetId } from '../utils/generate-preset-id'
import {
  presets as listItemTextPresets,
  schema as listItemTextSchema,
} from './list-item-text'

/**
 * MUI's ListItem behind the cleared-prop guard (AGL-1451).
 *
 * Exported raw, so every one of its five authorable attributes reached MUI
 * as authored — including `alignItems`, whose `''` option is not `undefined`
 * (so the `alignItems = 'center'` destructuring default never fires) and is
 * falsy (so the `alignItems === 'flex-start'` branch is skipped), leaving a
 * row that carries neither utility class.
 */
const ListItem = forwardRef<HTMLLIElement, ListItemProps>((props, ref) =>
  createElement(MuiListItem, { ...dropClearedProps(props), ref }),
)
ListItem.displayName = 'AglynListItem'

// Component ids are persisted in screen documents; keep the legacy ids.
export const ID: Aglyn.ComponentId = 'muiListItem'

export const schema: Aglyn.ComponentSchema<ListItemProps> = {
  $id: ID,
  pluginId: BUNDLE_ID,
  displayName: 'List Item',
  description: 'One row of a list.',
  category: Aglyn.ComponentCategory.DATA_DISPLAY,
  icon: { path: mdiFormatListText.path },
  restrictChildren: [
    Aglyn.LinealDirectiveFlag.LIMIT_TO,
    {
      components: [listItemTextSchema.$id],
    },
  ],
  // Like List, this had NO attributes: dividers, density and gutters are
  // the first things anyone reaches for on a list row, and none of them
  // were reachable from the inspector.
  attributes: [
    {
      name: 'divider',
      label: 'Divider?',
      description: 'If true, a 1px line is drawn under the item.',
      component: Aglyn.FieldComponentType.SWITCH,
    },
    {
      name: 'alignItems',
      label: 'Align items',
      description:
        'Vertical alignment of the row content. Use flex-start when the ' +
        'secondary text wraps to several lines.',
      component: Aglyn.FieldComponentType.SELECT,
      // `center` is MUI's own value and the one an author needs to move a
      // row BACK off Top, so it stays in the list as a real sentinel
      // rather than being deleted (AGL-1451). As `''` that move could not
      // persist (AGL-1191).
      options: [
        { value: 'center', label: 'Center (default)' },
        { value: 'flex-start', label: 'Top' },
      ],
    },
    {
      name: 'dense',
      label: 'Dense?',
      description:
        'If true, this row is compacted vertically. The parent list’s ' +
        'Dense setting already applies to every row.',
      component: Aglyn.FieldComponentType.SWITCH,
    },
    {
      name: 'disableGutters',
      label: 'Disable gutters?',
      description: 'If true, the left and right padding is removed.',
      component: Aglyn.FieldComponentType.SWITCH,
    },
    {
      name: 'disablePadding',
      label: 'Disable padding?',
      description: 'If true, all padding is removed.',
      component: Aglyn.FieldComponentType.SWITCH,
    },
  ],
}

export const presets: Aglyn.PresetSchema[] = [
  {
    $id: generatePresetId(ID),
    type: Aglyn.NodeType.PRESET,
    displayName: 'List Item',
    icon: { path: mdiFormatListText.path },
    category: Aglyn.ComponentCategory.DATA_DISPLAY,
    data: {
      $id: null,
      componentId: ID,
      pluginId: BUNDLE_ID,
      nodes: [
        {
          ...listItemTextPresets[0].data,
        },
      ],
    },
  },
]

export default ListItem
