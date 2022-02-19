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

import {Serializable} from './serializable'


type ID = string

/** Normalized local state design for interfacing with 3NF rules  */
export type NormalizedData<T = any, K extends ID = ID> = {
  allIds: K[],
  byId: { [P in K]?: T }
}

/**
 * Normalized data for 3NF
 * @see https://en.wikipedia.org/wiki/Third_normal_form
 *
 * @export
 * @interface NormalizedModel
 * @extends {NormalizedData<T, K>}
 * @extends {Serializable<NormalizedData<T, K>>}
 * @template T
 * @template K
 */
export interface NormalizedModel<T = any, K extends ID = ID> extends NormalizedData<T, K>, Serializable<NormalizedData<T, K>> {
  readonly length: number
  /**
   * The properties to keep when object is passed to JSON.stringify(...)
   * @returns {NormalizedData<T, K>}
   * @memberof NormalizedModel
   */
  toJSON(): NormalizedData<T, K>
  /**
   * Converts the current values into an array ordered by the
   * appearance of the key in allIds array
   * @returns {Array<T>}
   * @memberof NormalizedModel
   */
  toArray(): Array<T>
  /**
   * Clears all values
   * @returns {this}
   * @memberof NormalizedModel
   */
  clear(): this
  /**
   * Aliases the static method to shortcut delete operations on this instance
   *
   * @param {K} id
   * @returns {this}
   * @memberof NormalizedModel
   */
  remove(id: K): this
  /**
   * Returns whether or not the data byId has property key
   *
   * @param {ID} id
   * @returns {boolean}
   * @memberof NormalizedModel
   */
  has(id: ID): boolean
  /**
   * Aliases the static method to shortcut set operations on this instance
   *
   * @param {ID} id
   * @param {*} [value]
   * @param {number} [index]
   * @returns {this}
   * @memberof NormalizedModel
   */
  set(id: ID, value?: T, index?: number): this
  /**
   * Shortcuts getting the value of properties of the current instance
   *
   * @param {ID} id
   * @returns {(undefined | T)}
   * @memberof NormalizedModel
   */
  get(id: ID): undefined | T
}
