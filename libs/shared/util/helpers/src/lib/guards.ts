/**
 * @license
 * Copyright (c) 2021 Aglyn LLC and its affiliates
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the root directory of this source tree.
 */

/**
 * Is literal type 'boolean'
 *
 * @export
 * @param {*} val
 * @returns {val is boolean}
 */
export function _isBool(val: unknown): val is boolean {
  return typeof val === 'boolean'
}
/**
 * Is literal type 'bigint'
 *
 * @export
 * @param {*} val
 * @returns {val is bigint}
 */
export function _isBig(val: unknown): val is bigint {
  return typeof val === 'bigint'
}
/**
 * Is literal type 'number'
 *
 * @export
 * @param {*} val
 * @returns {val is number}
 */
export function _isNumT(val: unknown): val is number {
  return typeof val === 'number'
}
/**
 * Is value a number, allows even if string (e.g. "6" vs 6)
 *
 * @export
 * @param {*} val
 * @param {boolean} [noStr]
 * @returns {val is number}
 */
export function _isNum(val: unknown, noStr?: boolean): val is number {
  return noStr && _isStr(val) ? false : !isNaN(Number(val))
}
/**
 * Is literal type symbol
 *
 * @export
 * @param {*} val
 * @returns {val is symbol}
 */
export function _isSym(val: unknown): val is symbol {
  return typeof val === 'symbol'
}
/**
 * Is literal type function
 *
 * @export
 * @param {*} val
 * @returns {val is Function}
 */
export function _isFn(val: unknown): val is Func {
  return typeof val === 'function'
}

export interface Func {
  (...args: unknown[]): unknown
}

/**
 * Shortcut for Array.isArray
 *
 * @export
 * @param {*} val
 * @returns {val is any[]}
 */
export function _isArr(val: unknown): val is unknown[] {
  return Array.isArray(val)
}
/**
 * Is an empty array
 *
 * @export
 * @param {*} val
 * @returns {val is []}
 */
export function _isArrEmpty(val: unknown): val is [] {
  return _isArr(val) && !val.length
}
/**
 * Is literal type object, this could be any Object type
 * such as a function, class, null, {}, array etc
 *
 * @export
 * @param {*} val
 * @returns {val is object}
 */
export function _isObjT(val: unknown): val is Record<string | number, unknown> {
  return typeof val === 'object'
}
/**
 * Is actually a dictionary object (e.g. key:value), but not
 * an array or null
 *
 * @export
 * @param {*} val
 * @returns {val is Object}
 */
export function _isObj(val: unknown): val is Record<string, unknown> {
  return !_isNull(val) && _isObjT(val) && !_isArr(val)
}
/**
 * Is literal type null... null is actually 'object' type literal
 *
 * @export
 * @param {*} val
 * @returns {val is null}
 */
export function _isNull(val: unknown): val is null {
  return _isObjT(val) && typeof val === null
}
/**
 * Is literal type undefined
 *
 * @export
 * @param {*} val
 * @returns {val is undefined}
 */
export function _isUndef(val: unknown): val is undefined {
  return typeof val === 'undefined'
}
/**
 * Is literal type null or undefined
 *
 * @export
 * @param {*} val
 * @returns {(val is null | undefined)}
 */
export function _isUndOrNull(val: unknown): val is null | undefined {
  return _isNull(val) || _isUndef(val)
}
/**
 * Is literal type string
 *
 * @export
 * @param {*} val
 * @returns {val is string}
 */
export function _isStr(val: unknown): val is string {
  return typeof val === 'string'
}
/**
 * Is type empty string (e.g. "" vs "foo")
 *
 * @export
 * @param {*} val
 * @returns {val is ''}
 */
export function _isStrEmpty(val: unknown): val is '' {
  return _isStr(val) && !val.length
}
/**
 * Is type empty array or empty string
 *
 * @export
 * @param {*} val
 * @returns {(val is '' | [])}
 */
export function _isEmptyStrOrArr(val: unknown): val is '' | [] {
  return _isStrEmpty(val) || _isArrEmpty(val)
}
/**
 * Is type Buffer
 *
 * @export
 * @param {*} val
 * @returns {val is Buffer}
 */
export function _isBuff(val: unknown): val is Buffer {
  return (
    _isObjT(val) &&
    _isObjT(val.constructor) &&
    'isBuffer' in val.constructor &&
    _isFn((val.constructor as any).isBuffer) &&
    (val.constructor as any).isBuffer(val)
  )
}
/**
 * Is literal type of primitive type
 *
 * @export
 * @param {*} val
 * @returns {val is Primitive}
 */
