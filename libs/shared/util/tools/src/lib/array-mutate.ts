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

import { arrayCopyAll } from './array-copy-all'
import { arraySafe } from './array-safe'
import { len } from './len'


export type MutatedArray<T> = Record<'items' | 'deleted' | 'added', Array<T>>

/**
 *
 *
 * @export
 * @template T
 * @param {(number | any)} index
 * @param {Array<T>} array
 * @param {(T | Array<T>)} [items]
 * @param {{ replace?: boolean, copy?: boolean }} [options]
 * @returns {MutatedArray<T>}
 */
export function arrayMutate<T>(
  index: number | any,
  array: Array<T>,
  items?: T | Array<T>,
  options?: { replace?: boolean; copy?: boolean },
): MutatedArray<T> {
  const {replace, copy} = {replace: true, copy: false, ...options}
  const _array: Array<T> = copy ? arrayCopyAll(array) as Array<T> : array
  const _items = arraySafe(items, items ? [items] : [])
  const deleteCount = replace ? len(_items) : 0
  const deleted = _array.splice(index, deleteCount, ..._items)

  return {items: _array, deleted, added: _items}
}
