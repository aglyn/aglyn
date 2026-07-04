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

import {
  AglynAttributeSchema,
  FieldComponentType,
} from '@aglyn/aglyn'

export const FIELD_COLOR: AglynAttributeSchema = {
  name: 'color',
  description:
    'The color of the component. It supports those theme colors that make sense for this component.',
  component: FieldComponentType.SELECT,
  label: 'Theme color',
  options: [
    { value: '', label: 'Default' },
    { value: 'inherit', label: 'Inherit' },
    { value: 'primary', label: 'Primary' },
    { value: 'secondary', label: 'Secondary' },
    { value: 'success', label: 'Success' },
    { value: 'error', label: 'Error' },
    { value: 'info', label: 'Info' },
    { value: 'warning', label: 'Warning' },
  ],
}
export const FIELD_COLOR_ALT1: AglynAttributeSchema = {
  ...FIELD_COLOR,
  options: [
    { value: '', label: 'Default' },
    { value: 'inherit', label: 'Inherit' },
    { value: 'transparent', label: 'Transparent' },
    { value: 'primary', label: 'Primary' },
    { value: 'secondary', label: 'Secondary' },
    { value: 'tertiary', label: 'Tertiary' },
  ],
}
export const FIELD_DISABLED: AglynAttributeSchema = {
  name: 'disabled',
  description: 'If true, the component is disabled.',
  component: FieldComponentType.SWITCH,
  label: 'Disabled?',
}
export const FIELD_FULL_WIDTH: AglynAttributeSchema = {
  name: 'fullWidth',
  description:
    'If true, the button will take up the full width of its container.',
  component: FieldComponentType.SWITCH,
  label: 'Full width?',
}
export const FIELD_DISABLE_GUTTERS: AglynAttributeSchema = {
  name: 'disableGutters',
  description: 'If true, disables gutter padding.',
  component: FieldComponentType.SWITCH,
  label: 'Disable gutters?',
}
export const FIELD_SIZE: AglynAttributeSchema = {
  name: 'size',
  description:
    'The size of the component. small is equivalent to the dense button styling.',
  component: FieldComponentType.SELECT,
  label: 'Size',
  options: [
    { value: '', label: 'Default' },
    { value: 'inherit', label: 'Inherit' },
    { value: 'small', label: 'Small' },
    { value: 'medium', label: 'Medium' },
    { value: 'large', label: 'Large' },
  ],
}
export const FIELD_POSITION: AglynAttributeSchema = {
  name: 'position',
  description:
    'The positioning type. The behavior of the different options is described in the MDN web docs. Note: sticky is not universally supported and will fall back to static when unavailable.',
  component: FieldComponentType.SELECT,
  label: 'Position',
  options: [
    { value: '', label: 'Default' },
    { value: 'absolute', label: 'Absolute' },
    { value: 'fixed', label: 'Fixed' },
    { value: 'relative', label: 'Relative' },
    { value: 'static', label: 'Static' },
    { value: 'sticky', label: 'Sticky' },
  ],
}
