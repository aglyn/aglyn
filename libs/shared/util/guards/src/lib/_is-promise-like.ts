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
 * Check whether a value is a Promise-like instance.
 * Recognizes both native promises and third-party promise libraries.
 *
 * @param value - The value to check.
 */
export function _isPromiseLike<T>(
  value: T | PromiseLike<T> | undefined,
): value is PromiseLike<T> {
  if (!value) return false
  if (typeof value !== 'object' && typeof value !== 'function') return false
  return typeof (value as PromiseLike<T>).then === 'function'
}
export default _isPromiseLike
