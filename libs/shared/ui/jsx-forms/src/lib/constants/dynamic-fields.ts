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

import dynamic from 'next/dynamic'

import type { ColorPickerProps } from '../components/color-picker.component'
import type { IconSelectProps } from '../components/icon-select.component'
import type { ToggleButtonProps } from '../components/toggle-button.component'
import type {
  CheckboxProps,
  DatePickerProps,
  DualListSelectProps,
  FieldArrayProps,
  PlainTextProps,
  RadioProps,
  SelectProps,
  SliderProps,
  SubFormProps,
  SwitchProps,
  TextFieldProps,
  TextareaProps,
  TimePickerProps,
  WizardProps,
} from '../mapper'

export const FieldIconSelect = dynamic<IconSelectProps>(
  () =>
    import('../components/icon-select.component').then((mod) => mod.default),
  { ssr: false },
)
export const FieldColorPicker = dynamic<ColorPickerProps>(
  () =>
    import('../components/color-picker.component').then((mod) => mod.default),
  { ssr: false },
)
export const FieldToggleButton = dynamic<ToggleButtonProps>(
  () =>
    import('../components/toggle-button.component').then((mod) => mod.default),
  { ssr: false },
)
export const FieldSelect = dynamic<SelectProps>(() =>
  import('../mapper/select').then((mod) => mod.default),
)
export const FieldSwitch = dynamic<SwitchProps>(() =>
  import('../mapper/switch').then((mod) => mod.default),
)
export const FieldTextField = dynamic<TextFieldProps>(() =>
  import('../mapper/text-field').then((mod) => mod.default),
)
export const FieldTextarea = dynamic<TextareaProps>(() =>
  import('../mapper/textarea').then((mod) => mod.default),
)
export const FieldPlainText = dynamic<PlainTextProps>(() =>
  import('../mapper/plain-text').then((mod) => mod.default),
)
export const FieldSlider = dynamic<SliderProps>(() =>
  import('../mapper/slider').then((mod) => mod.default),
)
export const FieldTimePicker = dynamic<TimePickerProps>(() =>
  import('../mapper/time-picker').then((mod) => mod.default),
)
export const FieldDatePicker = dynamic<DatePickerProps>(() =>
  import('../mapper/date-picker').then((mod) => mod.default),
)
export const FieldRadio = dynamic<RadioProps>(() =>
  import('../mapper/radio').then((mod) => mod.default),
)
export const FieldCheckbox = dynamic<CheckboxProps>(() =>
  import('../mapper/checkbox').then((mod) => mod.default),
)
export const FieldFieldArray = dynamic<FieldArrayProps>(() =>
  import('../mapper/field-array').then((mod) => mod.default),
)
export const FieldTabs = dynamic(() =>
  import('../mapper/tabs').then((mod) => mod.default),
)
export const FieldWizard = dynamic<WizardProps>(() =>
  import('../mapper/wizard').then((mod) => mod.default),
)
export const FieldDualListSelect = dynamic<DualListSelectProps>(() =>
  import('../mapper/dual-list-select').then((mod) => mod.default),
)
export const FieldSubForm = dynamic<SubFormProps>(() =>
  import('../mapper/sub-form').then((mod) => mod.default),
)
