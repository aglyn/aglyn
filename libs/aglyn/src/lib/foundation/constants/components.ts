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

import type { AppUUN } from '../definitions/app.types'
import {
  type AglynComponentPropsFormSchema,
  FieldComponentType,
  type IAglynComponentsController,
  LinealDirectiveFlag,
} from '../definitions/components.types'

// export { FieldComponentType }

export { LinealDirectiveFlag as ComponentsLinealDirectiveFlag }

export enum ComponentCategory {
  INPUT = 'Input',
  SURFACE = 'Surface',
  NAVIGATION = 'Navigation',
  LAYOUT = 'Layout',
  DATA_DISPLAY = 'Data Display',
  TEXT = 'Text',
  UNCATEGORIZED = 'Uncategorized',
  ALL = 'All',
}

export const _INTERNAL_COMPONENTS_: Map<AppUUN, IAglynComponentsController> =
  new Map()
export const ELEMENT_ID_LENGTH = 10

export const DEFAULT_ATTRIBUTES_SCHEMA: AglynComponentPropsFormSchema = [
  // {
  //   name: 'iconId',
  //   component: FieldComponentType.ICON_SELECT,
  //   label: 'Icon',
  // },
  // {
  //   name: 'displayName',
  //   component: FieldComponentType.TEXT_FIELD,
  //   label: 'Display name',
  //   // variant: 'outlined',
  // },
  {
    name: 'children',
    description: 'The content of the component.',
    component: FieldComponentType.TEXT_FIELD,
    label: 'Content',
    size: 'small',
  },
]
