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

import { Conditional, NUN, OmitIndexOfType, PKey } from '@aglyn/shared/util/types'


export type RemapOptions = { deleteUndefined?: boolean }
export type RemapTarget<K extends PKey, V = unknown> = Record<K, V>
export type RemapCallback<K extends PKey, V, U = V> = {
  (value: V, key: K, target: RemapTarget<K, V>): U
}
export type RemapOutputDefault<T extends RemapTarget<K, V>, K extends PKey, V, U = V> = RemapTarget<K, U>
export type RemapOutputFiltered<T extends RemapTarget<K, V>, K extends PKey, V, U = V> = OmitIndexOfType<RemapOutputDefault<T, K, V, U>, NUN>
export type RemapOutput<T extends RemapTarget<K, V>, K extends PKey, V, U = V, O extends RemapOptions = any> = O extends { deleteUndefined: true }
  ? RemapOutputFiltered<T, K, V, U>
  : RemapOutputDefault<T, K, V, U>

/**
 * Map an object keys and values
 * @param {RemapTarget<K, V>} target
 * @param {RemapCallback<K, V, U>} callbackFn
 * @param {RemapOptions} options
 * @param {ThisType<T>} thisArg
 * @returns {RemapOutput<typeof target, K, V, U, typeof options>}
 */
export function remap<K extends PKey, V, U = V, T = unknown>(
  target: RemapTarget<K, V>,
  callbackFn: RemapCallback<K, V, U>,
  options?: RemapOptions,
  thisArg?: ThisType<T>,
): RemapOutput<typeof target, K, V, U, typeof options> {
  type ThisArg = Conditional<typeof thisArg, NUN, typeof target, typeof thisArg>
  type Ouput = RemapOutput<typeof target, K, V, U, typeof options>
  const {deleteUndefined} = {...options}
  const _target: Ouput = {} as Ouput
  const _thisArg: ThisArg = thisArg ?? _target

  for (const key in target) {
    if (Object.prototype.hasOwnProperty.call(target, key)) {
      _target[key] = callbackFn.call(_thisArg, target[key], key, target)
      if (deleteUndefined && _target[key] === undefined) {
        delete _target[key]
      }
    }
  }
  return _target
}
