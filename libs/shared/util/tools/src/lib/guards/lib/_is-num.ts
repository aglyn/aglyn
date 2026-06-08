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

import { _isStrT } from './_is-str-t'

/**
 * Is value a number, allows even if string (e.g. "6" vs 6)
 *
 * @export
 * @param {*} val
 * @param {boolean} [noStr]
 * @returns {val is number}
 */
export function _isNum(val: unknown, noStr?: boolean): val is number {
  return noStr && _isStrT(val) ? false : !isNaN(Number(val))
}
export default _isNum
