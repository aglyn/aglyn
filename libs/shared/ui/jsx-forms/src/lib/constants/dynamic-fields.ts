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
  TabsProps,
  TextareaProps,
  TextFieldProps,
  TimePickerProps,
  WizardProps,
} from '@data-driven-forms/mui-component-mapper'
import dynamic from 'next/dynamic'
import type { ColorPickerProps } from '../components/color-picker.component'
import type { IconSelectProps } from '../components/icon-select.component'
import type { ToggleButtonProps } from '../components/toggle-button.component'

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
export const FieldSelect = dynamic<SelectProps<any>>(
  () =>
    import('@data-driven-forms/mui-component-mapper/select').then(
      (mod) => mod.default,
    ),
  // {ssr: false},
)
export const FieldSwitch = dynamic<SwitchProps>(
  () =>
    import('@data-driven-forms/mui-component-mapper/switch').then(
      (mod) => mod.default,
    ),
  // {ssr: false},
)
export const FieldTextField = dynamic<TextFieldProps>(
  () =>
    import('@data-driven-forms/mui-component-mapper/text-field').then(
      (mod) => mod.default,
    ),
  // {ssr: false},
)
export const FieldTextarea = dynamic<TextareaProps>(
  () =>
    import('@data-driven-forms/mui-component-mapper/textarea').then(
      (mod) => mod.default,
    ),
  // {ssr: false},
)
export const FieldPlainText = dynamic<PlainTextProps>(
  () =>
    import('@data-driven-forms/mui-component-mapper/plain-text').then(
      (mod) => mod.default,
    ),
  // {ssr: false},
)
export const FieldSlider = dynamic<SliderProps>(
  () =>
    import('@data-driven-forms/mui-component-mapper/slider').then(
      (mod) => mod.default,
    ),
  // {ssr: false},
)
export const FieldTimePicker = dynamic<TimePickerProps>(
  () =>
    import('@data-driven-forms/mui-component-mapper/time-picker').then(
      (mod) => mod.default,
    ),
  // {ssr: false},
)
export const FieldDatePicker = dynamic<DatePickerProps<any, any>>(
  () =>
    import('@data-driven-forms/mui-component-mapper/date-picker').then(
      (mod) => mod.default,
    ),
  // {ssr: false},
)
export const FieldRadio = dynamic<RadioProps>(
  () =>
    import('@data-driven-forms/mui-component-mapper/radio').then(
      (mod) => mod.default,
    ),
  // {ssr: false},
)
export const FieldCheckbox = dynamic<CheckboxProps>(
  () =>
    import('@data-driven-forms/mui-component-mapper/checkbox').then(
      (mod) => mod.default,
    ),
  // {ssr: false},
)
export const FieldFieldArray = dynamic<FieldArrayProps>(
  () =>
    import('@data-driven-forms/mui-component-mapper/field-array').then(
      (mod) => mod.default,
    ),
  // {ssr: false},
)
export const FieldTabs = dynamic<TabsProps>(
  () =>
    import('@data-driven-forms/mui-component-mapper/tabs').then(
      (mod) => mod.default,
    ),
  // {ssr: false},
)
export const FieldWizard = dynamic<WizardProps>(
  () =>
    import('@data-driven-forms/mui-component-mapper/wizard').then(
      (mod) => mod.default,
    ),
  // {ssr: false},
)
export const FieldDualListSelect = dynamic<DualListSelectProps>(
  () =>
    import('@data-driven-forms/mui-component-mapper/dual-list-select').then(
      (mod) => mod.default,
    ),
  // {ssr: false},
)
export const FieldSubForm = dynamic<SubFormProps>(
  () =>
    import('@data-driven-forms/mui-component-mapper/sub-form').then(
      (mod) => mod.default,
    ),
  // {ssr: false},
)
