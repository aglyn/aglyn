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

export enum FieldComponentType {
  TEXT_FIELD = 'text-field',
  FIELD_ARRAY = 'field-array',
  CHECKBOX = 'checkbox',
  SUB_FORM = 'sub-form',
  RADIO = 'radio',
  TABS = 'tabs',
  TAB_ITEM = 'tab-item',
  DATE_PICKER = 'date-picker',
  TIME_PICKER = 'time-picker',
  ICON_PICKER = 'icon-picker',
  WIZARD = 'wizard',
  SWITCH = 'switch',
  TEXTAREA = 'textarea',
  SELECT = 'select',
  PLAIN_TEXT = 'plain-text',
  BUTTON = 'button',
  INPUT_ADDON_GROUP = 'input-addon-group',
  INPUT_ADDON_BUTTON_GROUP = 'input-addon-button-group',
  DUAL_LIST_SELECT = 'dual-list-select',
  SLIDER = 'slider',
}

export enum FieldValidatorType {
  REQUIRED = 'required',
  MIN_LENGTH = 'min-length',
  MAX_LENGTH = 'max-length',
  EXACT_LENGTH = 'exact-length',
  MIN_ITEMS = 'min-items',
  MIN_NUMBER_VALUE = 'min-number-value',
  MAX_NUMBER_VALUE = 'max-number-value',
  PATTERN = 'pattern',
  URL = 'url',
}

export enum FieldDataType {
  INTEGER = 'integer',
  FLOAT = 'float',
  NUMBER = 'number',
  BOOLEAN = 'boolean',
  STRING = 'string'
}
