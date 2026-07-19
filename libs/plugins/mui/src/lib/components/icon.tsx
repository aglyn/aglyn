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
import { getMdiIconFromId, mdiShapePlus } from '@aglyn/shared-data-mdi'
import { MdiIcon } from '@aglyn/shared-ui-jsx'
import Box from '@mui/material/Box'
import { forwardRef } from 'react'
import { BUNDLE_ID } from '../constants/bundle-common'
import { generatePresetId } from '../utils/generate-preset-id'

// Component ids are persisted in screen documents; never rename.
export const ID: Aglyn.ComponentId = 'icon'

export interface IconProps {
  /** mdi icon id from the picker (AGL-146). */
  iconId?: string
  /** Icon size in px; defaults to 24. */
  size?: number
  /** CSS color; defaults to the inherited text color. */
  color?: string
}

/**
 * Icon element (AGL-146): renders a picked mdi icon with size/color
 * controls; an empty pick shows a labeled placeholder so the element stays
 * selectable in the editor.
 */
const Icon = forwardRef<HTMLElement, IconProps>((props, ref) => {
  const { iconId, size, color, ...rest } = props
  const icon = iconId ? getMdiIconFromId(iconId) : undefined
  if (!icon?.path) {
    return (
      <Box
        ref={ref}
        {...rest}
        sx={{
          width: 48,
          height: 48,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          border: '1px dashed',
          borderColor: 'divider',
          borderRadius: 1,
          color: 'text.secondary',
          fontSize: 10,
          fontFamily: 'system-ui, sans-serif',
        }}
      >
        {'Icon'}
      </Box>
    )
  }
  return (
    <Box ref={ref} component="span" sx={{ display: 'inline-flex' }} {...rest}>
      <MdiIcon
        path={icon.path}
        sx={{
          fontSize: size && size > 0 ? size : 24,
          ...(color ? { color } : {}),
        }}
      />
    </Box>
  )
})
Icon.displayName = 'Icon'

export const schema: Aglyn.ComponentSchema<IconProps> = {
  $id: ID,
  pluginId: BUNDLE_ID,
  displayName: 'Icon',
  category: Aglyn.ComponentCategory.MEDIA,
  icon: {
    path: mdiShapePlus.path,
    sx: { color: '#7b1fa2' },
  },
  flags: {
    selfClosing: Aglyn.FEATURE_FLAG.ENABLED,
  },
  attributes: [
    {
      name: 'iconId',
      description: 'Pick any icon from the library.',
      component: Aglyn.FieldComponentType.ICON_PICKER,
      label: 'Icon',
    },
    {
      name: 'size',
      description: 'Icon size in pixels (default 24).',
      component: Aglyn.FieldComponentType.TEXT_FIELD,
      label: 'Size (px)',
    },
    {
      name: 'color',
      description: 'CSS color, e.g. #7b1fa2; empty inherits the text color.',
      component: Aglyn.FieldComponentType.TEXT_FIELD,
      label: 'Color',
    },
  ],
}

export const presets: Aglyn.PresetSchema[] = [
  {
    $id: generatePresetId(ID),
    type: Aglyn.NodeType.PRESET,
    displayName: 'Icon',
    pluginId: BUNDLE_ID,
    description: 'A single icon from the mdi library',
    category: Aglyn.ComponentCategory.MEDIA,
    icon: {
      path: mdiShapePlus.path,
      sx: { color: '#7b1fa2' },
    },
    data: {
      $id: null,
      componentId: ID,
      pluginId: BUNDLE_ID,
      props: {},
    },
  },
]

export default Icon
