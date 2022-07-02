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

import type {Serializable} from './serializable'


/**
 * Local properties and methods required for CRUD logic
 * (create, read, update delete)
 */
export interface CrudModel<T = any, V = any> extends Serializable<T> {

  /**
   * All data to c.r.u.d.
   */
  readonly model: T

  /**
   *  Set the value of an index on the model property
   */
  set<K extends keyof T>(id: K, value: V): this

  /**
   * Get the value of an index on the model property
   */
  get<K extends keyof T>(id: K): T[K] | null

  /**
   * Check if the index signature (id) exists on the model property
   */
  has<K extends keyof T>(id: K): boolean

  /**
   * Remove an index from the model property
   */
  delete<K extends keyof T>(id: K): this
}
