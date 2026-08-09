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

import type { ExtendedMapperComponent } from '../vendor/data-driven-forms'
import optionIsEqualToValue from '../utils/option-is-equal-to-value'
import {
  FieldCheckbox,
  FieldColorPicker,
  FieldCssDimension,
  FieldCssGradient,
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
  color: 'primary',
}

/*
 * Each of these is `ExtendedMapperComponent` — `{ component, ...defaultProps }`
 * — and not the wider `FieldComponentMap`. That alias is the mapper's VALUE
 * type, so it also admits a bare `React.ElementType`, i.e. a string like
 * `'div'`; a spread of one is then TS2698 and no test could extend a preset
 * with `{ ...FIELD_MAP_SELECT, component: Select }` (AGL-1323).
 */

export const FIELD_MAP_SELECT: ExtendedMapperComponent = {
  size: fieldSharedOptions.size,
  component: FieldSelect,
  isClearable: true,
  variant: 'outlined',
  TextFieldProps: {
    color: fieldSharedOptions.color,
  },
  isOptionEqualToValue: optionIsEqualToValue,
}
export const FIELD_MAP_SWITCH: ExtendedMapperComponent = {
  color: fieldSharedOptions.color,
  // size: 'medium',
  component: FieldSwitch,
}
export const FIELD_MAP_TEXT_FIELD: ExtendedMapperComponent = {
  ...fieldSharedOptions,
  // size: 'small',
  component: FieldTextField,
}
/** Number box + unit picker for CSS length attributes (AGL-1219). */
export const FIELD_MAP_CSS_DIMENSION: ExtendedMapperComponent = {
  ...fieldSharedOptions,
  component: FieldCssDimension,
}
/** Fill type + angle + colour stops, persisted as one string (AGL-1331). */
export const FIELD_MAP_CSS_GRADIENT: ExtendedMapperComponent = {
  ...fieldSharedOptions,
  component: FieldCssGradient,
}
export const FIELD_MAP_TEXTAREA: ExtendedMapperComponent = {
  ...fieldSharedOptions,
  component: FieldTextarea,
}
export const FIELD_MAP_PLAIN_TEXT: ExtendedMapperComponent = {
  ...fieldSharedOptions,
  component: FieldPlainText,
}
export const FIELD_MAP_SLIDER: ExtendedMapperComponent = {
  ...fieldSharedOptions,
  component: FieldSlider,
}
export const FIELD_MAP_TIME_PICKER: ExtendedMapperComponent = {
  ...fieldSharedOptions,
  component: FieldTimePicker,
}
export const FIELD_MAP_DATE_PICKER: ExtendedMapperComponent = {
  ...fieldSharedOptions,
  component: FieldDatePicker,
}
export const FIELD_MAP_RADIO: ExtendedMapperComponent = {
  ...fieldSharedOptions,
  component: FieldRadio,
}
export const FIELD_MAP_CHECKBOX: ExtendedMapperComponent = {
  ...fieldSharedOptions,
  component: FieldCheckbox,
}
export const FIELD_MAP_FIELD_ARRAY: ExtendedMapperComponent = {
  component: FieldFieldArray,
}
export const FIELD_MAP_TABS: ExtendedMapperComponent = {
  color: fieldSharedOptions.color,
  component: FieldTabs,
}
export const FIELD_MAP_WIZARD: ExtendedMapperComponent = {
  component: FieldWizard,
}
export const FIELD_MAP_DUAL_LIST_SELECT: ExtendedMapperComponent = {
  component: FieldDualListSelect,
}
export const FIELD_MAP_ICON_PICKER: ExtendedMapperComponent = {
  size: fieldSharedOptions.size,
  component: FieldIconSelect,
  isClearable: true,
  isOptionEqualToValue: optionIsEqualToValue,
}
export const FIELD_MAP_COLOR_PICKER: ExtendedMapperComponent = {
  ...fieldSharedOptions,
  component: FieldColorPicker,
  FormControlProps: {
    ...fieldSharedOptions,
  },
}
export const FIELD_MAP_TOGGLE_BUTTON: ExtendedMapperComponent = {
  ...fieldSharedOptions,
  component: FieldToggleButton,
  FormControlProps: {
    ...fieldSharedOptions,
  },
}
export const FIELD_SUB_FORM: ExtendedMapperComponent = {
  ...fieldSharedOptions,
  component: FieldSubForm,
}
