import { FieldValueType, Ref } from '../interfaces/dod'
import { FieldRef } from '../interfaces/ref-controller'
import { ID } from '../types'

import { BaseRefController } from './BaseRefController'

/**
 * Provides base logic for all documents in the DB
 *
 * @export
 * @class FieldRefController
 * @extends {BaseRefController<FieldRef<T>>}
 * @implements {FieldRef<T>}
 * @template T
 */
export class FieldRefController<T extends FieldValueType = FieldValueType> extends BaseRefController<Ref.Field<T>> implements FieldRef<T> {

  public get value(): T { return this.get('value') }
  public get kind(): string | number { return this.get('kind') }

  constructor(id: ID, kind: string, value?: T) {
    super({ id, kind, value })
  }

  public static from<T extends Ref.Field>(model: T) {
    return new this(model?.id, <any>model?.kind, model?.value)
  }

  /**
   * Initialize the instance, should be called immediately after
   * creating the object
   *
   * @public
   * @memberof FieldRefController
   */
  public init(): this {
    this.preInit && this.preInit()
    this.initValue()
    this.onInit && this.onInit()
    return this
  }

  protected initValue() {
    console.debug('initValue', this.id, this.value)
  }

  public getValue(): T {
    return this.value
  }

  public setValue(value: T): this {
    this.set('value', value)
    return this
  }

  public getKind(): string | number {
    return this.kind
  }

  public setKind(value: string | number): this {
    this.set('kind', value)
    return this
  }

}