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

import { _isObj } from '../guards'


/**
 * Safe object/{} will always return an object
 *
 * @export
 * @template T
 * @param {T} val
 * @param {Record<string, unknown>} [or]
 * @returns {Record<string, unknown>}
 */
export function objectSafe<T>(
  val: T,
  or?: Record<string, unknown>,
): Record<string, unknown> {
  return _isObj(val) ? val : _isObj(or) ? or : {}
}

export default objectSafe
