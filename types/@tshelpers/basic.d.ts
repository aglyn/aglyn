/**
 * @license
 * Copyright 2023 Aglyn LLC
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

declare global {
  /** The index key when symbol is not supported */
  type Key = string | number

  /** The index signature for an object key  */
  type PKey = string | number | symbol

  /** The index signature for a mapped object */
  type MapKey = string | symbol

  /** The index signature type of T */
  type KeyOf<T> = keyof T

  /** The index value type of T  */
  type IndexOf<T, K extends KeyOf<T> = KeyOf<T>> = T[K]

  /** From T, omit properties whose values are in union U */
  type OmitIndexOfType<T, U> = {
    [K in IndexOf<T, KeyOf<T>> extends U ? never : KeyOf<T>]: T[K]
  }

  /** From T, omit properties in union with 'K' "distributively" for union types */
  type DistributiveOmit<T, K extends PKey> = T extends any ? Omit<T, K> : never

  /** Plain old dictionary of key(K)-value(T) pairs with string signatures */
  type KeyValueMap<K extends PKey = PKey, T = unknown> = Record<K, T>

  /** Dictionary collection with string index types (optionally specify value by setting T) */
  type Dictionary<T = unknown> = KeyValueMap<string, T>

  /** Any type of object record with string index types */
  type AnyProps = Partial<Record<string, unknown>>

  /** Dictionary collection optionally specify values to T */
  type EmptyObj<K extends PKey = PKey> = Record<K, never>

  /** Type safe object "{}" record (optionally specify index type) */
  type AnyObj<K extends PKey = PKey> = Record<K, unknown>

  /** Record with only readonly properties */
  type ReadonlyRecord<K extends PKey, T> = Readonly<{ [P in K]: T }>

  /** Response value, Promise or Promise-Like value  */
  type ValueOrPromise<T> = T extends Promise<unknown> ? T : T | PromiseLike<T>

  /** Allows conditional typing ype alias */
  type Conditional<L, R, T, F = never> = L extends R ? T : F

  /** Allows conditional non-distributive typing type alias @see https://www.typescriptlang.org/docs/handbook/2/conditional-types.html#distributive-conditional-types */
  type ConditionalNonDist<L, R, T, F = never> = [L] extends [R] ? T : F

  /** If X extends true then Y */
  type IfTrueOr<TRUE, ELSE> = Conditional<TRUE, true, ELSE>

  /** If X extends true then Y */
  type IfTrueOrNonDist<TRUE, ELSE> = ConditionalNonDist<TRUE, true, ELSE>

  /** From T, make all top level keys mutable (removes readonly status) */
  type MutableShallow<T> = { -readonly [P in keyof T]: T[P] }

  /** From T, make all top level keys immutable (adds readonly status) */
  type ImmutableShallow<T> = { readonly [P in keyof T]: T[P] }

  /** From T, make all keys mutable (removes readonly) */
  type MutableDeep<T> = {
    -readonly [P in keyof T]: T[P] extends ReadonlyArray<infer U>
      ? MutableDeep<U>[]
      : T[P] extends ReadonlySet<infer U>
        ? MutableDeep<Set<U>>
        : T[P] extends ReadonlyMap<infer K, infer U>
          ? MutableDeep<Map<K, U>>
          : MutableDeep<T[P]>
  }

  /** From T, make all top level and second level keys mutable (removes readonly) */
  type MutableSlightlyDeep<T> = {
    -readonly [P in keyof T]: T[P] extends ReadonlyArray<infer U>
      ? MutableShallow<U>[]
      : T[P] extends ReadonlySet<infer U>
        ? MutableShallow<Set<U>>
        : T[P] extends ReadonlyMap<infer K, infer U>
          ? MutableShallow<Map<K, U>>
          : MutableShallow<T[P]>
  }

  /** From T, make all keys immutable (adds readonly status) */
  type ImmutableDeep<T> = {
    readonly [P in keyof T]: T[P] extends ReadonlyArray<infer U>
      ? ImmutableDeep<U>[]
      : T[P] extends ReadonlySet<infer U>
        ? ImmutableDeep<Set<U>>
        : T[P] extends ReadonlyMap<infer K, infer U>
          ? ImmutableDeep<Map<K, U>>
          : ImmutableDeep<T[P]>
  }

  /** From T, make all top level and second keys mutable (adds readonly status) */
  type ImmutableSlightlyDeep<T> = {
    readonly [P in keyof T]: T[P] extends ReadonlyArray<infer U>
      ? ImmutableShallow<U>[]
      : T[P] extends ReadonlySet<infer U>
        ? ImmutableShallow<Set<U>>
        : T[P] extends ReadonlyMap<infer K, infer U>
          ? ImmutableShallow<Map<K, U>>
          : ImmutableShallow<T[P]>
  }

  /** From T, make mutable properties whose keys are in union K (make specific keys mutable) */
  type MutableKeys<T, K extends keyof T> = Omit<T, K> &
    MutableShallow<Pick<T, K>>

  /** From T, make mutable properties whose keys are in union K (make specific keys mutable) */
  type ImmutableKeys<T, K extends keyof T> = Omit<T, K> &
    ImmutableShallow<Pick<T, K>>

  /** From T, require properties whose keys are in union K (make specific keys required) */
  type RequireKeys<T, K extends keyof T> = Omit<T, K> & Required<Pick<T, K>>

  /** From T, require properties whose keys are in union K and the rest as partial (make specific keys required) */
  type PartialWithRequired<T, K extends keyof T> = Partial<Omit<T, K>> &
    Required<Pick<T, K>>

  /** From T, make properties partial whose keys are in union K (Make specific keys optional) */
  type PartialKeys<T, K extends keyof T> = Partial<Pick<T, K>> & Omit<T, K>

  /** From T, make properties partial whose keys are in union K and the rest as required (Make specific keys optional and rest required) */
  type RequiredWithPartial<
    T,
    Opt extends keyof T,
    Req extends keyof T = Opt,
  > = Required<Omit<T, Req>> & Partial<Pick<T, Opt>>

  /** From T, extract keys whose types are required (excludes optional properties) (optionally narrow keys in union by specifying K) */
  type ExtractRequiredKeys<T, K extends keyof T = keyof T> = {
    [P in K]-?: Pick<T, P> extends AnyObj ? never : P
  }[K]

  /** From T, extract keys whose types are optional (excludes required properties) (optionally narrow keys in union by specifying K) */
  type ExtractPartialKeys<T, K extends keyof T = keyof T> = {
    [P in K]-?: Pick<T, P> extends AnyObj ? P : never
  }[K]

  /** From T, pick a set of properties whose keys are in the union with required keys only, (optionally narrow results by specifying K) */
  type PickRequired<T, K extends keyof T = keyof T> = Pick<
    T,
    {
      [P in K]-?: Pick<T, P> extends AnyObj ? never : P
    }[K]
  >

  /** From T, pick a set of properties whose keys are in the union with partial keys only, (optionally narrow results by specifying K) */
  type PickPartial<T, K extends keyof T = keyof T> = Pick<
    T,
    {
      [P in K]-?: Pick<T, P> extends AnyObj ? P : never
    }[K]
  >

  /** From T, replace a property whose key is in the union K (old key) with that of N[K]:V (key: value)  */
  type Replace<T, K extends keyof T, V, N extends PKey = K> = Omit<T, K> & {
    [P in N]: V
  }

  /** From T, rename a property whose key is in the union K (old key) with that of N (new key)  */
  type ReplaceKey<T, K extends keyof T, N extends PKey> = Omit<T, K> & {
    [P in N]: T[K]
  }

  /** From T, replace a property value whose key is in the union K (old key) with that of V (new value)  */
  type ReplaceIndex<T, K extends keyof T, V> = Omit<T, K> & {
    [P in K]: V
  }

  /** From T, replace a property value whose key is in the union K (old key) with that of V (new value)  */
  type PrefixKeys<
    T,
    Prefix extends keyof any,
    K extends keyof T = keyof T,
  > = Omit<T, K> & {
    [P in K as `${string & Prefix}${Capitalize<string & P>}`]: T[P]
  }

  /** With L (left), spread properties with R (right) (e.g. [...L, ...R], {...L, ...R}) */
  type Spreaded<L, R = never> =
    /* With L (left), omit keys not in union with keys of R (right)*/
    Omit<L, keyof R> &
      /* With R (right), omit keys in union with partial types*/
      Omit<R, ExtractPartialKeys<R>> &
      /* With R (right), pick properties in union with optional types that do not exist in L (left) */
      Pick<
        R,
        Exclude<ExtractPartialKeys<R>, keyof L>
      > /* With L (left), replace properties of the keys in union with the keys in R (right) excluding properties of R (right) with types in union with undefined */ & {
        [P in ExtractPartialKeys<R> &
          (keyof L extends keyof L & keyof R
            ? ExtractPartialKeys<R> & keyof L
            : never)]: L[P] | Exclude<R[P], undefined>
      }

  /** Field property getters */
  type Getters<T> = {
    [K in keyof T as `get${Capitalize<string & K>}`]: () => T[K]
  }

  /** Field property setters */
  type Setters<T> = {
    [K in keyof T as `set${Capitalize<string & K>}`]: (value: T[K] | null) => T
  }

  /** Field property setters e.g. Implements<'get', 'id', ()=>string> === { getId:()=>this.id } */
  type Implements<
    Verb extends string,
    Noun extends string,
    T extends (...args: unknown[]) => unknown | void,
  > = {
    [P in Noun as `${Verb}${Capitalize<string & Noun>}`]: T
  }

  /** Field property setters */
  type ImplementsOn<
    K extends string,
    T extends (...args: unknown[]) => void,
  > = Implements<'on', K, T>

  // type Constructor
  type BasicConstructor<T = unknown> = new (...args: T[]) => any
}

export {}
