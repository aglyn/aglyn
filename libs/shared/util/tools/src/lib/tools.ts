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

import { _isArr, _isFnT, _isNum, _isObj, _isStrT, _isUndT } from '@aglyn/shared/util/guards'


export function tools(): string {
  return 'tools'
}

/**
 * Shortcut for retrieving the length property,
 * defaults to zero (0) if the property does not exist
 *
 * @export
 * @template T
 * @param {(Iterable<T> | ArrayLike<T>)} val
 * @returns {number}
 */
export function ln<T>(val: Iterable<T> | ArrayLike<T>): number {
  if (val) {
    return val['length'] ?? 0
  }
  return 0
}

/**
 * Shortcut for String(...)
 *
 * @export
 * @param {*} val
 * @returns {string}
 */
export function _s(...val: Parameters<typeof String>): string {
  return String(val)
}

/**
 * Shortcut for Boolean(...)
 *
 * @export
 * @param {*} val
 * @returns {boolean}
 */
export function yes(...val: Parameters<typeof Boolean>): boolean {
  return Boolean(...val)
}

/**
 * Shortcut for !(...)
 *
 * @export
 * @param {*} val
 * @returns {boolean}
 */
export function not(...val: Parameters<typeof Boolean>): boolean {
  return !yes(...val)
}

/**
 * Shortcut for JSON.stringify(...)
 *
 * @export
 * @return {string}
 * @param data
 */
export function stringify(data: Parameters<typeof JSON.stringify>[0]): ReturnType<typeof JSON.stringify>
export function stringify(...args: Parameters<typeof JSON.stringify>): ReturnType<typeof JSON.stringify> {
  return JSON.stringify(...args)
}

/**
 * Shortcut for JSON.parse(...)
 *
 * @export
 * @return {any}
 * @param str
 */
export function string2Json(str: Parameters<typeof JSON.parse>[0]): ReturnType<typeof JSON.parse>
export function string2Json(...args: Parameters<typeof JSON.parse>): ReturnType<typeof JSON.parse> {
  return JSON.parse(...args)
}

/**
 * Sort iterable by property or index returned from callbackFn
 * @export`
 * @param {T[]} target
 * @param {(item: T) => (string | number)} callbackFn
 * @param thisArg
 * @returns {T[]}
 */
export function sortBy<T>(
  target: T[],
  callbackFn: (item: T, target: T[]) => string | number,
  thisArg?: ThisType<unknown>,
) {
  return target.slice().sort((a, b) => {
    const propA = callbackFn.call(thisArg, a, target) // callbackFn(a)
    const propB = callbackFn.call(thisArg, b, target) // prop(b)
    if (propA < propB) return -1
    if (propA > propB) return 1
    return 0
  })
}

/**
 * Safe array, will always return an array
 *
 * @export
 * @template T
 * @param {T} val
 * @param {any[]} [or]
 * @returns {any[]}
 */
export function safeArray<T>(val: T, or?: any[]): any[] {
  return _isArr(val) ? val : _isArr(or) ? or : []
}

/**
 * Safe object/{} will always return an object
 *
 * @export
 * @template T
 * @param {T} val
 * @param {Record<string, unknown>} [or]
 * @returns {Record<string, unknown>}
 */
export function safeObj<T>(val: T, or?: Record<string, unknown>): Record<string, unknown> {
  return _isObj(val) ? val : _isObj(or) ? or : {}
}

/**
 * Get safe property
 *
 * @see getDeepProperty
 * @see setDeepProperty
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

/**
 * Get a nested property within an object literal
 *
 * EXAMPLE:
 * const obj = {'a': {'prop': {'that': 'exists'}}};
 * getNestedProperty(obj, 'a.very.deep.prop', 'value')
 *
 * @see getProperty
 * @see setDeepProperty
 *
 * @export
 * @template T
 * @param {T} obj
 * @param {string} path
 * @param {string} [separator='.']
 * @returns {*}
 */
