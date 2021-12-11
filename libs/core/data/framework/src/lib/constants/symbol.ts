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

import { _isFnT } from '@aglyn/shared-util-guards'

// The Symbol used to tag the AglynObject-like types. If there is no native Symbol
// nor polyfill, then a plain number is used for performance.

export type SYMBOL_TYPE = symbol | number

export enum HexTag {
  x60103 = 0xEAC7,
  x60106 = 0xEACA,
  x60107 = 0xEACB,
  x60108 = 0xEACC,
  x60109 = 0xEACD,
  x60110 = 0xEACE,
  x60112 = 0xEAD0,
  x60113 = 0xEAD1,
  x60114 = 0xEAD2,
  x60115 = 0xEAD3,
  x60116 = 0xEAD4,
  x60119 = 0xEAD7,
  x60120 = 0xEAD8,
  x60128 = 0xEAE0,
  x60129 = 0xEAE1,
  x60130 = 0xEAE2,
  x60131 = 0xEAE3,
  x60132 = 0xEAE4,
}

export enum SymTag {
  MODULE = 'module',
  EXTENSION = 'extension',

  COMMAND_RESOLVER = 'commandResolver',
  COMMAND_LISTENER = 'commandListener',
  COMPONENT_ELEMENT = 'componentElement',
}

export const HexSym: Partial<Record<HexTag, SymTag>> = {
  [HexTag.x60106]: SymTag.MODULE,
  [HexTag.x60107]: SymTag.EXTENSION,

  [HexTag.x60108]: SymTag.COMMAND_RESOLVER,
  [HexTag.x60109]: SymTag.COMMAND_LISTENER,
  [HexTag.x60110]: SymTag.COMPONENT_ELEMENT,
}

const symAvail = Boolean(_isFnT(Symbol) && Symbol.for)
const symFor = (hex: HexTag) => Symbol.for(`${SymPrefix}${HexSym[hex]}`)

export const SymbolNamespace = 'aglyn'
export const SymbolSeparator = '.'
export const SymPrefix = `${SymbolNamespace}${SymbolSeparator}`
export const FieldPrefix = 'ßß'

export const TYPE_OF = 'ßßtypeof'
export const TYPE_KIND = 'ßßkind'

export let MODULE_TYPE: SYMBOL_TYPE = HexTag.x60106
export type MODULE_TYPE = SYMBOL_TYPE | typeof MODULE_TYPE

export let EXTENSION_TYPE: SYMBOL_TYPE = HexTag.x60107
export type EXTENSION_TYPE = SYMBOL_TYPE | typeof EXTENSION_TYPE

export let COMMAND_RESOLVER_TYPE: SYMBOL_TYPE = HexTag.x60108
export type COMMAND_RESOLVER_TYPE = typeof COMMAND_RESOLVER_TYPE

export let COMMAND_LISTENER_TYPE: SYMBOL_TYPE = HexTag.x60109
export type COMMAND_LISTENER_TYPE = typeof COMMAND_LISTENER_TYPE

export let COMPONENT_ELEMENT_TYPE: SYMBOL_TYPE = HexTag.x60110
export type COMPONENT_ELEMENT_TYPE = typeof COMPONENT_ELEMENT_TYPE

if (symAvail) {
  MODULE_TYPE = symFor(MODULE_TYPE)
  EXTENSION_TYPE = symFor(EXTENSION_TYPE)

  COMMAND_RESOLVER_TYPE = symFor(COMMAND_RESOLVER_TYPE)
  COMMAND_LISTENER_TYPE = symFor(COMMAND_LISTENER_TYPE)
  COMPONENT_ELEMENT_TYPE = symFor(COMPONENT_ELEMENT_TYPE)
}
