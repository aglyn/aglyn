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

import { _hasProperty } from '@aglyn/shared-util-guards'


/**
 * Shortcut for retrieving the length property,
 * defaults to zero (0) if the property does not exist
 *
 * @export
 * @template T
 * @param {(Iterable<T> | ArrayLike<T>)} val
 * @returns {number}
 */
export function length<T>(val: Iterable<T> | ArrayLike<T>): number {
  if (val && _hasProperty('length', val)) {
    return val['length'] ?? 0
  }
  return 0
}