export function getDeepProperty<T>(obj: T, path: string, separator = '.'): any {
  const keys = path.split(separator)
  const lastKey = keys.pop()
  const lastObj = keys.reduce((v, k) => (v[k] = v[k] ?? {}), obj)
  return lastObj[lastKey]
}

/**
 * Set a nested property within an object literal
 *
 * EXAMPLE:
 * const obj = {'a': {'prop': {'that': 'exists'}}};
 * setNestedProperty(obj, 'a.very.deep.prop', 'value')
 *
 * @see getProperty
 * @see getDeepProperty
 *
 * @export
 * @template T
 * @param {T} obj
 * @param {string} path
 * @param {*} val
 * @param {string} [separator='.']
 */
export function setDeepProperty<T>(obj: T, path: string, val: any, separator = '.'): T {
  const keys = path.split(separator)
  const lastKey = keys.pop()
  const lastObj = keys.reduce((v, k) => (v[k] = v[k] ?? {}), obj)
  lastObj[lastKey] = val
  return obj
}

/**
 * Sort an array of object by a specified property path, optional second sorter
 *
 * @export
 * @template T
 * @param {T[]} items
 * @param {string} firstPath
 * @param {string} [secondPath]
 * @returns {T[]}
 *
 * @deprecated {@link sortBy}
 * @see {@link sortBy}
 * TODO: REMOVE AMBIGUOUS METHOD TO REPLACE WITH `sortBy`
 */
export function sortByProperty<T>(items: T[], firstPath: string, secondPath?: string): T[] {
  const lgr = (a, b, p) => getDeepProperty(a, p) > getDeepProperty(b, p)
  const eq = (a, b, p) => getDeepProperty(a, p) === getDeepProperty(b, p)
  return items.sort((a, b) =>
    lgr(a, b, firstPath) ? 1 : secondPath && eq(a, b, firstPath) ? (lgr(a, b, secondPath) ? 1 : -1) : -1,
  )
}

/**
 * Copy an object literal
 *
 * @export
 * @param {Record<string, unknown>} obj
 * @returns
 */
export function copyObj(obj: Record<string, unknown>) {
  return copy(obj)
}

/**
 * Copy a json object by stringify and then parsing
 *
 * @export
 * @template T
 * @param {T} json
 * @returns {T}
 */
export function copyJson<T>(json: T): T {
  return JSON.parse(JSON.stringify(json))
}

/**
 *
 *
 * @export
 * @param {[any, any][]} arr
 * @returns
 */
export function arrayToObjectLiteral(arr: [any, any][]) {
  return Object.assign({}, ...arr.map(([key, val]) => ({[key]: val})))
}

/**
 *
 *
 * @export
 * @template T
 * @template K
 * @param {T} obj
 * @returns {K[]}
 */
export function getAllObjectKeys<T extends Record<string, unknown>, K extends keyof T>(obj: T): K[] {
  return (_isFnT(Object.getOwnPropertySymbols)
    ? Object.keys(obj).concat(Object.getOwnPropertySymbols(obj) as any)
    : Object.keys(obj)) as K[]
}

/**
 *
 *
 * @export
 * @template T
 * @template K
 * @param {T} target
 * @param {(val: T[K], key?: K, original?: T) => T[K]} reducerCallback
 * @returns {T}
 */
export function reduceObject<T extends Record<string, unknown>, K extends keyof T>(
  target: T,
  reducerCallback: (val: T[K], key?: K, original?: T) => T[K],
): T {
  if (_isUndT(reducerCallback)) {
    return target
  }
  const _target: T = copyObj(target) as T
  const original: T = copyObj(target) as T

  return getAllObjectKeys(_target).reduce((result, key) => {
    result[key as string] = reducerCallback(_target[key] as T[K], key as K, original)
    return result
  }, {}) as T
}

/**
 * Map an object keys and values
 * @export
 * @template K
 * @template V
 * @template U
 * @param target
 * @param callbackFn
 * @param thisArg
 * @param options
 * @returns {{[key in K]: U}}
 */
