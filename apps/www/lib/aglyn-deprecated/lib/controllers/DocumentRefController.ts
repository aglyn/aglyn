import { PKey, Ref, Schema } from '../interfaces/dod'

import { BaseRefController } from './BaseRefController'


/**
 *
 *
 * @export
 * @class DocumentRefController
 * @extends {BaseRefController<Ref.Document<S>>}
 * @template S
 */
export class DocumentRefController<S extends Schema.ModelFields> extends BaseRefController<S, Ref.Document<S>> {

  constructor(id: PKey, schema: S, fields?: Ref.Document<S>) {
    super({ id, schema }, { ...fields })
  }

  public static from<S extends Schema.ModelFields>(id: PKey, schema: S, fields?: Ref.Document<S>) {
    return new this(id, schema, fields)
  }

  /**
   * Initialize the instance, should be called immediately after
   * creating the object
   *
   * @public
   * @memberof DocumentRefController
   */
  public init(): this {
    this.preInit && this.preInit()
    this.initFields()
    this.onInit && this.onInit()
    return this
  }

  protected initFields() {
    console.debug('initFields', this.getId(), this.getSchema(), this.getFields())
    // Ensure if items are an object we ensure they are a document instance
    // if (!(this.fields instanceof Normalized)) {
    //   this.setFields(new Normalized(this.fields))
    // }
    // if (this.fields instanceof Normalized) {
    //   this.fields.toArray().forEach(field => {
    //     if (!(field instanceof FieldRefController)) {
    //       this.setField(
    //         field.id, this.createField(field).init()
    //       )
    //     }
    //   })
    // }
  }

  public getFields(): Ref.DocumentFields<S> {
    return this.model
  }

  public setFields(value: Ref.DocumentFields<S>): this {
    this.model = value
    return this
  }

}