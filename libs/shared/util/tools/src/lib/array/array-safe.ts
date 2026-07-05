/**
 * @license
 * Copyright 2026 Aglyn LLC
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

import { _isArr } from '../guards/lib/_is-arr'


/**
 * Safe array, will always return an array
 */
export function arraySafe<T>(val: T[] | T, or?: any, wrapValid = false): T[] {
  if (_isArr(val)) return val
  if (wrapValid && val) return [val]
  if (_isArr(or)) return or
  return []
}

export default arraySafe
