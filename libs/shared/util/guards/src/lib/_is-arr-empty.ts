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
 * Guard utility to chec
 * @param val - the value or array to check
 * @param invalid - the result if {@link val} is not an array
 */
export function _isArrEmpty(val: unknown, invalid: any = true): val is [] {
  return Array.isArray(val) ? !val.length : invalid
}

export default _isArrEmpty
