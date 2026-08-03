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
  mdiFormatListBulletedSquare,
} from '@aglyn/shared-data-mdi'
import MuiList, { type ListProps } from '@mui/material/List'
import ListSubheader from '@mui/material/ListSubheader'
import { createElement, forwardRef } from 'react'
import { BUNDLE_ID } from '../constants/bundle-common'
import { generatePresetId } from '../utils/generate-preset-id'
import {
  presets as listItemPresets,
  schema as listItemSchema,
} from './list-item'

// Component ids are persisted in screen documents; keep the legacy ids.
export const ID: Aglyn.ComponentId = 'muiList'

export interface ListElementProps extends Omit<ListProps, 'subheader'> {
  /** Sticky heading above the items; omitted entirely when blank. */
  subheader?: string
}

/**
 * List (https://mui.com/material-ui/react-list/).
 *
 * Wraps MUI's List only to turn the authored `subheader` string into a
 * real `ListSubheader`: MUI types the prop as a node, so a bare string
 * renders as unstyled text outside the list's own heading treatment.
 */
const List = forwardRef<HTMLUListElement, ListElementProps>((props, ref) => {
  const { subheader, ...rest } = props
  return createElement(MuiList, {
    ref,
    // ListSubheader defaults to `li`, which is what belongs inside the
    // `ul` List renders.
    subheader: subheader
      ? createElement(ListSubheader, null, subheader)
      : undefined,
    ...rest,
  })
})
List.displayName = 'AglynList'

export const schema: Aglyn.ComponentSchema<ListElementProps> = {
  $id: ID,
  pluginId: BUNDLE_ID,
  displayName: 'List',
  description: 'Vertical list of items, optionally under a sticky heading.',
  category: Aglyn.ComponentCategory.DATA_DISPLAY,
  icon: { path: mdiFormatListBulletedSquare.path },
  restrictChildren: [
    Aglyn.LinealDirectiveFlag.LIMIT_TO,
    {
      components: [listItemSchema.$id],
    },
  ],
  // The list had NO attributes at all: density and padding were only
  // reachable by hand-writing sx, which is not where authors look.
  attributes: [
    {
      name: 'subheader',
      label: 'Heading',
      description:
        'Sticky heading rendered above the items. Leave blank for none.',
      component: Aglyn.FieldComponentType.TEXT_FIELD,
    },
    {
      name: 'dense',
      label: 'Dense?',
      description:
        'If true, items are compacted vertically. Applies to every item ' +
        'in the list.',
      component: Aglyn.FieldComponentType.SWITCH,
    },
    {
      name: 'disablePadding',
      label: 'Disable padding?',
      description: 'If true, the padding above and below the list is removed.',
      component: Aglyn.FieldComponentType.SWITCH,
    },
  ],
}

export const presets: Aglyn.PresetSchema[] = [
  {
    $id: generatePresetId(ID),
    type: Aglyn.NodeType.PRESET,
    displayName: 'List',
    icon: { path: mdiFormatListBulletedSquare.path },
    category: Aglyn.ComponentCategory.DATA_DISPLAY,
    data: {
      $id: null,
      componentId: ID,
      pluginId: BUNDLE_ID,
      nodes: [
        {
          ...listItemPresets[0].data,
        },
        {
          ...listItemPresets[0].data,
        },
      ],
    },
  },
]

export default List
