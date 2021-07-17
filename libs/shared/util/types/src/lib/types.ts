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

/** Same as type AnyProps with option to set specified values to T */
export type Dictionary<T = unknown> = Record<string, T>

/** Make object properties writeable */
export type Mutable<T> = {
  -readonly [P in keyof T]: T[P]
}

/** Make deeply nest object properties writeable */
export type MutableDeep<T> = {
  -readonly [P in keyof T]: T[P] extends ReadonlyArray<infer U> ? MutableDeep<U>[] : MutableDeep<T[P]>
}

/** Extract keys from T whose types are required and exclude those which are optional  */
export type RequiredKeys<T, K extends keyof T = keyof T> = { [P in K]-?: ({} extends Pick<T, P> ? never : P) }[K]

/** From T, pick a set of properties whose keys are in the union with required keys */
export type RequiredOnly<T, K extends keyof T = keyof T> = Pick<T, RequiredKeys<T, K>>

/** Extract keys from T whose types are optional and exclude those which are required */
export type OptionalKeys<T, K extends keyof T = keyof T> = {
  [P in K]-?: (Record<string | number | symbol, unknown> extends Pick<T, P> ? P : never)
}[K]

/** From T, pick a set of properties whose keys are in the union with optional keys */
export type OptionalOnly<T, K extends keyof T = keyof T> = Pick<T, OptionalKeys<T, K>>

/** From T, rename a property whose key is in the union K with that of N */
export type Rename<T, K extends keyof T, N extends string> = Omit<T, K> & { [P in N]: T[K] }

/** Spreads object literal properties of Left(L) and Right(R) like so: { ...L, ...R } */
export type Spread<L, R> = (
  /* Properties in L that don't exist in R */
  Omit<L, keyof R>
  /* Properties in R with types that exclude optional */
  & Omit<R, OptionalKeys<R>>
  /* Properties in R, with types that include optional, that don't exist in L */
  & Pick<R, Exclude<OptionalKeys<R>, keyof L>>
  /* Properties in R, with types that include optional, that exist in L */
  & SpreadProperties<L, R, OptionalKeys<R> & keyof L>
  )

/** Common properties from L and R with undefined in R[K] replaced by type in L[K] */
type SpreadProperties<L, R, K extends keyof L & keyof R> = {
  [P in K]: L[P] | Exclude<R[P], undefined>
}
