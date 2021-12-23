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

import type {AglynComponentSchema, ComponentId} from '@aglyn/core-data-framework'
import {mdiFormatListChecks} from '@aglyn/shared-ui-mdi-jsx'
import ListItemText, {type ListItemTextProps} from '@mui/material/ListItemText'
import {BUNDLE_ID} from '../constants/bundle-common'
import {generateTemplateId} from '../utils/generate-template-id'


const ID: ComponentId = 'list-item-text'

export const schema: AglynComponentSchema<ListItemTextProps> = {
  componentId: ID,
  bundleId: BUNDLE_ID,
  metadata: {
    displayName: 'List Item Text',
    iconPath: mdiFormatListChecks.path,
  },
  templates: [
    {
      id: generateTemplateId(ID),
      label: 'List Item Text',
      iconPath: mdiFormatListChecks.path,
      data: {
        componentId: ID,
        bundleId: BUNDLE_ID,
        props: {
          primary: 'Item Primary',
          secondary: 'This is the secondary',
        },
      },
    },
  ],
}

export default ListItemText
