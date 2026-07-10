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

/**
 * Aglyn's MUI component mapper for data-driven-forms.
 *
 * Ported from `@data-driven-forms/mui-component-mapper` (Apache-2.0), which
 * still targets MUI v5, and rewritten against the current MUI APIs (Grid
 * `size`, `slotProps`, `ListItemButton`, x-date-pickers slots) so the
 * patch-package override of the upstream mapper is no longer needed (AGL-226).
 */

export { default as Checkbox, SingleCheckbox, type CheckboxProps, type SingleCheckboxProps } from './checkbox'
export { default as DatePicker, type DatePickerProps } from './date-picker'
export { default as DualListSelect, type DualListSelectProps } from './dual-list-select'
export { default as FieldArray, DynamicArray, type FieldArrayProps } from './field-array'
export { default as FormFieldGrid, type FormFieldGridProps } from './form-field-grid'
export { default as MultipleChoiceList, type MultipleChoiceListProps } from './multiple-choice-list'
export { default as PlainText, type PlainTextProps } from './plain-text'
export { default as Radio, type RadioProps } from './radio'
export { default as Select, type SelectProps } from './select'
export { default as Slider, type SliderProps } from './slider'
export { default as SubForm, type SubFormProps } from './sub-form'
export { default as Switch, type SwitchProps } from './switch'
export { default as Tabs, FormTabs, type FormTabsProps } from './tabs'
export { default as TextField, type TextFieldProps } from './text-field'
export { default as Textarea, type TextareaProps } from './textarea'
export { default as TimePicker, type TimePickerProps } from './time-picker'
export { default as Wizard, type WizardProps } from './wizard'
export type { BaseFieldProps, OptionValue, SelectOption, SelectValue } from './types'
export { default as validationError, type ExtendedFieldMeta } from './validation-error'
