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
import type {IndexOf} from '@aglyn/shared-data-types'


export type ChainableFunction<T, A extends any[], R> = {
  (this: T, ...args: A): R
}

/**
 * Safe chained function.
 *
 * Will only create a new function if needed,
 * otherwise will pass back existing functions or null.
 *
 * @example
 * const {onClick} = props
 * const handleOnClick = () => {}
 * const isOpen = false
 * const handleClose = () => {}
 * <element
 *   onclick={createChainedFunction(handleOnClick, onClick, isOpen && handleClose)}
 * />
 */
export function createChainedFunction<T, A extends any[], R>(
  functions: ChainableFunction<T, A, R>[],
  thisArg: T = null,
  ...args: IndexOf<A>[]
): ChainableFunction<T, Partial<A>, void> {
  return functions.reduce((accumulator, fn) => {
    return fn == null
      // When received invalid fn return safe function
      ? accumulator
      // Otherwise, build new fn and apply both
      : chainedFunction

    function chainedFunction(this: T, ..._args: A): R {
      const mergedArgs = [..._args, ...args] as A
      accumulator.apply(thisArg || this, mergedArgs)
      return fn.apply(thisArg || this, mergedArgs)
    }
  }, (() => {}) as ChainableFunction<T, A, R>)
}

export default createChainedFunction