export function remap<K extends string, V, U>(
  target: { [key in K]: V },
  callbackFn: MapObjectCallback<K, V, U>,
  options?: { deleteUndefined?: boolean },
  thisArg?: ThisType<unknown>,
): { [key in K]: U } {
  const {deleteUndefined} = options ?? {}
  const res: Partial<{ [key in K]: U }> = {}
  for (const key in target) {
    if (Object.prototype.hasOwnProperty.call(target, key)) {
      res[key] = callbackFn.call(thisArg, target[key], key, target)
      if (deleteUndefined && res[key] === undefined) {
        delete res[key]
      }
    }
  }
  return res as { [key in K]: U }
}
export type MapObjectCallback<K extends string, V, U> = (value: V, key: K, obj: { [key in K]: V }) => U

/**
 * @deprecated Move to {@link remap}
 * @see {@link map}
 *
 * Map object literal for quick editing or build a keyed object literal from
 * an array of objects
 *
 * @example `
 *  let foobar = mapObject(
 *   [{id:'foo',foobar:'bar'}],
 *   ((value, key, index, array) => [value.id, value]),
 *   { advanced: true, copy: true, filter: true }
 * ) // => ({'foo':{id:'foo',foobar:'bar'}})
 * `
 * @example `
 *  let foobar = mapObject(
 *   {foo:1,bar:2},
 *   ((value, key, index, array) => value * 2),
 *   { advanced: false, copy: true, filter: true }
 * ) // => ({foo:2,bar:4})
 * `
 *
 * @export
 * @template T
 * @param {T|Array<object>|object} target
 * @param {MapObjectClbkFn} callbackfn
 * @param {MapObjectOptions} [opt] (
 *  if !!filter - removes anything undefined,
 *  if !!advanced - the clbk should return a tuple of the new key and value [k,v]
 * )
 * @returns {object}
 */
export function mapObject(target, callbackfn: MapObjectClbkFn, opt?: MapObjectOptions) {
  const {copy: cp = false, filter = false, advanced = false, forEach = false} = opt ?? {}
  const data = cp ? copy(target) : target
  const entries = Object.entries(data) ?? []
  const handler = ([key, value], index, array) =>
    // If advanced is true allow the user to set the
    // full tuple (i.e. including the object key)
    !advanced ? [key, callbackfn(value, key, index, array)] : callbackfn(value, key, index, array)
  const result: any = forEach ? entries.forEach(handler) : entries.map(handler)
  if (!forEach) {
    const filtered = !filter ? result : result.filter(([, v]) => !_isUndT(v))
    return Object.fromEntries(filtered)
  }
  return undefined
}

export type MapObjectClbkFn = (
  value: any,
  key?: string | number,
  index?: number,
  array?: Array<any>,
) => [key: string | number, value: any] | any | void
export type MapObjectOptions = {
  copy?: boolean
  filter?: boolean
  advanced?: boolean
  forEach?: boolean
}

/**
 * Filter indexes inside an object literal. Similar to
 * Array.filter(...)
 * @param target
 * @param {FilterObjPredicate<T>} predicate
 * @returns {{[p: string]: any}}
 */
export function filterObject<T>(target, predicate: FilterObjPredicate<T>) {
  return mapObject(
    target,
    (v, k, i, a): [any, any] | null => {
      if (predicate(v, k, i, a)) {
        return [k, v]
      }
      return null
    },
    {advanced: true, filter: true},
  )
}
type FilterObjPredicate<T> = {
  (value: T, key: keyof any, index: number, array: T[]): unknown
}

/**
 * Shortcut for Object.assign({}, target, ...otherTargets)
 *
 * @export
 * @template T
 * @template U
 * @param {T} target
 * @param {...U[]} source
 * @returns {(T & U)}
 */
export function updateObj<T, U>(target: T, ...source: U[]): T & U {
  // Encapsulate the idea of passing a new object as the first parameter
  // to Object.assign to ensure we correctly copy data instead of mutating
  return Object.assign({}, target, ...source)
}

