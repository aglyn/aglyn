/**
 * @license
 * Copyright 2023 Aglyn LLC
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

import { _isUndT } from '../guards/lib/_is-und-t'
import cloneDeep from '../copy'

export type RemapOptions = {
  /** When true will remove 'undefined' values */
  remove?: boolean
  copy?: 'deep' | 'shallow' | boolean
}

export type RemapTarget<K extends PKey, V = unknown> = Record<K, V>

export type RemapCallback<K extends PKey, V, U = V> = (
  value: V,
  key: K,
  target: RemapTarget<K, V>,
) => U

export type RemapOutputDefault<
  T extends RemapTarget<K, V>,
  K extends PKey,
  V,
  U = V,
> = RemapTarget<K, U>

// prettier-ignore
export type RemapOutputFiltered<
  T extends RemapTarget<K, V>,
  K extends PKey,
  V,
  U = V,
> = OmitIndexOfType<
  RemapOutputDefault<T, K, V, U>,
  NUN
>

// prettier-ignore
export type RemapOutput<
  T extends RemapTarget<K, V>,
  K extends PKey,
  V,
  U = V,
  O extends RemapOptions = any
> =
  O extends {remove: true}
    ? RemapOutputFiltered<T, K, V, U>
    : RemapOutputDefault<T, K, V, U>

/**
 * Map an object keys and values
 */
export function objectRemap<K extends PKey, V, U = V, T = RemapTarget<K, V>>(
  target: RemapTarget<K, V>,
  callbackFn: RemapCallback<K, V, U>,
  options?: RemapOptions,
  thisArg?: ThisType<T>,
): RemapOutput<typeof target, K, V, U, typeof options> {
  type ThisArg = Conditional<typeof thisArg, NUN, typeof target, typeof thisArg>
  type Output = RemapOutput<typeof target, K, V, U, typeof options>

  // prettier-ignore
  const remapped = (
    options?.copy === 'deep'
      ? cloneDeep(target)
      : (
        options?.copy === 'shallow' || options?.copy === true
          ? {...target}
          : target
      )
  ) as unknown as Output

  const _thisArg = (thisArg ?? remapped) as ThisArg

  for (const key in target) {
    if (Object.hasOwn(target, key)) {
      const value = callbackFn.call(_thisArg, target[key], key, target)
      if (options?.remove && _isUndT(value)) delete remapped[key]
      else remapped[key] = value
    }
  }

  return remapped
}

export default objectRemap
