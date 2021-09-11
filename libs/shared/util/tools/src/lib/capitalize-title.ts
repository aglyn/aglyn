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

import { _s } from './_s'
import { capitalize } from './capitalize'


/**
 * Capitalize every word separated by a space
 *
 * @export
 * @template T
 * @param {T} val
 * @param separator
 * @returns {T}
 */
export function capitalizeTitle<T extends string>(val: T, separator = ' '): T {
  return _s(val)
  .split(separator)
  .map((i) => capitalize(i))
  .join(separator) as T
}