/**
 *
 *
 * @export
 * @template T
 * @template K
 * @param {Readonly<T>} obj
 * @param {K} key
 * @param {{ copy: boolean }} [options]
 * @returns {T}
 */
export function deleteProperty<T, K extends keyof T>(obj: T, key: K, options?: { copy: boolean }): Omit<T, K> {
  const {copy = false} = options ?? {}
  const _obj = copy ? {...obj} : obj
  delete _obj[key]
  return _obj
}

/**
 *
 *
 * @export
 * @template T
 * @template U
 * @template F
 * @param {(Iterable<T> | ArrayLike<T>)} iterable
 * @param {(v: T, k: number) => U} [mapfn]
 * @param {*} [thisArg]
 * @returns {F extends undefined ? Array<T> : Array<U>}
 */
export function toArray<T, U, F extends (v: T, k: number) => U = undefined>(
  iterable: Iterable<T> | ArrayLike<T>,
  mapfn?: (v: T, k: number) => U,
  thisArg?: any,
): F extends undefined ? Array<T> : Array<U> {
  return Array.from(iterable, mapfn, thisArg) as F extends undefined ? Array<T> : Array<U>
}

/**
 *
 *
 * @export
 * @template T
 * @template U
 * @template F
 * @param {(Iterable<T> | ArrayLike<T>)} iterable
 * @param {F} [mapfn]
 * @param {*} [thisArg]
 * @returns {F extends undefined ? Array<T> : Array<U>}
 */
export function copyArray<T, U, F extends (v: T, k: number) => U = undefined>(
  iterable: Iterable<T> | ArrayLike<T>,
  mapfn?: F,
  thisArg?: any,
): F extends undefined ? Array<T> : Array<U> {
  return toArray(iterable, mapfn, thisArg)
}

/**
 *
 *
 * @export
 * @template T
 * @param {Array<T>} oldArray
 * @param {(Array<T> | object)} newArray
 * @returns {Array<T>}
 */
export function updateArray<T>(oldArray: Array<T>, newArray: Array<T> | Record<string, unknown>): Array<T> {
  return Object.assign([], oldArray, newArray)
}

/**
 *
 *
 * @export
 * @template T
 * @param {(number | any)} index
 * @param {Array<T>} array
 * @param {(T | Array<T>)} [items]
 * @param {{ replace?: boolean, copy?: boolean }} [options]
 * @returns {MutatedArrayResponse<T>}
 */
export function mutateArray<T>(
  index: number | any,
  array: Array<T>,
  items?: T | Array<T>,
  options?: { replace?: boolean; copy?: boolean },
): MutatedArrayResponse<T> {
  const {replace, copy} = {replace: true, copy: false, ...options}
  const _array = copy ? copyArray(array) : array
  const _items = safeArray(items, items ? [items] : [])
  const deleteCount = replace ? ln(_items) : 0
  const deleted = _array.splice(index, deleteCount, ..._items)

  return {items: _array, deleted, added: _items}
}

type MutatedArrayResponse<T> = Record<'items' | 'deleted' | 'added', Array<T>>

/**
 *
 *
 * @export
 * @template T
 * @param {number} index
 * @param {Array<T>} array
 * @param {(T | Array<T>)} items
 * @returns {MutatedArrayResponse<T>}
 */
export function addAtIndex<T>(index: number, array: Array<T>, items: T | Array<T>): MutatedArrayResponse<T> {
  return mutateArray(index, array, items, {replace: false})
}

/**
 *
 *
 * @export
 * @template T
 * @param {(number | any)} index
 * @param {Array<T>} array
 * @param {T} item
 * @returns {MutatedArrayResponse<T>}
 */
export function updateAtIndex<T>(index: number | any, array: Array<T>, item: T): MutatedArrayResponse<T> {
  return mutateArray(index, array, item)
}

