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

import ComponentMapper from '@data-driven-forms/react-form-renderer/common-types/component-mapper'
// import muiComponentMapper from '@data-driven-forms/mui-component-mapper/component-mapper'

import { FieldComponent } from './types'
import FieldIconSelect from './components/FieldIconSelect'
import FieldSelect from './components/FieldSelect'
import FieldTextField from './components/FieldTextField'


export const componentMapper: ComponentMapper = {
  // ...muiComponentMapper,
  [FieldComponent.TEXT_FIELD]: FieldTextField,
  [FieldComponent.ICON_SELECT]: FieldIconSelect,
  [FieldComponent.SELECT]: FieldSelect,
}
