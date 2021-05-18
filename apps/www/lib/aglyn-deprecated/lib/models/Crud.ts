import { CrudModel } from '../interfaces/crud'

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
  toJSON(): T { return this.model }

  /** @inheritdoc */
  set<K extends keyof T>(id: K, value: any): this { this.model[id] = value; return this }

  /** @inheritdoc */
  get<K extends keyof T>(id: K): T[K] | null { return this.model[id] }

  /** @inheritdoc */
  has<K extends keyof T>(id: K): boolean { return Object.prototype.hasOwnProperty.call(this.model, id) }

  /** @inheritdoc */
  del<K extends keyof T>(id: K): this { delete this.model[id]; return this }

}