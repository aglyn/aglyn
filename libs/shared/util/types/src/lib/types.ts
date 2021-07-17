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

/** Type any property on object with string keys */
export type AnyProps = Record<string, unknown>

/** Dictionary collection optionally specify values to T */
export type Dictionary<T = unknown> = Record<string, T>

/** Dictionary collection optionally specify values to T */
export type EmptyObj<K extends keyof any = never> = Record<K, never>

/** Type safe object "{}" record */
export type AnyObj = Record<PropertyKey, unknown>

/** Make object properties writeable */
export type Mutable<T> = {
  -readonly [P in keyof T]: T[P]
}
/** Make deeply nest object properties writeable */
export type MutableDeep<T> = {
  -readonly [P in keyof T]: T[P] extends ReadonlyArray<infer U>
    ? MutableDeep<U>[]
    : MutableDeep<T[P]>
}

/** Make specific keys optional */
export type WithRequired<T, K extends keyof T> = Omit<T, K> & Required<Pick<T, K>>
/** Make specific keys required */
export type WithPartial<T, K extends keyof T> = Omit<T, K> & Partial<Pick<T, K>>

/** Extract keys from T whose types are required and exclude those which are optional  */
export type TheRequiredKeys<T, K extends keyof T = keyof T> = {
  [P in K]-?: (Pick<T, P> extends AnyObj
    ? never : P)
}[K]
/** Extract keys from T whose types are optional and exclude those which are required */
export type TheOptionalKeys<T, K extends keyof T = keyof T> = {
  [P in K]-?: (Pick<T, P> extends AnyObj
    ? P : never)
}[K]

/** From T, pick a set of properties whose keys are in the union with required keys */
export type PickRequired<T, K extends keyof T = keyof T> = Pick<T, TheRequiredKeys<T, K>>
/** From T, pick a set of properties whose keys are in the union with optional keys */
export type PickOptionals<T, K extends keyof T = keyof T> = Pick<T, TheOptionalKeys<T, K>>

/** From T, rename a property whose key is in the union K with that of N */
export type RenameKey<Old extends keyof T, New extends string, T> = (
  Omit<T, Old> & { [P in New]: T[Old] }
  )

/** Spreads object literal properties of Left(L) and Right(R) result: { ...L, ...R } */
export type Spread<L, R> = (
  /* Properties in L that don't exist in R */
  Omit<L, keyof R>
  /* Properties in R with types that exclude optional */
  & Omit<R, TheOptionalKeys<R>>
  /* Properties in R, with types that include optional, that don't exist in L */
  & Pick<R, Exclude<TheOptionalKeys<R>, keyof L>>
  /* Properties in R, with types that include optional, that exist in L */
  & SpreadProperties<L, R, TheOptionalKeys<R> & keyof L>
  )

/** Common properties from L and R with undefined in R[K] replaced by type in L[K] */
type SpreadProperties<L, R, K extends keyof L & keyof R> = {
  [P in K]: L[P] | Exclude<R[P], undefined>
}
