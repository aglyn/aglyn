import { _isArr, _isStr, _isObjT, _isObj, _isFn, _isUndef, hasLength, _isNum } from './guards'

export function getLength<T>(val: Iterable<T> | ArrayLike<T>): number {
  return _isArr(val) || _isStr(val) ? val.length : 0
}

export function s(val: any): string {
  return String(val)
}

export function ensureArray<T>(val: T | T[], elseT: any[] = []): T[] | typeof elseT {
  return _isArr(val) ? val : elseT
}

export function ensureObject<T>(val: T, elseT: any = {}): T extends object ? T : typeof elseT {
  return _isObjT(val) ? val : elseT
}

/**
 * Set a nested property within an object literal
 *
 * EXAMPLE:
 * const obj = {'a': {'prop': {'that': 'exists'}}};
 * setNestedProperty(obj, 'a.very.deep.prop', 'value')
 *
 * @see getNestedProperty
 *
 * @param obj {object}
 * @param path {string}
 * @param val {any}
 */
export function setNestedProperty(obj: object, path: string, val: any) {
  const keys = path.split('.')
  const lastKey = keys.pop()
  const lastObj = keys.reduce((obj, key) =>
    obj[key] = obj[key] || {}, obj,
  )
  lastObj[lastKey] = val
}

/**
 * Get a nested property within an object literal
 *
 * EXAMPLE:
 * const obj = {'a': {'prop': {'that': 'exists'}}};
 * getNestedProperty(obj, 'a.very.deep.prop', 'value')
 *
 * @see setNestedProperty
 *
 * @param obj {object}
 * @param path {string}
 */
export function getNestedProperty(obj: object, path: string): any {
  const keys = path.split('.')
  const lastKey = keys.pop()
  const lastObj = keys.reduce((obj, key) =>
    obj[key] = obj[key] || {}, obj,
  )
  return lastObj[lastKey]
}

export function getProperty<T, K extends keyof T>(obj: T, key: K): T[K] {
  if (!_isObj(obj)) return undefined
  return obj[key]
}

export function copyObject<T>(obj: T): T {
  return copy(_isObj(obj) ? obj as Object : obj as unknown)
}

export function arrayToObjectLiteral(arr: [any, any][]) {
  return Object.assign({}, ...arr.map(([key, val]) => ({ [key]: val })))
}

export function getAllObjectKeys<T extends object, K extends keyof T>(obj: T): K[] {
  return (
    _isFn(Object.getOwnPropertySymbols)
      ? Object.keys(obj).concat(Object.getOwnPropertySymbols(obj) as any)
      : Object.keys(obj)
  ) as K[]
}

export function reduceObject<T extends object, K extends keyof T>(
  target: T, reducerCallback: (val: T[K], key?: K, original?: T) => T[K],
): T {
  if (_isUndef(reducerCallback)) return target
  const _target: T = copyObject(target)
  const original: T = copyObject(target)

  return getAllObjectKeys(_target).reduce((result, key) => {
    result[key as string] = reducerCallback(_target[key] as T[K], key as K, original)
    return result
  }, {}) as T
}

export type MapObjectClbkFn = (value: any, key?: string | number, index?: string | number, array?: Array<any>) => [key: string | number, value: any] | any | void
export type MapObjectOptions = { copy?: boolean, filter?: boolean, advanced?: boolean, forEach?: boolean }

/**
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
 * @param {<((val,key,index,arr) => (val|[key,val]))>} callbackfn
 * @param {<{copy: boolean, filter: boolean, advanced: boolean}>} [opt] (
 *  if !!filter - removes anything undefined,
 *  if !!advanced - the clbk should return a tuple of the new key and value [k,v]
 * )
 * @returns {object}
 */
export function mapObject(target, callbackfn: MapObjectClbkFn, opt?: MapObjectOptions) {
  const { copy: cp = false, filter = false, advanced = false, forEach = false } = opt ?? {}
  const data = cp ? copy(target) : target
  const entries = Object.entries(data)
  const method = forEach ? entries.forEach.bind(null) : entries.map.bind(null)
  const result: any = method(([key, value], index, array) => (
    // If advanced is true allow the user to set the
    // full tuple (i.e. including the object key)
    !advanced
      ? [key, callbackfn(value, key, index, array)]
      : callbackfn(value, key, index, array)
  ))
  if (!forEach) {
    const filtered = !filter ? result : result.filter(([, v]) => !_isUndef(v))
    return Object.fromEntries(filtered)
  }
  return undefined
}

export function filterObject(target, callbackfn) {
  return mapObject(target, (value, key, ...args): [any, any] | null => {
    if (_isFn(callbackfn) && callbackfn(value, key, ...args)) {
      return [key, value]
    }
    return null
  }, { advanced: true, filter: true })
}

export function updateObject<T>(target: T, source: T): T {
  // Encapsulate the idea of passing a new object as the first parameter
  // to Object.assign to ensure we correctly copy data instead of mutating
  return Object.assign({}, target, source)
}

export function deleteProperty<T, K extends keyof T>(obj: Readonly<T>, key: K, options?: { copy: boolean }): T {
  const opts = { copy: false, ...options }
  const newObj = opts.copy ? copyObject(obj) : obj
  delete newObj[key]
  return newObj
}

export function toArray<T, U, F extends (v: T, k: number) => U = undefined>(
  iterable: Iterable<T> | ArrayLike<T>, mapfn?: (v: T, k: number) => U, thisArg?: any,
): F extends undefined ? Array<T> : Array<U> {
  return Array.from(iterable, mapfn, thisArg) as F extends undefined ? Array<T> : Array<U>
}

