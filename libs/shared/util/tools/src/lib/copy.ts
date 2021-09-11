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
import { PKey } from '@aglyn/shared/util/types'


export type CopyTarget<T, U, K, V, X> = T extends ReadonlyArray<U>
  ? ReadonlyArray<U>
  : T extends Map<K, V>
    ? Map<K, V>
    : T extends Set<X>
      ? Set<X>
      : T extends Record<PKey, unknown>
        ? T
        : any

const getType = <T>(obj: T) => (toString.call(obj) as string).slice(8, -1)
const defaultAssign = <T, S>(target: T, source: S) => {
  getAllKeys(source).forEach((key) => {
    if (Object.prototype.hasOwnProperty.call(source, key)) {
      target[key] = source[key]
    }
  })
  return target as T & S
}
const objectAssign = Object.assign ?? defaultAssign
const getAllKeys = typeof Object.getOwnPropertySymbols === 'function'
  ? (obj) => Object.keys(obj).concat(Object.getOwnPropertySymbols(obj) as any)
  : (obj) => Object.keys(obj)

/**
 * Immutable copy
 * @see inspiration {@link https://github.com/kolodny/immutability-helper/blob/master/index.ts}
 * @param {CopyTarget<T, U, K, V, X>} value
 * @returns {any}
 */
export function copy<T, U, K, V, X>(value: CopyTarget<T, U, K, V, X>): CopyTarget<T, U, K, V, X> {
  return Array.isArray(value)
    ? objectAssign(value.constructor(value.length), value)
    : getType(value) === 'Map'
      ? new Map(value as Map<K, V>)
      : getType(value) === 'Set'
        ? new Set(value as Set<X>)
        : value && typeof value === 'object'
          ? (objectAssign(Object.create(Object.getPrototypeOf(value)), value) as T)
          : (value as T)
}
