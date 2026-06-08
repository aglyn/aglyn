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


export type ArrayEntriesIndex<K extends keyof any, V> = [key: K, value: V]

/**
 * Create KeyValueMap from an array of tuple with key and value
 * @param entries - Array of tuples 0:key, 1:val to map into a new object
 */
export function arrayOfEntriesToObject<K extends keyof any, V>(
  entries: ArrayEntriesIndex<K, V>[],
): Record<K, V> {
  return Object.assign({}, ...entries.map(([key, val]) => ({[key]: val})))
}
export default arrayOfEntriesToObject
