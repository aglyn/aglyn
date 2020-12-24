import { PKey, Ref, Schema } from '../interfaces/dod'

import { BaseRefController } from './BaseRefController'

/**
 *
 *
 * @export
 * @class FieldRefController
 * @extends {BaseRefController<Ref.Field<S>>}
 * @template S
 */
export class FieldRefController<S extends Schema.FieldDefinition> extends BaseRefController<S, { value: Ref.Field<S> }> {

  constructor(id: PKey, schema: S, value?: Ref.Field<S>) {
    super({ id, schema }, { value: value })
  }

  public static from<S extends Schema.FieldDefinition>(id: PKey, schema: S, value: Ref.Field<S>) {
    return new this(id, schema, value)
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
    console.debug('initValue', this.getId(), this.getSchema(), this.getValue())
  }

  public getValue(): Ref.Field<S> {
    return this.get('value')
  }

  public setValue(value: Ref.Field<S>): this {
    return this.set('value', value)
  }

}