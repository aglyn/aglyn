import { toJSON } from './json'

/**
 * Local properties and methods required for CRUD logic
 * (create, read, update delete)
 *
 * @export
 * @interface CrudModel
 * @extends {toJSON<T>}
 * @template T
 * @template V
 */

export interface CrudModel<T = any, V = any> extends toJSON<T> {

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
