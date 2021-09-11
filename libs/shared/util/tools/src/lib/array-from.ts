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
 * Shallow copy iterable or array like
 * @param {Iterable<T> | ArrayLike<T>} iterable
 * @param {(v: T, k: number) => U} callbackFn
 * @param thisArg
 * @returns {U[]}
 */
export function arrayFrom<T, U>(
  iterable: Iterable<T> | ArrayLike<T>,
  callbackFn?: (v: T, k: number) => U,
  thisArg?: any
): U[] {
  return Array.from(iterable, callbackFn, thisArg)
}
