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

import type { FieldComponentMap } from '../types'
import optionIsEqualToValue from '../utils/option-is-equal-to-value'
import {
  FieldCheckbox,
  FieldColorPicker,
  FieldDatePicker,
  FieldDualListSelect,
  FieldFieldArray,
  FieldIconSelect,
  FieldPlainText,
  FieldRadio,
  FieldSelect,
  FieldSlider,
  FieldSubForm,
  FieldSwitch,
  FieldTabs,
  FieldTextarea,
  FieldTextField,
  FieldTimePicker,
  FieldToggleButton,
  FieldWizard,
} from './dynamic-fields'

export const fieldSharedOptions = {
  size: 'small',
  color: 'secondary',
}

export const FIELD_MAP_SELECT: FieldComponentMap = {
  size: fieldSharedOptions.size,
  component: FieldSelect,
  isClearable: true,
  variant: 'outlined',
  TextFieldProps: {
    color: fieldSharedOptions.color,
  },
  isOptionEqualToValue: optionIsEqualToValue,
}
export const FIELD_MAP_SWITCH: FieldComponentMap = {
  color: fieldSharedOptions.color,
  // size: 'medium',
  component: FieldSwitch,
}
export const FIELD_MAP_TEXT_FIELD: FieldComponentMap = {
  ...fieldSharedOptions,
  // size: 'small',
  component: FieldTextField,
}
export const FIELD_MAP_TEXTAREA: FieldComponentMap = {
  ...fieldSharedOptions,
  component: FieldTextarea,
}
export const FIELD_MAP_PLAIN_TEXT: FieldComponentMap = {
  ...fieldSharedOptions,
  component: FieldPlainText,
}
export const FIELD_MAP_SLIDER: FieldComponentMap = {
  ...fieldSharedOptions,
  component: FieldSlider,
}
export const FIELD_MAP_TIME_PICKER: FieldComponentMap = {
  ...fieldSharedOptions,
  component: FieldTimePicker,
}
export const FIELD_MAP_DATE_PICKER: FieldComponentMap = {
  ...fieldSharedOptions,
  component: FieldDatePicker,
}
export const FIELD_MAP_RADIO: FieldComponentMap = {
  ...fieldSharedOptions,
  component: FieldRadio,
}
export const FIELD_MAP_CHECKBOX: FieldComponentMap = {
  ...fieldSharedOptions,
  component: FieldCheckbox,
}
export const FIELD_MAP_FIELD_ARRAY: FieldComponentMap = {
  component: FieldFieldArray,
}
export const FIELD_MAP_TABS: FieldComponentMap = {
  color: fieldSharedOptions.color,
  component: FieldTabs,
}
export const FIELD_MAP_WIZARD: FieldComponentMap = {
  component: FieldWizard,
}
export const FIELD_MAP_DUAL_LIST_SELECT: FieldComponentMap = {
  component: FieldDualListSelect,
}
export const FIELD_MAP_ICON_PICKER: FieldComponentMap = {
  size: fieldSharedOptions.size,
  component: FieldIconSelect,
  isClearable: true,
  isOptionEqualToValue: optionIsEqualToValue,
}
export const FIELD_MAP_COLOR_PICKER: FieldComponentMap = {
  ...fieldSharedOptions,
  component: FieldColorPicker,
  FormControlProps: {
    ...fieldSharedOptions,
  },
}
export const FIELD_MAP_TOGGLE_BUTTON: FieldComponentMap = {
  ...fieldSharedOptions,
  component: FieldToggleButton,
  FormControlProps: {
    ...fieldSharedOptions,
  },
}
export const FIELD_SUB_FORM: FieldComponentMap = {
  ...fieldSharedOptions,
  component: FieldSubForm,
}