/**
 *
 *
 * @export
 * @template T
 * @param {number} index
 * @param {Array<T>} array
 * @returns {MutatedArrayResponse<T>}
 */
export function removeAtIndex<T>(index: number, array: Array<T>): MutatedArrayResponse<T> {
  return mutateArray(index, array)
}

/**
 *
 *
 * @export
 * @template T
 * @param {T} item
 * @param {Array<T>} array
 * @returns {Array<T>}
 */
export function removeFromArray<T>(item: T, array: Array<T>): Array<T> {
  return safeArray(array).filter((i) => i !== item)
}

/**
 *
 *
 * @export
 * @template K
 * @template T
 * @template U
 * @param {T} array
 * @param {(K | any)} currentIndex
 * @param {(K | any)} newIndex
 * @returns {T}
 */
export function reorderArray<K extends number & keyof T, T extends Array<U>, U>(
  array: T,
  currentIndex: K | any,
  newIndex: K | any,
): T {
  const arr = mutateArray(currentIndex, array)
  return addAtIndex(newIndex, arr.items, arr.deleted).items as T
}

/**
 * Shortcut for String(val).trim()
 *
 * @export
 * @template T
 * @param {T} val
 * @returns {string}
 */
export function trim<T>(val: T): string {
  return _s(val).trim()
}

/**
 * Capitalize the first word in the string
 *
 * @export
 * @template T
 * @param {T} val
 * @returns {T}
 */
export function capitalize<T extends string>(val: T): Capitalize<T> {
  const str = _s(val)
  return `${str.charAt(0).toUpperCase()}${val.slice(1)}` as Capitalize<T>
}

/**
 * Capitalize every word separated by a space
 *
 * @export
 * @template T
 * @param {T} val
 * @param separator
 * @returns {T}
 */
export function capitalizeTitle<T extends string>(val: T, separator = ' '): T {
  return _s(val)
  .split(separator)
  .map((i) => capitalize(i))
  .join(separator) as T
}

/**
 * Create a numeronym string from the provided string of characters
 *
 * e.g.
 * ```typescript
 * const intl = 'Internationalization'
 * numeronym(intl, {kind: NumeronymKind.n19s})
 * // result: I18n
 * ```
 *
 * @export
 * @param {string} str
 * @param {NumeronymOpts} [opt]
 * @returns
 */
export function numeronym(str: string, opt?: NumeronymOpts) {
  const {kind, short} = opt ?? {}
  const builder = {
    [NumeronymKind.n19s]: () => {
      const v = String(str)
      const ln = v.length
      if (ln < 2) {
        return v
      }
      if (ln < 3 || short) {
        return `${v[0]}${ln - 1}`
      }
      return `${v[0]}${ln - 2}${v[ln - 1]}`
    },
  }

  return builder[NumeronymKind[kind] ?? NumeronymKind.n19s]()
}

export enum NumeronymKind {
  n19s = 'NumericalContractions' /* first letter + len between(+ last letter) */,
  A9bs = 'AlphanumericAbbreviationS' /* AlphaN. = A9, Abbr. = bs */,
  A2S = 'AlphanumericAcronymS' /* (2) A's and (1) S (e.g. W3 or W3C) */,
}

export type NumeronymOpts = {
  kind?: NumeronymKind
  short?: boolean
}

/**
 * Ensure and parse any value to a number
 *
 * @export
 * @param {*} val the value to parse into a number
 * @param {*} [elseT] returns this if parsing fails
 * @param {number} [radix] only necessary if value is of type string
 * @returns {(number | typeof elseT)}
 */
export function toNum(val: any, elseT?: any, radix?: number): number | typeof elseT {
  const num = _isNum(radix) && _isStrT(val) ? parseInt(val, radix) : Number(val)
  return isNaN(num) ? elseT ?? 0 : num
}

/**
 * Convert decimal/number into its Base16/Hexadecimal equivalent
 *
 * @export
 * @param {number} val
 * @returns {string}
 */
