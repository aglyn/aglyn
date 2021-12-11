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


export enum ComponentsLinealDirectiveFlag {
  LIMIT_TO = 0x01,
  DISALLOW = 0x02,
}

export enum PropertyEditorFieldFlag {
  CHECKBOX = 'checkbox',
  DATE_PICKER = 'date-picker',
  ICON_SELECT = 'icon-select',
  RADIO = 'radio',
  SELECT = 'select',
  TEXT_FIELD = 'text-field',
  TEXTAREA = 'textarea',
  TIME_PICKER = 'time-picker',
}

export const DEFAULT_COMPONENT_ICON_ID = 'cube-outline'

export const DEFAULT_PROPS_FORM_SCHEMA = {
  fields: [
    {
      name: 'displayName',
      component: PropertyEditorFieldFlag.TEXT_FIELD,
      label: 'Display name',
      // variant: 'outlined',
    },
    {
      name: 'iconIds',
      component: PropertyEditorFieldFlag.ICON_SELECT,
      label: 'Icon',
      // variant: 'outlined',
    },
  ],
}
