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


/**
 * Move an element in the array
 * @param array - The array to mutate and reorder
 * @param index - Current index of the item to move
 * @param newIndex - New index for the item to be moved to
 */
export function arrayMoveAtIndex<K extends number & keyof T, T extends Array<U>, U>(
  array: T,
  index: K | any,
  newIndex: K | any,
): T {
  if (!Array.isArray(array)) {
    throw new TypeError(
      `arrayMoveAtIndex: expected an array but received ${array === null ? 'null' : typeof array}`,
    )
  }
  const item = array.splice(index, 1)[0]
  if (isNaN(newIndex)) array.push(item)
  else array.splice(newIndex, 0, item)
  return array
}
export default arrayMoveAtIndex
