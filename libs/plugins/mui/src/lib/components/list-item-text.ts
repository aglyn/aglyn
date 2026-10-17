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
  mdiFormatListChecks,
} from '@aglyn/shared-data-mdi'
import MuiListItemText, {
  type ListItemTextProps,
} from '@mui/material/ListItemText'
import { createElement, forwardRef } from 'react'
import { BUNDLE_ID } from '../constants/bundle-common'
import { generatePresetId } from '../utils/generate-preset-id'

// Component ids are persisted in screen documents; keep the legacy ids.
export const ID: Aglyn.ComponentId = 'muiListItemText'

/**
 * The colors the secondary words can take: the theme's muted text color
 * (MUI's own default), or the color of the row around them.
 */
export const LIST_ITEM_TEXT_SECONDARY_COLORS = ['textSecondary', 'inherit'] as const
export type ListItemTextSecondaryColor =
  (typeof LIST_ITEM_TEXT_SECONDARY_COLORS)[number]

export interface ListItemTextElementProps extends ListItemTextProps {
  /**
   * The secondary words' color. MUI draws them in the theme's
   * `text.secondary`, which is chosen for the page's own background, so on
   * a band painted in a brand color they nearly vanish. `inherit` draws them
   * in the color the row inherits, as the primary words already are.
   */
  secondaryColor?: ListItemTextSecondaryColor
}

/**
 * List Item Text (https://mui.com/material-ui/api/list-item-text/).
 *
 * Wraps MUI's ListItemText only to turn the authored `secondaryColor` into
 * the secondary slot's Typography `color`, which MUI otherwise fixes at
 * `textSecondary`.
 */
const ListItemText = forwardRef<HTMLDivElement, ListItemTextElementProps>(
  (props, ref) => {
    const { secondaryColor, slotProps, ...rest } = props
    const own = slotProps?.secondary
    return createElement(MuiListItemText, {
      ref,
      ...rest,
      slotProps:
        secondaryColor === 'inherit'
          ? {
              ...slotProps,
              secondary: {
                ...(typeof own === 'object' ? own : {}),
                color: 'inherit',
              },
            }
          : slotProps,
    })
  },
)
ListItemText.displayName = 'AglynListItemText'

export const schema: Aglyn.ComponentSchema<ListItemTextElementProps> = {
  $id: ID,
  pluginId: BUNDLE_ID,
  displayName: 'List Item Text',
  description: 'The primary and secondary text pair inside a list row.',
  category: Aglyn.ComponentCategory.DATA_DISPLAY,
  icon: { path: mdiFormatListChecks.path },
  // Text lives in `primary`/`secondary` (not `children`), so this component
  // exposes its own text fields instead of FIELD_TEXT_CONTENT.
  flags: {
    // Static: may sit in a subtree that keeps its server HTML (AGL-3581).
    lazyHydration: Aglyn.FEATURE_FLAG.ENABLED,
    // …and MUI reads `children` ONLY as a fallback for a missing `primary`
    // (`primary = primaryProp != null ? primaryProp : children`), so with a
    // primary set — which every preset and every authored row has — a node
    // dropped in here is discarded at render with no warning. Same shape as
    // the Markdown block that swallowed three /press screenshots
    // (AGL-1388): the row's text is its attributes, not its child list.
    dropping: Aglyn.FEATURE_FLAG.DISABLED,
  },
  attributes: [
    {
      name: 'primary',
      description: 'The main content text.',
      component: Aglyn.FieldComponentType.TEXTAREA,
      label: 'Primary text',
    },
    {
      name: 'secondary',
      description: 'The secondary content text.',
      component: Aglyn.FieldComponentType.TEXTAREA,
      label: 'Secondary text',
    },
    {
      name: 'secondaryColor',
      description:
        'Muted draws the secondary text in the theme’s quieter text color, ' +
        'made for the page background. On a band painted in a brand color, ' +
        'pick Same as the primary text so it reads in the band’s own text ' +
        'color.',
      component: Aglyn.FieldComponentType.SELECT,
      label: 'Secondary text color',
      options: [
        { value: 'textSecondary', label: 'Muted (default)' },
        { value: 'inherit', label: 'Same as the primary text' },
      ],
    },
    {
      name: 'inset',
      description:
        'Indents the text to line up with rows that have an icon or ' +
        'avatar, so a mixed list keeps one text column.',
      component: Aglyn.FieldComponentType.SWITCH,
      label: 'Inset?',
    },
  ],
}

export const presets: Aglyn.PresetSchema[] = [
  {
    $id: generatePresetId(ID),
    type: Aglyn.NodeType.PRESET,
    displayName: 'List Item Text',
    icon: { path: mdiFormatListChecks.path },
    category: Aglyn.ComponentCategory.DATA_DISPLAY,
    data: {
      $id: null,
      componentId: ID,
      pluginId: BUNDLE_ID,
      props: {
        primary: 'Item Primary',
        secondary: 'This is the secondary',
      },
    },
  },
]

export default ListItemText
