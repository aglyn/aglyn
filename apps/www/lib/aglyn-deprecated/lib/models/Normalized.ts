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

import { NormalizedData, NormalizedModel } from '../interfaces/normalized'
import {
  _isNum,
  _isObj,
} from '@aglyn/shared/util/guards'
import {
  arrayRemoveItem,
  arrayReorder,
  deleteProperty,
} from '@aglyn/shared/util/tools'


type ID = string

/**
 * Normalized data for 3NF
 *
 * @export
 * @abstract
 * @class Normalized
 * @extends {NormalizedData<T, K>}
 * @template T
 * @template K
 * @see https://en.wikipedia.org/wiki/Third_normal_form
 */
export class Normalized<T = any, K extends ID = ID> implements NormalizedModel<T, K> {

  static build<T, K extends ID>(): NormalizedData<T, K> {
    return {allIds: [], byId: {}}
  }

  public allIds: K[] = []
  public byId: { [P in K]?: T } = {}

  public get length(): number { return (this.allIds ?? []).length }

  constructor(public readonly props?: NormalizedData<T, K>) {
    const {allIds, byId} = {...props}
    this.allIds = allIds ?? []
    this.byId = byId ?? {}
  }

  /**
   * Maps the ids/keys to their respective values in byId
   *
   * @static
   * @template T
   * @template V
   * @param {T} v
   * @returns {V[]}
   * @memberof Normalized
   */
  public static toArray<T extends NormalizedData<V>, V>(v: T): V[] {
    return Array.from(v.allIds).map((id) => v.byId[id])
  }

  /**
   * Resets the keys/allIds and values/byId back to empty
   *
   * @static
   * @param {NormalizedData} v
   * @returns {NormalizedData}
   * @memberof Normalized
   */
  public static clear<T extends NormalizedData<any>>(v: T): T {
    v.allIds = []
    v.byId = {}
    return v
  }

  /**
   * Clears all values
   * @returns {this}
   * @memberof Normalized
   */
  public clear(): this {
    return Normalized.clear(this)
  }

  /**
   * Create a new class instance from the provided params
   *
   * @static
   * @template T
   * @template K
   * @param {(...T[] | [id: K, value: any][])} items
   * @returns {NormalizedModel<T>}
   * @memberof Normalized
   */
  public static from<T extends { id: ID }, K extends ID>(...items: T[] | [id: K, value: any][]): NormalizedModel<T> {
    const _items = [...items].map(i => _isObj(i) ? [i['id'], i] : [...i])
    const parsed = _items.reduce<NormalizedData<T, K>>((acc, [id, v]) => ({
      allIds: (acc?.allIds ?? []).concat(id),
      byId: {...acc?.byId, [id]: v},
    }), {allIds: [], byId: {}})
    return new this(parsed)
  }

  /**
   * Removes an item from an existing key value data structure object
   *
   * @static
   * @template T
   * @param {ID} id
   * @param {NormalizedData<T>} model
   * @returns {NormalizedData<T>}
   * @memberof Normalized
   */
  public static remove<T extends NormalizedData<any, K>, K extends ID>(id: K, model: T): T {
    model.allIds = arrayRemoveItem(id, model.allIds)
    model.byId = deleteProperty(model.byId, id)
    return model
  }

  /**
   * Sets an item in an existing normalized key value object.
   *
   * @static
   * @template T
   * @template V
   * @template K
   * @param {[id: K, value: V]} item
   * @param {T} model
   * @param {number} [index]
   * @returns {T}
   * @memberof Normalized
   */
  public static set<T extends NormalizedData<V, K>, V, K extends ID>(
    item: [id: K, value: V],
    model: T,
    index?: number,
  ): T {
    const [id, value] = item
    const currentIndex = model.allIds.indexOf(id)
    const isUpdate = currentIndex !== -1

    model.byId[id] = value

    if (!isUpdate) {
      model.allIds.push(id)
    } else if (_isNum(index) && currentIndex !== index) {
      model.allIds = arrayReorder(model.allIds, currentIndex, index)
    }

    return model
  }

  /**
   * Get a property from the key value. shortens call such as model.byId[foo]
   *
   * @static
   * @template T
   * @param {ID} id
   * @param {NormalizedData<T>} model
   * @returns {(undefined | T)}
   * @memberof Normalized
   */
  public static get<T extends NormalizedData<V, K>, K extends ID, V>(id: K, model: T): V | null {
    return model.byId[id] ?? null
  }

  /**
   * The properties to keep when object is passed to JSON.stringify(...)
   * @returns {NormalizedData<T, K>}
   * @memberof Normalized
   */
  public toJSON(): NormalizedData<T, K> {
    return {allIds: this.allIds, byId: this.byId}
  }

  /**
   * Converts the current values into an array ordered by the
   * appearance of the key in allIds array
   * @returns {Array<T>}
   * @memberof Normalized
   */
  public toArray(): Array<T> {
    return Normalized.toArray(this)
  }

  /**
   * Aliases the static method to shortcut delete operations on this instance
   *
   * @param {K} id
   * @returns {this}
   * @memberof Normalized
   */
  public remove(id: K): this {
    return Normalized.remove(id, this)
  }

  /**
   * Returns whether or not the model byId has property key/id
   *
   * @param {ID} id
   * @returns {boolean}
   * @memberof Normalized
   */
  public has(id: ID): boolean {
    return Object.prototype.hasOwnProperty.call(this.byId, id)
  }

  /**
   * Aliases the static method to shortcut set operations on this instance
   *
   * @param {ID} id
   * @param {*} [value]
   * @param {number} [index]
   * @returns {this}
   * @memberof Normalized
   */
  public set(id: ID, value?: T, index?: number): this {
    return Normalized.set([id, value], this, index)
  }

  /**
   * Shortcuts getting the value of properties of the current instance
   *
   * @param {ID} id
   * @returns {(undefined | T)}
   * @memberof Normalized
   */
  public get(id: ID): undefined | T {
    return Normalized.get(id, this)
  }
}
