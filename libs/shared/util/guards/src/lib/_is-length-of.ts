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

import { _isFnT } from './_is-fn-t'
import { _isNum } from './_is-num'
import { _isNumPos } from './_is-num-pos'
import { _isObj } from './_is-obj'

export type HasLenOpt<U> = {
  equalTo?: number | undefined
  lessThan?: number | undefined
  moreThan?: number | undefined
  and?: true | undefined
  also?: ((length: number, value?: U) => boolean) | undefined
}

/**
 * Verify the value has a length or value greater than 0 by default
 *
 * TODO: Document better... And refactor/cleanup.. Maybe just do away with
 * the combination and separate out all, probably best
 *
 * Options:
 * (equalTo) - val must equal to it otherwise false
 * (lessThan) - val must be less than then it
 * (moreThan) - val must be greater than it
 * (lessThan & moreThan) - val must be between the two
 * (also) - provide an additional validator
 * (and) - provide any boolean value that may require true
 *
 * @export
 * @template T
 * @template U
 * @param {T} val
 * @param {HasLenOpt<U>} opts
 * @returns {boolean}
 */
export function _isLengthOf<T extends Iterable<U> | ArrayLike<U> | number, U>(
  val: T,
  opts?: HasLenOpt<U>,
): boolean
export function _isLengthOf<T extends Iterable<U> | ArrayLike<U> | number, U>(
  val: T,
  equalTo: number,
): boolean
export function _isLengthOf<T extends Iterable<U> | ArrayLike<U> | number, U>(
  val: T,
  opts: any,
): boolean {
  const _opts = !opts || _isObj(opts) ? { ...opts } : { equalTo: opts }
  const { equalTo, lessThan, moreThan, and, also } = _opts ?? {}
  const v = _isNum(val)
    ? Number(val)
    : (val as unknown as Iterable<T> | ArrayLike<T>)
  const len: number = _isNum(v) ? v : (v as any).length
  const e = equalTo
  const l = lessThan
  const m = moreThan
  const et = _isNum(e)
  const lt = _isNum(l)
  const mt = _isNum(m)
  const noOpt = !et && !lt && !mt
  const chkFunc = (firstCheck: boolean): boolean => {
    if (_isFnT(also)) {
      return Boolean(
        and ? firstCheck && also(len, v) : firstCheck || also(len, v),
      )
    }
    // !opts && console.log('has len', val, len, _isNumPos(len))
    return firstCheck
  }
  const chkOpt = (
    equal: boolean,
    less: boolean,
    more: boolean,
    chk: boolean,
  ): boolean => {
    return et === equal && lt === less && mt === more && chkFunc(chk)
  }
  return Boolean(
    noOpt
      ? chkFunc(_isNumPos(len))
      : chkOpt(true, false, false, len === e) ||
          chkOpt(false, true, false, len < l) ||
          chkOpt(false, false, true, len > m) ||
          chkOpt(
            false,
            true,
            true,
            and ? len < l && len > m : len < l || len > m,
          ) ||
          chkOpt(
            true,
            true,
            false,
            and ? len === e && len < l : len === e || len < l,
          ) ||
          chkOpt(
            true,
            false,
            true,
            and ? len === e && len > m : len === e || len > m,
          ) ||
          chkOpt(
            true,
            true,
            true,
            and
              ? len === e && len < l && len > m
              : len === e || len < l || len > m,
          ),
  )
}
export default _isLengthOf
