/**
 * @license
 * Copyright 2022 Aglyn LLC
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
import { mdiPageLayoutHeader } from '@aglyn/shared-ui-mdi-jsx'
import Toolbar from '@mui/material/AppBar'
import { PLUGIN_ID } from '../constants/common'
import { FIELD_COLOR_ALT1, FIELD_POSITION } from '../constants/field-presets'

export const ID: Aglyn.ComponentId = 'muiAppBar'

export const schema: Aglyn.ComponentSchema = {
  componentId: ID,
  pluginId: PLUGIN_ID,
  displayName: 'Toolbar',
  category: Aglyn.ComponentCategory.SURFACE,
  icon: {
    path: mdiPageLayoutHeader.path,
    sx: { color: '#2196f3' },
  },
  attributes: [FIELD_COLOR_ALT1, FIELD_POSITION],
}

export default Toolbar
