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

import { Serializable } from './serializable'


/**
 * Local properties and methods required for CRUD logic
 * (create, read, update delete)
 *
 * @export
 * @interface CrudModel
 * @extends {Serializable<T>}
 * @template T
 * @template V
 */

export interface CrudModel<T = any, V = any> extends Serializable<T> {

  /**
   * All data to c.r.u.d.
   *
   * @type {T}
   * @memberof CrudModel
   */
  readonly model: T

  /**
   *  Set the value of an index on the model property
   *
   * @param {ID} id
   * @param {V} value
   * @returns {this}
   * @memberof CrudModel
   */
  set<K extends keyof T>(id: K, value: V): this

  /**
   * Get the value of an index on the model property
   *
   * @param {ID} id
   * @returns {(V | null)}
   * @memberof CrudModel
   */
  get<K extends keyof T>(id: K): T[K] | null

  /**
   * Check if the index signature (id) exists on the model property
   *
   * @param {ID} id
   * @returns {boolean}
   * @memberof CrudModel
   */
  has<K extends keyof T>(id: K): boolean

  /**
   * Remove an index from the model property
   *
   * @param {ID} id
   * @returns {this}
   * @memberof CrudModel
   */
  del<K extends keyof T>(id: K): this
}
