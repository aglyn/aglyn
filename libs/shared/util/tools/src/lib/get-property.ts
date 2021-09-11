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

import { _isObj } from '@aglyn/shared/util/guards'


/**
 * Get safe property
 *
 * @see objectGetDeepProperty
 * @see objectSetDeepProperty
 *
 * @export
 * @template T
 * @template K
 * @param {T} obj
 * @param {K} key
 * @returns {T[K]}
 */
export function getProperty<T, K extends keyof T>(obj: T, key: K): T[K] | undefined {
  if (!_isObj(obj)) {
    return undefined
  }
  return obj[key]
}
