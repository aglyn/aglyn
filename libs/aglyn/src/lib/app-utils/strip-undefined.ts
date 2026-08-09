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

const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  if (typeof value !== 'object' || value === null) return false
  const proto = Object.getPrototypeOf(value)
  return proto === Object.prototype || proto === null
}

/**
 * Remove every `undefined` value from a serialized node payload (AGL-1334).
 *
 * An editor form hands back its whole field set, so an optional attribute the
 * author never set — or cleared — arrives as an OWN key whose value is
 * `undefined` (the icon pickers do exactly this: `startIconPath` is written on
 * every edit of a Button whose Start icon reads `(NONE)`). `undefined` is not
 * a storable value, and the two besigner write paths disagreed about it in the
 * worst possible way:
 *
 * - A **save** goes through a version-doc converter that msgpack-encodes the
 *   node map, and msgpack encodes an `undefined` member as nil — so the write
 *   succeeded and quietly persisted `startIconPath: null`. That null is the
 *   exact shape `dropClearedProps` has to defend against at RENDER time
 *   (AGL-1226), where it once 500'd every `/product/*` page.
 * - A **publish** copies the same map onto the component document as a plain
 *   Firestore map, and `updateDoc()` rejects `undefined` outright:
 *   `Unsupported field value: undefined (found in field nodes.<id>.props.…)`.
 *
 * So the author saved, saw `UP TO DATE`, clicked Publish, and got a raw
 * Firestore error — with every instance still rendering the old markup.
 *
 * Dropping the key is what "cleared" means for an optional prop: absent, so
 * the component's own default applies. Not `null`, which is a value, and not
 * `deleteField()`, which cannot appear inside a nested map written wholesale.
 * Applied at the ONE place both write paths serialize from
 * (`AglynNode.toJSON`), so save and publish agree by construction rather than
 * by two strippers that can drift.
 *
 * `null`, `0`, `''` and `false` are kept — those are values an author can mean
 * (and, unlike `undefined`, all four store fine).
 *
 * Recurses into plain objects and arrays only: a `Date`, a Firestore
 * `Timestamp`, a `Bytes` or any other class instance is a leaf and is passed
 * through untouched. An `undefined` array ELEMENT is dropped rather than
 * held as a hole, because Firestore rejects those too and a node's arrays are
 * id lists and sx layers, where a hole means nothing.
 *
 * Returns the input by reference when there is nothing to strip, so the common
 * case allocates nothing and identity-based memoization is undisturbed.
 */
export function stripUndefinedDeep<T>(value: T): T {
  if (Array.isArray(value)) {
    let changed = false
    const next: unknown[] = []
    for (const item of value) {
      if (item === undefined) {
        changed = true
        continue
      }
      const stripped = stripUndefinedDeep(item)
      if (stripped !== item) changed = true
      next.push(stripped)
    }
    return (changed ? next : value) as T
  }

  if (isPlainObject(value)) {
    let changed = false
    const next: Record<string, unknown> = {}
    for (const key of Object.keys(value)) {
      const item = value[key]
      if (item === undefined) {
        changed = true
        continue
      }
      const stripped = stripUndefinedDeep(item)
      if (stripped !== item) changed = true
      next[key] = stripped
    }
    return (changed ? next : value) as T
  }

  return value
}

export default stripUndefinedDeep
