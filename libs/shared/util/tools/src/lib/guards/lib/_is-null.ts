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

/**
 * Check if a value is of primitive `null` literal type. The `typeof value`
 * value on a `null` literal will equal a string equal to `'object'`.
 * @example
 * // Shortcuts the following equality checks
 * value === null && typeof value === 'object'
 */
export function _isNull(value: unknown): value is null {
  return value === null && typeof value === 'object'
}
export default _isNull
