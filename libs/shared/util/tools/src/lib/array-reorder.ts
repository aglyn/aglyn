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

import { arrayAddAtIndex } from './array-add-at-index'
import { arrayMutate } from './array-mutate'


/**
 *
 *
 * @export
 * @template K
 * @template T
 * @template U
 * @param {T} array
 * @param {(K | any)} currentIndex
 * @param {(K | any)} newIndex
 * @returns {T}
 */
export function arrayReorder<K extends number & keyof T, T extends Array<U>, U>(
  array: T,
  currentIndex: K | any,
  newIndex: K | any,
): T {
  const arr = arrayMutate(currentIndex, array)
  return arrayAddAtIndex(newIndex, arr.items, arr.deleted).items as T
}
