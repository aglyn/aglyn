/**
 * @license
 * Copyright 2023 Aglyn LLC
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
  FEATURE_FLAG,
  FieldComponentType,
  LinealDirectiveFlag,
} from './foundation'
import { customAlphabet, urlAlphabet } from 'nanoid'

// eslint-disable-next-line @typescript-eslint/no-require-imports
const pkg = require('../../package.json') as { version: string; name: string }

export const version = pkg.version
export const namespace = pkg.name

export const ID_CHAR_LENGTH = 10
export const createIdUrlSafe = customAlphabet(urlAlphabet, ID_CHAR_LENGTH)

export { FEATURE_FLAG }

export { FieldComponentType }

export { LinealDirectiveFlag }

export enum ViewportWidth { //BesignerDeviceFlag
  SCALE = 0x1,
  RESPONSIVE = 0x2,
  XS = 0x3,
  SM = 0x4,
  MD = 0x5,
  LG = 0x6,
  XL = 0x7,
}
