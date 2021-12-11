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

import { _isBig } from './_is-big'
import { _isBool } from './_is-bool'
import { _isFnT } from './_is-fn-t'
import { _isNumT } from './_is-num-t'
import { _isObjT } from './_is-obj-t'
import { _isStrT } from './_is-str-t'
import { _isSymT } from './_is-sym-t'
import { _isUndT } from './_is-und-t'


export type Primitive = symbol | bigint | boolean | number | string | undefined
export type PrimitiveBasic = number | string | boolean
/**
 * Is literal type of primitive type
 *
 * @export
 * @param {*} val
 * @returns {val is Primitive}
 */
export function _isPrim(val: unknown): val is Primitive {
  return Boolean(
    _isSymT(val) ||
    _isBig(val) ||
    _isNumT(val) ||
    _isObjT(val) ||
    _isBool(val) ||
    _isStrT(val) ||
    _isFnT(val) ||
    _isUndT(val),
  )
}
