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
import { mdiMagnify } from '@aglyn/shared-data-mdi'
import IconButton from '@mui/material/IconButton'
import InputAdornment from '@mui/material/InputAdornment'
import TextField from '@mui/material/TextField'
import { MdiIcon } from '@aglyn/shared-ui-jsx'
import { forwardRef } from 'react'
import { BUNDLE_ID } from '../constants/bundle-common'
import { generatePresetId } from '../utils/generate-preset-id'

// Component ids are persisted in screen documents; never rename.
export const ID: Aglyn.ComponentId = 'searchBox'

export interface SearchBoxProps {
  placeholder?: string
}

/**
 * Site search box (AGL-88): a plain GET form to the tenant's /search page,
 * so it works with zero JavaScript and is inert in the besigner (the
 * console has no /search route to submit to; navigation there is a no-op
 * form post the editor never triggers).
 */
const SearchBox = forwardRef<HTMLFormElement, SearchBoxProps>(
  (props, ref) => {
    const { placeholder, ...rest } = props
    return (
      <form ref={ref} action="/search" method="get" role="search" {...rest}>
        <TextField
          name="q"
          size="small"
          placeholder={placeholder || 'Search…'}
          slotProps={{
            input: {
              endAdornment: (
                <InputAdornment position="end">
                  <IconButton type="submit" size="small" aria-label="search">
                    <MdiIcon path={mdiMagnify.path} fontSize="small" />
                  </IconButton>
                </InputAdornment>
              ),
            },
          }}
        />
      </form>
    )
  },
)
SearchBox.displayName = 'AglynSearchBox'

export const schema: Aglyn.ComponentSchema<SearchBoxProps> = {
  $id: ID,
  pluginId: BUNDLE_ID,
  displayName: 'Search Box',
  category: Aglyn.ComponentCategory.FORMS,
  icon: { path: mdiMagnify.path, sx: { color: '#455a64' } },
  flags: { selfClosing: Aglyn.FEATURE_FLAG.ENABLED },
  attributes: [
    {
      name: 'placeholder',
      description: 'Placeholder text inside the search field.',
      component: Aglyn.FieldComponentType.TEXT_FIELD,
      label: 'Placeholder',
    },
  ],
}

export const presets: Aglyn.PresetSchema[] = [
  {
    $id: generatePresetId(ID),
    type: Aglyn.NodeType.PRESET,
    displayName: 'Search Box',
    pluginId: BUNDLE_ID,
    description: 'Search field that opens the site search page',
    category: Aglyn.ComponentCategory.FORMS,
    icon: { path: mdiMagnify.path, sx: { color: '#455a64' } },
    data: {
      $id: null,
      componentId: ID,
      pluginId: BUNDLE_ID,
      props: {},
    },
  },
]

export default SearchBox
