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

/**
 * Deep equality and a deep copy for node data, sized for every published page
 * (AGL-4220).
 *
 * The canvas store is constructed on every published page, and it used
 * lodash's `isEqual` and `cloneDeep` for this. Between them those two pulled
 * about 120 lodash modules — tag tables, typed-array and buffer cloning,
 * `Map`/`Set` caches and a cycle stack — onto the page, about 5 KB of the
 * every-page wire weight, for values that are node documents: JSON-shaped
 * objects and arrays, sometimes read through mobx proxies, occasionally a
 * `Date`.
 *
 * Both functions answer what lodash answered for those values, and the spec
 * holds them to lodash on the shapes nodes carry:
 *
 * - `NaN` equals `NaN`; `+0` equals `-0`.
 * - An own key whose value is `undefined` is a key: `{ a: undefined }` is not
 *   `{}`.
 * - Two objects with different prototypes differ; arrays never equal objects.
 * - `Date`s compare by time and are copied as new `Date`s; `Map`s and `Set`s
 *   compare and copy by entries.
 * - A function is kept by reference in a copy, as lodash keeps a nested one.
 * - An object that is not an array, a `Date`, a `Map` or a `Set` is copied
 *   onto a fresh object with the same prototype, as lodash copies a class
 *   instance, own enumerable string and symbol keys included.
 *
 * Neither follows cycles: a node document has none, and lodash's stack for
 * them is part of what this replaces.
 */

const ownKeys = (value: object): PropertyKey[] => [
  ...Object.keys(value),
  ...Object.getOwnPropertySymbols(value).filter((symbol) =>
    Object.prototype.propertyIsEnumerable.call(value, symbol),
  ),
]

/** Deep equality for node data, matching lodash's `isEqual` on it. */
export function plainDataEqual(left: unknown, right: unknown): boolean {
  if (left === right) return true
  // NaN is the one value unequal to itself.
  if (left !== left && right !== right) return true
  if (
    typeof left !== 'object' ||
    typeof right !== 'object' ||
    left === null ||
    right === null
  ) {
    return false
  }
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right)) return false
    if (left.length !== right.length) return false
    for (let at = 0; at < left.length; at++) {
      if (!plainDataEqual(left[at], right[at])) return false
    }
    return true
  }
  if (Object.getPrototypeOf(left) !== Object.getPrototypeOf(right)) return false
  if (left instanceof Date) {
    return plainDataEqual(left.getTime(), (right as Date).getTime())
  }
  if (left instanceof Map) {
    const other = right as Map<unknown, unknown>
    if (left.size !== other.size) return false
    for (const [key, value] of left) {
      if (!other.has(key) || !plainDataEqual(value, other.get(key)))
        return false
    }
    return true
  }
  if (left instanceof Set) {
    const other = right as Set<unknown>
    if (left.size !== other.size) return false
    const unmatched = [...other]
    for (const value of left) {
      const at = unmatched.findIndex((entry) => plainDataEqual(value, entry))
      if (at < 0) return false
      unmatched.splice(at, 1)
    }
    return true
  }
  const keys = ownKeys(left)
  if (keys.length !== ownKeys(right).length) return false
  for (const key of keys) {
    if (!Object.prototype.hasOwnProperty.call(right, key)) return false
    if (
      !plainDataEqual(
        (left as Record<PropertyKey, unknown>)[key],
        (right as Record<PropertyKey, unknown>)[key],
      )
    ) {
      return false
    }
  }
  return true
}

/** A deep copy of node data, matching lodash's `cloneDeep` on it. */
export function clonePlainData<T>(value: T): T {
  if (typeof value !== 'object' || value === null) return value
  if (Array.isArray(value)) return value.map(clonePlainData) as T
  if (value instanceof Date) return new Date(value.getTime()) as T
  if (value instanceof Map) {
    return new Map(
      [...value].map(([key, entry]) => [key, clonePlainData(entry)]),
    ) as T
  }
  if (value instanceof Set) {
    return new Set([...value].map(clonePlainData)) as T
  }
  const copy = Object.create(Object.getPrototypeOf(value)) as Record<
    PropertyKey,
    unknown
  >
  for (const key of ownKeys(value)) {
    copy[key] = clonePlainData((value as Record<PropertyKey, unknown>)[key])
  }
  return copy as T
}
