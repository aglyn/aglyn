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

import { _isNum, _isStrT } from '@aglyn/shared/util/guards'


/**
 * Ensure and parse any value to a number
 *
 * @export
 * @param {*} val the value to parse into a number
 * @param {*} [elseT] returns this if parsing fails
 * @param {number} [radix] only necessary if value is of type string
 * @returns {(number | typeof elseT)}
 */
export function toNum(val: any, elseT?: any, radix?: number): number | typeof elseT {
  const num = _isNum(radix) && _isStrT(val) ? parseInt(val, radix) : Number(val)
  return isNaN(num) ? elseT ?? 0 : num
}