export function copyArray<T, U, F extends (v: T, k: number) => U = undefined>(
  iterable: Iterable<T> | ArrayLike<T>, mapfn?: F, thisArg?: any,
): F extends undefined ? Array<T> : Array<U> {
  return toArray(iterable, mapfn, thisArg)
}

export function updateArray<T>(oldArray: Array<T>, newArray: Array<T> | object): Array<T> {
  return Object.assign([], oldArray, newArray)
}

type MutatedArrayResponse<T> = Record<'items' | 'deleted' | 'added', Array<T>>
export function mutateArray<T>(
  index: number | any,
  array: Array<T>,
  items?: T | Array<T>,
  options?: { replace?: boolean, copy?: boolean },
): MutatedArrayResponse<T> {
  const { replace, copy } = { replace: true, copy: false, ...options }
  const _array = copy ? copyArray(array) : array
  const _items = ensureArray(items, items ? [items] : [])
  const deleteCount = (replace ? getLength(_items) : 0)
  const deleted = _array.splice(index, deleteCount, ..._items)

  return { items: _array, deleted, added: _items }
}

export function addAtIndex<T>(index: number, array: Array<T>, items: T | Array<T>): MutatedArrayResponse<T> {
  return mutateArray(index, array, items, { replace: false })
}

export function updateAtIndex<T>(index: number | any, array: Array<T>, item: T): MutatedArrayResponse<T> {
  return mutateArray(index, array, item)
}

export function removeAtIndex<T>(index: number, array: Array<T>): MutatedArrayResponse<T> {
  return mutateArray(index, array)
}

export function removeFromArray<T>(item: T, array: Array<T>): Array<T> {
  return ensureArray(array).filter(i => i !== item)
}

export function reorderArray<K extends number & keyof T, T extends Array<U>, U>(
  array: T, currentIndex: K | any, newIndex: K | any,
): T {
  const arr = mutateArray(currentIndex, array)
  return addAtIndex(newIndex, arr.items, arr.deleted).items as T
}

export function trimString<T>(val: T): string {
  return s(val).trim()
}

export function capitalize<T extends string>(val: T): T {
  if (!_isStr(val) || !hasLength(val)) return val
  return (s(val).charAt(0).toUpperCase() + s(val).slice(1)) as T
}

export function capitalizeTitle<T extends string>(val: T): T {
  return s(val).split(' ').map(i => capitalize(i)).join(' ') as T
}

export enum NumeronymKind {
  n19s = 'NumericalContractions', /* first letter + len between(+ last letter) */
  A9bs = 'AlphanumericAbbreviationS', /* AlphaN. = A9, Abbr. = bs */
  A2S = 'AlphanumericAcronymS', /* (2) A's and (1) S (e.g. W3 or W3C) */
}
export type NumeronymOpts = {
  kind?: NumeronymKind
  short?: boolean
}
export function numeronym(str: string, opt?: NumeronymOpts) {
  const { kind, short } = opt ?? {}
  const builder = {
    [NumeronymKind.n19s]: () => {
      const v = String(str)
      const ln = v.length
      if (ln < 2) return v
      if (ln < 3 || short) return `${v[0]}${ln - 1}`
      return `${v[0]}${ln - 2}${v[ln - 1]}`
    }
  }

  return builder[NumeronymKind[kind] ?? NumeronymKind.n19s]()
}

export function toNum(val: any, elseT?: any, radix?: number): number | typeof elseT {
  let num = _isNum(radix) && _isStr(val) ? parseInt(val, radix) : Number(val)
  return isNaN(num) ? num : elseT
}

export function numToHex(val: number): string {
  return Number(val).toString(16)
}

export function hexToNum(val: string): number {
  return toNum(val, 0, 16)
}

/** ===================================================================================
 * START CHERRY PICK FROM:
 * https://github.com/kolodny/immutability-helper/blob/master/index.ts
 * =================================================================================== */
function type<T>(obj: T) {
  return (toString.call(obj) as string).slice(8, -1)
}

const getAllKeys = typeof Object.getOwnPropertySymbols === 'function'
  ? obj => Object.keys(obj).concat(Object.getOwnPropertySymbols(obj) as any)
  /* istanbul ignore next */
  : obj => Object.keys(obj)

const assign = Object.assign || /* istanbul ignore next */ (<T, S>(target: T, source: S) => {
  getAllKeys(source).forEach(key => {
    if (Object.prototype.hasOwnProperty.call(source, key)) {
      target[key] = source[key]
    }
  })
  return target as T & S
})
export function copy<T, U, K, V, X>(
  object: T extends ReadonlyArray<U>
    ? ReadonlyArray<U>
    : T extends Map<K, V>
    ? Map<K, V>
    : T extends Set<X>
    ? Set<X>
    : T extends object
    ? T
    : any,
) {
  return Array.isArray(object)
    ? assign(object.constructor(object.length), object)
    : (type(object) === 'Map')
      ? new Map(object as Map<K, V>)
      : (type(object) === 'Set')
        ? new Set(object as Set<X>)
        : (object && typeof object === 'object')
          ? assign(Object.create(Object.getPrototypeOf(object)), object) as T
          /* istanbul ignore next */
          : object as T
}
/** ===================================================================================
 * END CHERRY PICK FROM:
 * https://github.com/kolodny/immutability-helper/blob/master/index.ts
 * =================================================================================== */