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

import { _isFnT } from '@aglyn/shared/util/guards'


// The Symbol used to tag the AglynObject-like types. If there is no native Symbol
// nor polyfill, then a plain number is used for performance.

export type TAG_TYPE = symbol | number

export enum Hex {
  x60103 = 0xeac7,
  x60106 = 0xeaca,
  x60107 = 0xeacb,
  x60108 = 0xeacc,
  x60109 = 0xeacd,
  x60110 = 0xeace,
  x60112 = 0xead0,
  x60113 = 0xead1,
  x60114 = 0xead2,
  x60115 = 0xead3,
  x60116 = 0xead4,
  x60119 = 0xead7,
  x60120 = 0xead8,
  x60128 = 0xeae0,
  x60129 = 0xeae1,
  x60130 = 0xeae2,
  x60131 = 0xeae3,
  x60132 = 0xeae4,
}

const useSym = Boolean(_isFnT(Symbol) && Symbol.for)

export const TypeOf = 'ßßtypeof'
export const TypeKind = 'ßßkind'

export const APP_TYPE: TAG_TYPE = useSym ? Symbol.for('aglyn.app') : Hex.x60103
export const MODULE_TYPE: TAG_TYPE = useSym ? Symbol.for('aglyn.module') : Hex.x60106
export const COMMAND_TYPE: TAG_TYPE = useSym ? Symbol.for('aglyn.command') : Hex.x60109
export const EXTENSION_TYPE: TAG_TYPE = useSym ? Symbol.for('aglyn.extension') : Hex.x60107
