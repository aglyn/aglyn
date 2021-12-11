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
 * Sort iterable by property or index returned from callbackFn
 * @export`
 * @param {T[]} target
 * @param {(item: T) => (string | number)} callbackFn
 * @param thisArg
 * @returns {T[]}
 */
export function arraySortBy<T>(
  target: T[],
  callbackFn: (item: T, target: T[]) => string | number,
  thisArg?: ThisType<unknown>,
): T[] {
  return target.slice().sort((a, b) => {
    const propA = callbackFn.call(thisArg, a, target) // callbackFn(a)
    const propB = callbackFn.call(thisArg, b, target) // prop(b)
    if (propA > propB) return 1
    if (propA < propB) return -1
    return 0
  })
}

export default arraySortBy
