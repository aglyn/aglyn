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

/** A index signature for a object key  */
export type PKey = PropertyKey

/** A index signature for a mapped object */
export type MapKey = string | symbol

/** @alias MapKey */
export type MKey = MapKey

/** Any type of object record with string index types */
export type AnyProps = Record<string, unknown>

/**
 * Dictionary collection with string index types (optionally specify value by setting T)
 */
export type Dictionary<T = unknown> = Record<string, T>

/** Dictionary collection optionally specify values to T */
export type EmptyObj<K extends keyof any = PropertyKey> = Record<K, never>

/** Type safe object "{}" record (optionally specify index type) */
export type AnyObj<K extends PropertyKey = PropertyKey> = Record<K, unknown>

/** Record with only readonly properties */
export type ReadonlyRecord<K extends keyof any, T> = Readonly<Record<K, T>>

/** Response value, Promise or Promise-Like value  */
export type ValueOrPromise<T> = T extends Promise<unknown> ? T : T | PromiseLike<T>

/** Allows conditional typing ype alias */
export type Conditional<LEFT, RIGHT, TRUE, FALSE = never> = LEFT extends RIGHT ? TRUE : FALSE

/** Allows conditional non-distributive typing type alias @see https://www.typescriptlang.org/docs/handbook/2/conditional-types.html#distributive-conditional-types */
export type ConditionalNonDist<LEFT, RIGHT, TRUE, FALSE = never> = [LEFT] extends [RIGHT] ? TRUE : FALSE

/** If X extends true then Y */
export type IF<X, Y> = Conditional<X, true, Y>

/** Plain old dictionary of key(K)-value(T) pairs with string signatures */
export type KV<T = unknown, K extends string = string> = Record<K, T>

/** The index signature type of T */
export type KeyOf<T> = keyof T

/** The index value type of T  */
export type IndexOf<T, K extends KeyOf<T> = KeyOf<T>> = T[K]

/** From T, make all top level keys mutable (removes readonly) */
export type Mutable<T> = {
  -readonly [P in keyof T]: T[P]
}
/** From T, make all keys mutable including nested objects/arrays (removes readonly) */
export type DeeplyMutable<T> = {
  -readonly [P in keyof T]: (T[P] extends ReadonlyArray<infer U> ? DeeplyMutable<U>[] : DeeplyMutable<T[P]>)
}

/** From T, require properties whose keys are in union K (make specific keys required) */
export type PartRequired<T, K extends keyof T> = Omit<T, K> & Required<Pick<T, K>>
/** From T, make properties partial whose keys are in union K (Make specific keys optional) */
export type PartPartial<T, K extends keyof T> = Omit<T, K> & Partial<Pick<T, K>>

/** From T, extract keys whose types are required (excludes optional properties) (optionally narrow keys in union by specifying K) */
export type RequiredKeysOnly<T, K extends keyof T = keyof T> = {
  [P in K]-?: (Pick<T, P> extends AnyObj ? never : P)
}[K]
/** From T, extract keys whose types are optional (excludes required properties) (optionally narrow keys in union by specifying K) */
export type PartialKeysOnly<T, K extends keyof T = keyof T> = {
  [P in K]-?: (Pick<T, P> extends AnyObj ? P : never)
}[K]

/** From T, pick a set of properties whose keys are in the union with required keys only, (optionally narrow results by specifying K) */
export type PickRequiredOnly<T, K extends keyof T = keyof T> = Pick<T, {
  [P in K]-?: (Pick<T, P> extends AnyObj ? never : P)
}[K]>
/** From T, pick a set of properties whose keys are in the union with partial keys only, (optionally narrow results by specifying K) */
export type PickPartialOnly<T, K extends keyof T = keyof T> = Pick<T, {
  [P in K]-?: (Pick<T, P> extends AnyObj ? P : never)
}[K]>

/** From T, rename a property whose key is in the union K (old key) with that of U (new key)  */
export type RenameKey<T, K extends keyof T, U extends string> = (Omit<T, K> & { [P in U]: T[K] })

/** With L (left), spread properties with R (right) (e.g. [...L, ...R], {...L, ...R}) */
export type Spreaded<L, R> = (
  /* With L (left), omit keys not in union with keys of R (right)*/
  Omit<L, keyof R>
  /* With R (right), omit keys in union with partial types*/
  & Omit<R, PartialKeysOnly<R>>
  /* With R (right), pick properties in union with optional types that do not exist in L (left) */
  & Pick<R, Exclude<PartialKeysOnly<R>, keyof L>>
  /* With L (left), replace properties of the keys in union with the keys in R (right) excluding properties of R (right) with types in union with undefined */
  & { [P in (PartialKeysOnly<R> & (keyof L extends (keyof L & keyof R) ? (PartialKeysOnly<R> & keyof L) : never))]: (L[P] | Exclude<R[P], undefined>) }
  )

/** Field property getters */
export type Getters<T> = {
  [K in keyof T as `get${Capitalize<string & K>}`]: () => T[K]
}

/** Field property setters */
export type Setters<T> = {
  [K in keyof T as `set${Capitalize<string & K>}`]: (value: T[K] | null) => T
}

/** Field property setters */
export type Implements<K1 extends string, K2 extends string, T extends (...args: unknown[]) => unknown> = {
  [P in K2 as `${K1}${Capitalize<string & K2>}`]: T
}

/** Field property setters */
export type ImplementsOn<K extends string, T extends (...args: unknown[]) => void> = Implements<'on', K, T>

// export type Constructor
export type BasicConstructor<T = unknown> = new (...args: T[]) => {}

/** Implements a toString method */
export interface StringLike {
  toString(): string
  [Symbol.toStringTag]?: string
}

/** Implements a toJSON method */
export interface Serializable {
  toJSON(): any
}
