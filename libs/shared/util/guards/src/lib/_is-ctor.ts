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
 * Is type a newable constructor function
 *
 * @export
 * @param {*} val
 * @returns {val is new Function}
 */
export function _isCtor(val: unknown): val is new (...args: unknown[]) => unknown {
  if (typeof val !== 'function') {return false}
  return Boolean(val.prototype.constructor)
}