export function _isPrim(val: unknown): val is Primitive {
  return Boolean(
    _isSym(val) ||
    _isBig(val) ||
    _isNumT(val) ||
    _isObjT(val) ||
    _isBool(val) ||
    _isStr(val) ||
    _isFn(val) ||
    _isUndef(val),
  )
}
export type Primitive = symbol | bigint | boolean | number | string | undefined
export type PrimitiveBasic = number | string | boolean

/**
 * Checks if the parameter has length greater than 0 or second parameter
 * @export
 * @template T
 * @param {(Iterable<T> | ArrayLike<T>)} val
 * @param {number} [of] evaluation number if you want to check it against
 * @param {('>'|'<'|'=')} [operator]
 * @return {*}  {boolean}
 */
export function _ln<T>(val: Iterable<T> | ArrayLike<T> | number, of?: number, operator?: '>' | '<' | '='): boolean {
  if (val) {
    const ln = _isNum(val) ? val : val['length']
    const base = _isNum(of) ? of : 0
    switch (operator) {
      case '<':
        return ln < base
      case '=':
        return ln === base
      default:
        return ln > base
    }
  }
  return false
}

export function _hasKey(key: string|number, source: Record<string|number, any>): boolean {
  return Object.prototype.hasOwnProperty.call(source, key)
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
export function hasLn<T extends Iterable<U> | ArrayLike<U> | number, U>(val: T, opts?: HasLenOpt<U>): boolean
export function hasLn<T extends Iterable<U> | ArrayLike<U> | number, U>(val: T, equalTo: number): boolean
export function hasLn<T extends Iterable<U> | ArrayLike<U> | number, U>(val: T, opts: any): boolean {
  const _opts = !opts || _isObj(opts) ? { ...opts } : { equalTo: opts }
  const { equalTo, lessThan, moreThan, and, also } = _opts ?? {}
  const v = _isNum(val) ? Number(val) : ((val as unknown) as Iterable<T> | ArrayLike<T>)
  const len: number = _isNum(v) ? v : (v as any).length
  const e = equalTo
  const l = lessThan
  const m = moreThan
  const et = _isNum(e)
  const lt = _isNum(l)
  const mt = _isNum(m)
  const noOpt = !et && !lt && !mt
  const chkFunc = (firstCheck: boolean): boolean => {
    if (_isFn(also)) {
      return Boolean(and ? firstCheck && also(len, v) : firstCheck || also(len, v))
    }
    // !opts && console.log('has len', val, len, _isNumPos(len))
    return firstCheck
  }
  const chkOpt = (equal: boolean, less: boolean, more: boolean, chk: boolean): boolean => {
    return et === equal && lt === less && mt === more && chkFunc(chk)
  }
  return Boolean(
    noOpt
      ? chkFunc(_isNumPos(len))
      : chkOpt(true, false, false, len === e) ||
      chkOpt(false, true, false, len < l) ||
      chkOpt(false, false, true, len > m) ||
      chkOpt(false, true, true, and ? len < l && len > m : len < l || len > m) ||
      chkOpt(true, true, false, and ? len === e && len < l : len === e || len < l) ||
      chkOpt(true, false, true, and ? len === e && len > m : len === e || len > m) ||
      chkOpt(true, true, true, and ? len === e && len < l && len > m : len === e || len < l || len > m),
  )
}

export type HasLenOpt<U> = {
  equalTo?: number | undefined
  lessThan?: number | undefined
  moreThan?: number | undefined
  and?: true | undefined
  also?: ((length: number, value?: U) => boolean) | undefined
}

/**
 * Checks if the value is a negative number
 *
 * @export
 * @param {*} val
 * @returns {(val is number & boolean)}
 */
export function _isNumNeg(val: unknown): val is number & boolean {
  return _isNum(val) && Number(val) < 0
}
/**
 * Checks if the value is a positive number
 *
 * @export
 * @param {*} val
 * @returns {(val is number & boolean)}
 */
export function _isNumPos(val: unknown): val is number & boolean {
  return _isNum(val) && Number(val) > 0
}
/**
 * Checks if the value is a number equal to zero(0)
 *
 * @export
 * @param {*} val
 * @returns {val is 0}
 */
export function _isNumZero(val: unknown): val is 0 {
  return _isNum(val) && Number(val) === 0
}
/**
 * Check if the value is same as one of the values within the array
 *
 * @export
 * @template U
 * @param {*} val
 * @param {Array<U>} possible
 * @returns {val is U}
 */
export function isOneOf<U>(val: unknown, possible: Array<U>): val is U {
  return possible.some((i) => val === i)
}
