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

/** A type of null or undefined */
export type NUN = null | undefined

/** Construct a type from type of T or null */
export type OrNull<T> = T | null

/** Construct a type from type of T or undefined */
export type OrUndef<T> = T | undefined

/** Construct a type from type of T or null or undefined */
export type OrNUN<T> = T | NUN

/** Construct a type from type of T or never */
export type OrNever<T> = T | never

/** Construct a type from type of T or unknown */
export type OrUnk<T> = T | unknown

/** Construct a type from type of T or any */
export type OrAny<T> = T | any

/** A index signature for a object key  */
export type PKey = string | number | symbol

/** A index signature for a mapped object */
export type MapKey = string | symbol

/** @alias MapKey */
export type MKey = MapKey

/** The index signature type of T */
export type KeyOf<T> = keyof T

/** The index value type of T  */
export type IndexOf<T, K extends KeyOf<T> = KeyOf<T>> = T[K]

/** From T, omit properties whose values are in union U */
export type OmitIndexOfType<T, U> = {
  [K in IndexOf<T, KeyOf<T>> extends U ? never : KeyOf<T>]: T[K]
}

/** From T, omit properties in union with 'K' "distributively" for union types */
export type DistributiveOmit<T, K extends PKey> = T extends any ? Omit<T, K> : never

/** Plain old dictionary of key(K)-value(T) pairs with string signatures */
export type KeyValueMap<K extends PKey = PKey, T = unknown> = Record<K, T>

/** Dictionary collection with string index types (optionally specify value by setting T) */
export type Dictionary<T = unknown> = KeyValueMap<string, T>

/** Any type of object record with string index types */
export type AnyProps = Partial<Record<string, unknown>>

/** Dictionary collection optionally specify values to T */
export type EmptyObj<K extends PKey = PKey> = Record<K, never>

/** Type safe object "{}" record (optionally specify index type) */
export type AnyObj<K extends PKey = PKey> = Record<K, unknown>

/** Record with only readonly properties */
export type ReadonlyRecord<K extends PKey, T> = { [P in K]: T }

/** Response value, Promise or Promise-Like value  */
export type ValueOrPromise<T> = T extends Promise<unknown> ? T : T | PromiseLike<T>

/** Allows conditional typing ype alias */
export type Conditional<LEFT, RIGHT, TRUE, FALSE = never> = LEFT extends RIGHT ? TRUE : FALSE

/** Allows conditional non-distributive typing type alias @see https://www.typescriptlang.org/docs/handbook/2/conditional-types.html#distributive-conditional-types */
export type ConditionalNonDist<LEFT, RIGHT, TRUE, FALSE = never> = [LEFT] extends [RIGHT]
  ? TRUE
  : FALSE

/** If X extends true then Y */
export type IfTrueOr<TRUE, ELSE> = Conditional<TRUE, true, ELSE>

/** If X extends true then Y */
export type IfTrueOrNonDist<TRUE, ELSE> = ConditionalNonDist<TRUE, true, ELSE>

/** From T, make all top level keys mutable (removes readonly) */
export type MutableShallow<T> = {
  -readonly [P in keyof T]: T[P]
}

/** From T, make all keys mutable including nested objects/arrays (removes readonly) */
export type MutableDeep<T> = {
  -readonly [P in keyof T]: T[P] extends ReadonlyArray<infer U>
    ? MutableDeep<U>[]
    : MutableDeep<T[P]>
}

/** From T, require properties whose keys are in union K (make specific keys required) */
export type RequiredPick<T, K extends keyof T> = Omit<T, K> & Required<Pick<T, K>>

/** From T, require properties whose keys are in union K and the rest as partial (make specific keys required) */
export type RequiredPickAlt<T, K extends keyof T> = Partial<Omit<T, K>> & Required<Pick<T, K>>

/** From T, make properties partial whose keys are in union K (Make specific keys optional) */
export type PartialPick<T, K extends keyof T> = Omit<T, K> & Partial<Pick<T, K>>

/** From T, make properties partial whose keys are in union K and the rest as required (Make specific keys optional) */
export type PartialPickAlt<T, K extends keyof T> = Required<Omit<T, K>> & Partial<Pick<T, K>>

/** From T, extract keys whose types are required (excludes optional properties) (optionally narrow keys in union by specifying K) */
export type KeyOfPickRequired<T, K extends keyof T = keyof T> = {
  [P in K]-?: Pick<T, P> extends AnyObj ? never : P
}[K]

/** From T, extract keys whose types are optional (excludes required properties) (optionally narrow keys in union by specifying K) */
export type KeyOfPickPartial<T, K extends keyof T = keyof T> = {
  [P in K]-?: Pick<T, P> extends AnyObj ? P : never
}[K]

/** From T, pick a set of properties whose keys are in the union with required keys only, (optionally narrow results by specifying K) */
export type PickRequired<T, K extends keyof T = keyof T> = Pick<T,
  {
    [P in K]-?: Pick<T, P> extends AnyObj ? never : P
  }[K]>

/** From T, pick a set of properties whose keys are in the union with partial keys only, (optionally narrow results by specifying K) */
export type PickPartial<T, K extends keyof T = keyof T> = Pick<T,
  {
    [P in K]-?: Pick<T, P> extends AnyObj ? P : never
  }[K]>

/** From T, rename a property whose key is in the union K (old key) with that of U (new key)  */
export type RenamedKey<T, Old extends keyof T, New extends PKey> = Omit<T, Old> & {
  [P in New]: T[Old]
}

/** With L (left), spread properties with R (right) (e.g. [...L, ...R], {...L, ...R}) */
export type Spreaded<L, R> = /* With L (left), omit keys not in union with keys of R (right)*/
  Omit<L, keyof R> &
  /* With R (right), omit keys in union with partial types*/
  Omit<R, KeyOfPickPartial<R>> &
  /* With R (right), pick properties in union with optional types that do not exist in L (left) */
  Pick<R,
    Exclude<KeyOfPickPartial<R>, keyof L>> & /* With L (left), replace properties of the keys in union with the keys in R (right) excluding properties of R (right) with types in union with undefined */
  {
    [P in KeyOfPickPartial<R> &
    (keyof L extends keyof L & keyof R ? KeyOfPickPartial<R> & keyof L : never)]:
    | L[P]
    | Exclude<R[P], undefined>
  }

/** Field property getters */
export type Getters<T> = {
  [K in keyof T as `get${Capitalize<string & K>}`]: () => T[K]
}

/** Field property setters */
export type Setters<T> = {
  [K in keyof T as `set${Capitalize<string & K>}`]: (value: T[K] | null) => T
}

/** Field property setters e.g. Implements<'get', 'id', ()=>string> === { getId:()=>this.id } */
export type Implements<Verb extends string,
  Noun extends string,
  T extends (...args: unknown[]) => unknown | void> = {
  [P in Noun as `${Verb}${Capitalize<string & Noun>}`]: T
}

/** Field property setters */
export type ImplementsOn<K extends string, T extends (...args: unknown[]) => void> = Implements<'on',
  K,
  T>

// export type Constructor
export type BasicConstructor<T = unknown> = new (...args: T[]) => any
