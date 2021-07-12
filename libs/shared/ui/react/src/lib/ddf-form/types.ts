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

import type { ComponentType } from 'react'
import type { FormRendererProps as DdfFormRendererProps } from '@data-driven-forms/react-form-renderer/form-renderer'
import type DdfSchema from '@data-driven-forms/react-form-renderer/common-types/schema'
import type DdfField from '@data-driven-forms/react-form-renderer/common-types/field'


export type FormSchema = DdfSchema
export type FormField = DdfField
export type FormTemplate = ComponentType<DdfFormRendererProps>

export enum FieldComponent {
  CHECKBOX = 'checkbox',
  DATE_PICKER = 'date-picker',
  ICON_SELECT = 'icon-select',
  RADIO = 'radio',
  SELECT = 'select',
  TEXT_FIELD = 'text-field',
  TEXTAREA = 'textarea',
  TIME_PICKER = 'time-picker',
}
