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

import { length } from '@aglyn/shared/util/tools'
import { _isNum } from './_is-num'


/**
 * Checks if the parameter has length greater than 0 or second parameter
 * @export
 * @template T
 * @param leftValue
 * @param rightValue
 * @param {('>'|'<'|'=')} [operator]
 * @return {*}  {boolean}
 */
export function _isLength<T>(
  leftValue: Iterable<T> | ArrayLike<T> | number,
  rightValue: number = 0,
  operator: '>' | '<' | '=' | '==' | '===' | '<=' | '>=' = '===',
): boolean {
  if (leftValue) {
    const left = _isNum(leftValue) ? leftValue : length(leftValue)
    const right = _isNum(rightValue) ? rightValue : length(rightValue)
    switch (operator) {
      case '=':
      case '===':
        return left === right
      case '==':
        // noinspection EqualityComparisonWithCoercionJS
        return left == right
      case '<':
        return left < right
      case '<=':
        return left <= right
      case '>=':
        return left >= right
      case '>':
      default:
        return left > right
    }
  }
  return false
}
