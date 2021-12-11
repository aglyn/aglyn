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

import { _isArr } from './_is-arr'
import { _isNull } from './_is-null'
import { _isObjT } from './_is-obj-t'


/**
 * Is actually a dictionary object (e.g. key:value), but not
 * an array or null
 *
 * @export
 * @param {*} val
 * @param array
 * @returns {val is Object}
 */
export function _isObj(val: unknown, array = false): val is Record<string, unknown> {
  return !_isNull(val) && _isObjT(val) && (!array ? !_isArr(val) : true)
}
