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
 * Remove an item from the array at the provided zero index
 * @param array - Array list to remove the item from
 * @param index - Index of item to remove
 */
export function arrayRemoveAtIndex<T>(array: Array<T>, index: number): Array<T> {
  array.splice(index, 1)
  return array
}
export default arrayRemoveAtIndex
