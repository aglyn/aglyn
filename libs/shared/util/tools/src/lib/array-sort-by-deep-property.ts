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

import { objectGetDeepProperty } from './object-get-deep-property'


/**
 * Sort an array of objects by a specified property or property path, optionally second
 * specify a secondary sorter for when left equals right
 * @param {T[]} items
 * @param {string} firstPath
 * @param {string} secondPath
 * @returns {T[]}
 */
export function arraySortByDeepProperty<T>(items: T[], firstPath: string, secondPath?: string): T[] {
  const lgr = (a, b, p) => objectGetDeepProperty(a, p) > objectGetDeepProperty(b, p)
  const eq = (a, b, p) => objectGetDeepProperty(a, p) === objectGetDeepProperty(b, p)
  return items.sort((a, b) => {
    if (lgr(a, b, firstPath)) return 1
    if (secondPath) {
      if (eq(a, b, firstPath) && lgr(a, b, secondPath)) return 1
      if (eq(a, b, firstPath) && eq(a, b, secondPath)) return 0
    }
    return -1
  })
}
