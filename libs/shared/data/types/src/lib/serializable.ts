/**
 * @license
 * Copyright 2022 Aglyn LLC
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

export type iJSONMapKey = string
export type iJSONListIndex = number
export type iJSONPrimitive =
  | string
  | number
  | boolean
  | undefined
  | null
  | symbol
export type iJSONMap = { [key: iJSONMapKey]: iJSONValue }
export type iJSONList = ArrayLike<iJSONValue>
export type iJSONValue = iJSONPrimitive | iJSONMap | iJSONList
export type iJSON =
  | iJSONValue
  | Record<iJSONMapKey, iJSONValue>
  | ArrayLike<iJSONValue>

/** Implements a toJSON method */
export interface Serializable<T = iJSON> {
  toJSON?(): T
}
