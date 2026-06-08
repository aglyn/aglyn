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

import type { ComponentMapper } from '../vendor/data-driven-forms'
import {
  FIELD_MAP_CHECKBOX,
  FIELD_MAP_COLOR_PICKER,
  FIELD_MAP_DATE_PICKER,
  FIELD_MAP_DUAL_LIST_SELECT,
  FIELD_MAP_FIELD_ARRAY,
  FIELD_MAP_ICON_PICKER,
  FIELD_MAP_PLAIN_TEXT,
  FIELD_MAP_RADIO,
  FIELD_MAP_SELECT,
  FIELD_MAP_SLIDER,
  FIELD_MAP_SWITCH,
  FIELD_MAP_TABS,
  FIELD_MAP_TEXT_FIELD,
  FIELD_MAP_TEXTAREA,
  FIELD_MAP_TIME_PICKER,
  FIELD_MAP_TOGGLE_BUTTON,
  FIELD_MAP_WIZARD,
  FIELD_SUB_FORM,
} from './field-configurations'
import { FieldComponentType } from './flags'

export const componentMapper: ComponentMapper = {
  [FieldComponentType.SELECT]: FIELD_MAP_SELECT,
  [FieldComponentType.SUB_FORM]: FIELD_SUB_FORM,
  [FieldComponentType.SWITCH]: FIELD_MAP_SWITCH,
  [FieldComponentType.TEXT_FIELD]: FIELD_MAP_TEXT_FIELD,
  [FieldComponentType.TEXTAREA]: FIELD_MAP_TEXTAREA,
  [FieldComponentType.PLAIN_TEXT]: FIELD_MAP_PLAIN_TEXT,
  [FieldComponentType.SLIDER]: FIELD_MAP_SLIDER,
  [FieldComponentType.TIME_PICKER]: FIELD_MAP_TIME_PICKER,
  [FieldComponentType.DATE_PICKER]: FIELD_MAP_DATE_PICKER,
  [FieldComponentType.RADIO]: FIELD_MAP_RADIO,
  [FieldComponentType.CHECKBOX]: FIELD_MAP_CHECKBOX,
  [FieldComponentType.FIELD_ARRAY]: FIELD_MAP_FIELD_ARRAY,
  [FieldComponentType.TABS]: FIELD_MAP_TABS,
  [FieldComponentType.WIZARD]: FIELD_MAP_WIZARD,
  [FieldComponentType.DUAL_LIST_SELECT]: FIELD_MAP_DUAL_LIST_SELECT,
  [FieldComponentType.ICON_PICKER]: FIELD_MAP_ICON_PICKER,
  [FieldComponentType.COLOR_PICKER]: FIELD_MAP_COLOR_PICKER,
  [FieldComponentType.TOGGLE_BUTTON]: FIELD_MAP_TOGGLE_BUTTON,
}

export const simpleComponentMapper = {
  [FieldComponentType.SELECT]: FIELD_MAP_SELECT,
  [FieldComponentType.SUB_FORM]: FIELD_SUB_FORM,
  [FieldComponentType.SWITCH]: FIELD_MAP_SWITCH,
  [FieldComponentType.TEXT_FIELD]: FIELD_MAP_TEXT_FIELD,
  [FieldComponentType.TEXTAREA]: FIELD_MAP_TEXTAREA,
}

export const dateTimeComponentMapper = {
  [FieldComponentType.TIME_PICKER]: FIELD_MAP_TIME_PICKER,
  [FieldComponentType.DATE_PICKER]: FIELD_MAP_DATE_PICKER,
}

export const optionComponentMapper = {
  [FieldComponentType.SELECT]: FIELD_MAP_SELECT,
  [FieldComponentType.SWITCH]: FIELD_MAP_SWITCH,
  [FieldComponentType.RADIO]: FIELD_MAP_RADIO,
  [FieldComponentType.CHECKBOX]: FIELD_MAP_CHECKBOX,
  [FieldComponentType.DUAL_LIST_SELECT]: FIELD_MAP_DUAL_LIST_SELECT,
}

export const pickerComponentMapper = {
  [FieldComponentType.TIME_PICKER]: FIELD_MAP_TIME_PICKER,
  [FieldComponentType.DATE_PICKER]: FIELD_MAP_DATE_PICKER,
  [FieldComponentType.ICON_PICKER]: FIELD_MAP_ICON_PICKER,
  [FieldComponentType.COLOR_PICKER]: FIELD_MAP_COLOR_PICKER,
}
