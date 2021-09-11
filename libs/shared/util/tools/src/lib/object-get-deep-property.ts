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

/**
 * Get a nested property within an object literal
 *
 * EXAMPLE:
 * const obj = {'a': {'prop': {'that': 'exists'}}};
 * getNestedProperty(obj, 'a.very.deep.prop', 'value')
 *
 * @see getProperty
 * @see objectSetDeepProperty
 *
 * @export
 * @template T
 * @param {T} obj
 * @param {string} path
 * @param {string} [separator='.']
 * @returns {*}
 */
export function objectGetDeepProperty<T>(obj: T, path: string, separator = '.'): any {
  const keys = path.split(separator)
  const lastKey = keys.pop()
  const lastObj = keys.reduce((v, k) => (v[k] = v[k] ?? {}), obj)
  return lastObj[lastKey]
}
