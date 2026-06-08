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
 * Convince closure compiler that the wrapped function has no side-effects.
 *
 * Closure compiler always assumes that `toString` has no side-effects. We use
 * this quirk to allow us to execute a function but have closure compiler mark
 * the call as no-side-effects. It is important that the return value for the
 * `noSideEffects` function be assigned to something which is retained otherwise
 * the call to `noSideEffects` will be removed by closure compiler.
 *
 * @see https://github.com/angular/angular/blob/master/packages/core/src/util/closure.ts
 */
export function noSideEffects<T>(fn: () => T): T {
  return {toString: fn}.toString()
}

export default noSideEffects
