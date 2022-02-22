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

import type {ComparisonOperator} from '@aglyn/shared-data-types'


/**
 * Perform comparison operation to check provided equality operator. If no
 * operator is provided defaults to strict equality check
 * @param left - left-hand side operand for operation
 * @param right - right-hand side operand for operation
 * @param operator - provide js comparison operator syntax as string literal
 */
export function compare(
  left: unknown,
  right: unknown,
  operator: ComparisonOperator = '===',
): boolean {
  switch (operator) {
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
      return left > right
    case '===':
    default:
      return left === right
  }
}

export default compare