export function numberToHexadecimal(val: number): string {
  return Number(val).toString(16)
}

/**
 * Convert Base16/Hexadecimal string to its decimal/number equivalent
 *
 * @export
 * @param {string} val
 * @returns {number}
 */
export function hexadecimalToNumber(val: string): number {
  return toNum(val, 0, 16)
}

/**
 * Get the display name of a function, react component
 * @export
 * @param {*} fn
 * @param {string} fallback
 * @returns {string}
 */
export function getDisplayName(fn, fallback = 'Component'): string {
  return fn?.displayName ?? fn?.name ?? fallback
}

/**
 * No operation function with no return
 * @returns {any}
 * @param _
 */
export function noop<T>(..._: T[]): void {
  // Do nothing.
}


/**
 * Convince closure compiler that the wrapped function has no side-effects.
 *
 * Closure compiler always assumes that `toString` has no side-effects. We use this quirk to
 * allow us to execute a function but have closure compiler mark the call as no-side-effects.
 * It is important that the return value for the `noSideEffects` function be assigned
 * to something which is retained otherwise the call to `noSideEffects` will be removed by closure
 * compiler.
 *
 * @see https://github.com/angular/angular/blob/master/packages/core/src/util/closure.ts
 */
export function noSideEffects<T>(fn: () => T): T {
  return ({toString: fn}.toString() as unknown) as T
}

/**
 * Return a static property of the
 * @param {keyof any} field
 * @param thisArg
 * @returns {any}
 */
export function getStaticField<T>(field: keyof any, thisArg: T): any {
  return Object.getPrototypeOf(thisArg).constructor[field]
}

/**
 * Apply multiple base constructors to the derived constructor
 * @param derivedCtor
 * @param {any[]} baseCtor
 */
export function applyMixins(derivedCtor: any, ...baseCtor: { prototype: any }[]) {
  baseCtor.forEach((baseCtor) => {
    const proto = baseCtor.prototype
    Object.getOwnPropertyNames(proto).forEach((name) => {
      const descriptor = Object.getOwnPropertyDescriptor(proto, name) ?? Object.create(null)
      Object.defineProperty(derivedCtor.prototype, name, descriptor)
    })
  })
}

/**
 * Immutable copy
 */
namespace Copy {
  const getType = <T>(obj: T) => (toString.call(obj) as string).slice(8, -1)
  const defaultAssign = <T, S>(target: T, source: S) => {
    getAllKeys(source).forEach((key) => {
      if (Object.prototype.hasOwnProperty.call(source, key)) {
        target[key] = source[key]
      }
    })
    return target as T & S
  }
  const objectAssign = Object.assign ?? defaultAssign
  const getAllKeys = typeof Object.getOwnPropertySymbols === 'function'
    ? (obj) => Object.keys(obj).concat(Object.getOwnPropertySymbols(obj) as any)
    : (obj) => Object.keys(obj)
  type CopyParams<T, U, K, V, X> = T extends ReadonlyArray<U>
    ? ReadonlyArray<U>
    : T extends Map<K, V>
      ? Map<K, V>
      : T extends Set<X>
        ? Set<X>
        : T extends Record<string, unknown>
          ? T
          : any

  /**
   * Immutability Copy
   * @see inspiration {@link https://github.com/kolodny/immutability-helper/blob/master/index.ts}
   * @param {Copy.CopyParams<T, U, K, V, X>} value
   * @returns {any}
   */
  export function copy<T, U, K, V, X>(value: CopyParams<T, U, K, V, X>): typeof value {
    return Array.isArray(value)
      ? objectAssign(value.constructor(value.length), value)
      : getType(value) === 'Map'
        ? new Map(value as Map<K, V>)
        : getType(value) === 'Set'
          ? new Set(value as Set<X>)
          : value && typeof value === 'object'
            ? (objectAssign(Object.create(Object.getPrototypeOf(value)), value) as T)
            : (value as T)
  }
}
export const copy = Copy.copy
