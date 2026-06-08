/**
 * @license
 * Copyright 2026 Aglyn LLC
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

import { compare, type ComparisonOperator } from '../../operator'
import { _isNum } from './_is-num'


/**
 * Checks if the parameter has length greater than 0 or second parameter
 * @param leftOperand
 * @param rightOperand
 * @param operator
 */
export function _isLength<T>(
  leftOperand: Iterable<T> | ArrayLike<T> | number,
  rightOperand: Iterable<T> | ArrayLike<T> | number,
  operator: ComparisonOperator = '===',
): boolean {
  if (typeof leftOperand !== 'undefined') {
    const left = _isNum(leftOperand) ? leftOperand : leftOperand['length'] ?? 0
    const right = _isNum(rightOperand)
      ? rightOperand
      : rightOperand['length'] ?? 0
    return compare(left, right, operator)
  }
  return false
}

export default _isLength
