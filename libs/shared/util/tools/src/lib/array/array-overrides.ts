/**
 * @license
 * Copyright 2022 Aglyn LLC
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

import arrayCopyDeep from './array-copy-deep'
import arrayCopyShallow from './array-copy-shallow'
import arrayMoveAtIndex from './array-move-at-index'
import arrayPushAtIndex from './array-push-at-index'
import arrayRemoveAtIndex from './array-remove-at-index'
import arrayRemoveItem from './array-remove-item'
import arrayUpdateAtIndex from './array-update-at-index'

declare global {
  interface Array<T> {
    $_cloneShallow(): Array<T>
    $_cloneDeep(): Array<T>
    $_moveAtIndex(index: number, newIndex: number): Array<T>
    $_pushAtIndex(index: number, newIndex: number): Array<T>
    $_removeItem(elem: T): Array<T>
    $_removeAtIndex(index: number): Array<T>
    $_replaceAtIndex(index: number, elem: T): Array<T>
    $_truthy(): Array<T>
  }
}

export {}

/**
 * Define all custom Array prototype methods with `enumerable: false`.
 *
 * WHY: Simple property assignment (`Array.prototype.foo = fn`) creates an ENUMERABLE property.
 * MUI's `styleFunctionSx` iterates sx array objects with `for...in`, which walks the entire
 * prototype chain and picks up any enumerable inherited properties — including our custom methods.
 * It then calls them via `callIfFn(fn, theme)` WITHOUT a receiver, making `this === undefined`
 * (strict-mode ES modules), which caused "arrayMoveAtIndex: expected an array but received undefined".
 *
 * Using `Object.defineProperty` with `enumerable: false` makes the methods invisible to
 * `for...in`, `Object.keys`, and `JSON.stringify` while still accessible via direct calls
 * and prototype chain lookups.
 *
 * ALSO: No guard (`if (!Array.prototype.$_xxx)`) so that Turbopack HMR re-evaluations always
 * re-register the methods with fresh module bindings.
 */
function defineArrayMethod(name: string, fn: (...args: any[]) => any): void {
  Object.defineProperty(Array.prototype, name, {
    value: fn,
    enumerable: false,   // ← invisible to for...in (fixes the MUI sx iteration bug)
    writable: true,
    configurable: true,  // ← allows HMR re-evaluation to overwrite
  })
}

defineArrayMethod('$_cloneShallow', function <T>(this: Array<T>): Array<T> {
  return arrayCopyShallow(this)
})

defineArrayMethod('$_cloneDeep', function <T>(this: Array<T>): Array<T> {
  return arrayCopyDeep(this)
})

defineArrayMethod('$_moveAtIndex', function <T>(
  this: Array<T>,
  index: number,
  newIndex: number,
): Array<T> {
  return arrayMoveAtIndex(this, index, newIndex)
})

defineArrayMethod('$_pushAtIndex', function <T>(
  this: Array<T>,
  index: number,
  ...elems: Array<T>
): Array<T> {
  return arrayPushAtIndex(this, index, ...elems)
})

defineArrayMethod('$_removeItem', function <T>(this: Array<T>, elem: T): Array<T> {
  return arrayRemoveItem(this, elem)
})

defineArrayMethod('$_removeAtIndex', function <T>(this: Array<T>, index: number): Array<T> {
  return arrayRemoveAtIndex(this, index)
})

defineArrayMethod('$_replaceAtIndex', function <T>(
  this: Array<T>,
  index: number,
  elem: T,
): Array<T> {
  return arrayUpdateAtIndex(this, index, elem)
})

defineArrayMethod('$_truthy', function <T>(this: Array<T>): Array<T> {
  return this.filter(Boolean)
})
