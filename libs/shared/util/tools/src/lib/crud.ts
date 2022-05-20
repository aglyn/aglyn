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


// eslint-disable-next-line @nrwl/nx/enforce-module-boundaries
import type {CrudModel} from '@aglyn/shared-data-types'


/**
 * Methods (set, get, has, del) to c.r.u.d. an index of the data property
 *
 * @export
 * @abstract
 * @class Crud
 * @implements {Crud<T>}
 * @template T
 */
export abstract class Crud<T = any> implements CrudModel<T> {
  /**
   * Creates an instance of Crud.
   * @param {T} [model={} as any]
   * @memberof Crud
   */
  constructor(public model: T = {} as any) { }

  /** @inheritdoc */
  public toJSON(): T { return this.model }

  /** @inheritdoc */
  public set<K extends keyof T>(id: K, value: any): this {
    this.model[id] = value
    return this
  }

  /** @inheritdoc */
  public get<K extends keyof T>(id: K): T[K] | null { return this.model[id] }

  /** @inheritdoc */
  public has<K extends keyof T>(id: K): boolean { return this.hasOwnProperty.call(this.model, id) }

  /** @inheritdoc */
  public delete<K extends keyof T>(id: K): this {
    delete this.model[id]
    return this
  }

  private get hasOwnProperty() {
    return Object.prototype.hasOwnProperty
  }
}
