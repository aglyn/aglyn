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

import { customAlphabet, urlAlphabet } from 'nanoid'

const pkg = require('../../package.json')

export const version = pkg.version
export const namespace = pkg.name

export const ID_CHAR_LENGTH = 10
export const createIdUrlSafe = customAlphabet(urlAlphabet, ID_CHAR_LENGTH)

export enum FEATURE_FLAG {
  UNKNOWN,
  DEFAULT = 1,
  ENABLED = 1 << 1,
  DISABLED = 1 << 2,
  ENABLED_DEFAULT = DEFAULT | ENABLED,
  DISABLED_DEFAULT = DEFAULT | DISABLED,
}

export enum FieldComponentType {
  BUTTON = 'button',
  BUTTON_GROUP = 'button-group',
  CHECKBOX = 'checkbox',
  COLOR_PICKER = 'color-picker',
  DATE_PICKER = 'date-picker',
  DUAL_LIST_SELECT = 'dual-list-select',
  FIELD_ARRAY = 'field-array',
  ICON_PICKER = 'icon-picker',
  INPUT_ADDON_BUTTON_GROUP = 'input-addon-button-group',
  INPUT_ADDON_GROUP = 'input-addon-group',
  PLAIN_TEXT = 'plain-text',
  RADIO = 'radio',
  SELECT = 'select',
  SLIDER = 'slider',
  SUB_FORM = 'sub-form',
  SWITCH = 'switch',
  TAB_ITEM = 'tab-item',
  TABS = 'tabs',
  TEXT_FIELD = 'text-field',
  TEXTAREA = 'textarea',
  TIME_PICKER = 'time-picker',
  TOGGLE_BUTTON = 'toggle-button',
  WIZARD = 'wizard',
}

export enum LinealDirectiveFlag {
  LIMIT_TO = 'limitedTo',
  DISALLOW = 'forbid',
}

export enum ViewportWidth { //BesignerDeviceFlag
  SCALE = 0x1,
  RESPONSIVE = 0x2,
  XS = 0x3,
  SM = 0x4,
  MD = 0x5,
  LG = 0x6,
  XL = 0x7,
}
