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

import {componentMapper as muiComponentMapper} from '@data-driven-forms/mui-component-mapper'
import Select from '@data-driven-forms/mui-component-mapper/select'
import Switch from '@data-driven-forms/mui-component-mapper/switch'
import TextField from '@data-driven-forms/mui-component-mapper/text-field'
import {ComponentMapper, componentTypes} from '@data-driven-forms/react-form-renderer'
import FieldIconSelect from './components/field-icon-select'
// import FieldSelect from './components/field-select'
// import FieldSwitch from './components/field-switch'
// import FieldTextField from './components/field-text-field'

export const IS_OPTION_EQUAL_TO_VALUE = ((option: any, value: any) => option.value === value)

export const PropertyEditorFieldFlag = {
  ...componentTypes,
  ICON_SELECT: 'icon-select',
}

export const componentMapper: ComponentMapper = {
  ...muiComponentMapper,
  // [PropertyEditorFieldFlag.TEXT_FIELD]: FieldTextField,
  // [PropertyEditorFieldFlag.TEXTAREA]: FieldTextField,
  [PropertyEditorFieldFlag.SELECT]: {
    component: Select,
    isClearable: true,
    size: 'small',
    variant: 'outlined',
    TextFieldProps: {
      color: 'secondary',
    },
    isOptionEqualToValue: IS_OPTION_EQUAL_TO_VALUE,
  },
  [PropertyEditorFieldFlag.SWITCH]: {
    component: Switch,
    size: 'medium',
    color: 'secondary',

  },
  [PropertyEditorFieldFlag.TEXT_FIELD]: {
    component: TextField,
    size: 'small',
    color: 'secondary',
  },
  [PropertyEditorFieldFlag.ICON_SELECT]: {
    component: FieldIconSelect,
    isClearable: true,
    size: 'small',
    isOptionEqualToValue: IS_OPTION_EQUAL_TO_VALUE,
  },
  // [PropertyEditorFieldFlag.SELECT]: FieldSelect,
  // [PropertyEditorFieldFlag.SWITCH]: FieldSwitch,
}
