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

if (!Array.prototype.$_cloneShallow) {
  Array.prototype.$_cloneShallow = function <T>(this: Array<T>): Array<T> {
    return arrayCopyShallow(this)
  }
}
if (!Array.prototype.$_cloneDeep) {
  Array.prototype.$_cloneDeep = function <T>(this: Array<T>): Array<T> {
    return arrayCopyDeep(this)
  }
}
if (!Array.prototype.$_moveAtIndex) {
  Array.prototype.$_moveAtIndex = function <T>(
    this: Array<T>,
    index: number,
    newIndex: number,
  ): Array<T> {
    return arrayMoveAtIndex(this, index, newIndex)
  }
}
if (!Array.prototype.$_pushAtIndex) {
  Array.prototype.$_pushAtIndex = function <T>(
    this: Array<T>,
    index: number,
    ...elems: Array<T>
  ): Array<T> {
    return arrayPushAtIndex(this, index, ...elems)
  }
}
if (!Array.prototype.$_removeItem) {
  Array.prototype.$_removeItem = function <T>(
    this: Array<T>,
    elem: T,
  ): Array<T> {
    return arrayRemoveItem(this, elem)
  }
}
if (!Array.prototype.$_removeAtIndex) {
  Array.prototype.$_removeAtIndex = function <T>(
    this: Array<T>,
    index: number,
  ): Array<T> {
    return arrayRemoveAtIndex(this, index)
  }
}
if (!Array.prototype.$_replaceAtIndex) {
  Array.prototype.$_replaceAtIndex = function <T>(
    this: Array<T>,
    index: number,
    elem: T,
  ): Array<T> {
    return arrayUpdateAtIndex(this, index, elem)
  }
}
if (!Array.prototype.$_truthy) {
  Array.prototype.$_truthy = function <T>(this: Array<T>): Array<T> {
    return this.filter(Boolean)
  }
}
