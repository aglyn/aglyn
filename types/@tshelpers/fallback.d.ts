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
  /** A type of null or undefined */
  type NUN = null | undefined
  /** A type of which evaluates to true */
  type TRUTHY = object | any[] | true | string | symbol | number
  /** A type of which evaluates to true */
  type FALSY = null | undefined | false | never | 0
  /** Construct a type from type of T or null */
  type OrNull<T> = T | null
  /** Construct a type from type of T or undefined */
  type OrUndef<T> = T | undefined
  /** Construct a type from type of T or null or undefined */
  type OrNUN<T> = T | NUN
  /** Construct a type from type of T or never */
  type OrNever<T> = T | never
  /** Construct a type from type of T or unknown */
  type OrUnk<T> = T | unknown
  /** Construct a type from type of T or any */
  type OrAny<T> = T | any
}

export {}
