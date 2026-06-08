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
 * Remove an item using strict equality when match
 * @param array - Array to mutate and remove the match
 * @param item - Item to search for strict equality comparison
 */
export function arrayRemoveItem<T>(array: Array<T>, item: T): Array<T> {
  const index = array.indexOf(item)
  if (index >= 0) array.splice(index, 1)
  return array
}
export default arrayRemoveItem
