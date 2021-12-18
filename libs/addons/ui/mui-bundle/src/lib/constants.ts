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

import {AglynComponentField, PropertyEditorFieldFlag} from '@aglyn/core-data-framework'


export const BUNDLE_ID = 'mui'

export const IS_OPTION_EQUAL_TO_VALUE = ((option: any, value: any) => option.value === value)

export const FIELD_CHILDREN: AglynComponentField = {
  name: 'children',
  description: 'The content of the component.',
  component: PropertyEditorFieldFlag.TEXT_FIELD,
  label: 'Content',
  variant: 'outlined',
  size: 'small',
}

export const FIELD_COLOR: AglynComponentField = {
  name: 'color',
  description: 'The color of the component. It supports those theme colors that make sense for this component.',
  component: PropertyEditorFieldFlag.SELECT,
  label: 'Theme color',
  variant: 'outlined',
  isClearable: true,
  size: 'small',
  isOptionEqualToValue: IS_OPTION_EQUAL_TO_VALUE,
  options: [
    {value: '', label: 'Default'},
    {value: 'inherit', label: 'Inherit'},
    {value: 'primary', label: 'Primary'},
    {value: 'secondary', label: 'Secondary'},
    {value: 'success', label: 'Success'},
    {value: 'error', label: 'Error'},
    {value: 'info', label: 'Info'},
    {value: 'warning', label: 'Warning'},
  ],
}

export const FIELD_DISABLED: AglynComponentField = {
  name: 'disabled',
  description: 'If true, the component is disabled.',
  component: PropertyEditorFieldFlag.SWITCH,
  label: 'Disabled?',
  variant: 'outlined',
}

export const FIELD_FULL_WIDTH: AglynComponentField = {
  name: 'fullWidth',
  description: 'If true, the button will take up the full width of its container.',
  component: PropertyEditorFieldFlag.SWITCH,
  label: 'Full width?',
  variant: 'outlined',
}

export const FIELD_SIZE: AglynComponentField = {
  name: 'size',
  description: 'The size of the component. small is equivalent to the dense button styling.',
  component: PropertyEditorFieldFlag.SELECT,
  label: 'Size',
  variant: 'outlined',
  isClearable: true,
  size: 'small',
  isOptionEqualToValue: IS_OPTION_EQUAL_TO_VALUE,
  options: [
    {value: '', label: 'Default'},
    {value: 'inherit', label: 'Inherit'},
    {value: 'small', label: 'Small'},
    {value: 'medium', label: 'Medium'},
    {value: 'large', label: 'Large'},
  ],
}
