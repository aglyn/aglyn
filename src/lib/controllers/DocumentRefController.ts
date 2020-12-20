import { Ref } from '../interfaces/dod'
import { NormalizedData } from '../interfaces/normalized'
import { DocumentRef, FieldRef } from '../interfaces/ref-controller'
import { Normalized } from '../models/Normalized'
import { ID } from '../types'

import { BaseRefController } from './BaseRefController'
import { FieldRefController } from './FieldRefController'




/**
 * Provides base logic for all documents in the DB
 *
 * @export
 * @class DocumentRefController
 * @extends {BaseRefController<DocumentRef<FT, ST>>}
 * @implements {DocumentRef<FT, ST>}
 * @template FT
 * @template ST
 */
export class DocumentRefController<FT extends FieldRef = FieldRef> extends BaseRefController<Ref.Document<FT>> implements DocumentRef<FT> {

  public fieldModel: new (...args: any[]) => FT = FieldRefController as any

  public get fields(): NormalizedData<FT> { return this.get('fields') }

  constructor(id: ID, fields?: NormalizedData<FT>) {
    super({
      id,
      fields: new Normalized(fields),
    })
  }

  public static from<T extends Ref.Document>(model: T) {
    return new this(model?.id, <any>model?.fields)
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
    console.debug('initFields', this.id, this.fields)
    // Ensure if items are an object we ensure they are a document instance
    if (!(this.fields instanceof Normalized)) {
      this.setFields(new Normalized(this.fields))
    }
    if (this.fields instanceof Normalized) {
      this.fields.toArray().forEach(field => {
        if (!(field instanceof FieldRefController)) {
          this.setField(
            field.id, this.createField(field).init()
          )
        }
      })
    }
  }

  public createField(model?): FT {
    const { id, kind, value } = model
    return new this.fieldModel(id, kind, value)
  }

  public setField(id: ID, value: FT, index?: number): this {
    Normalized.set([id, value], this.fields, index)
    return this
  }

  public getField(id: ID): FT | null {
    return Normalized.get(id, this.fields)
  }

  public removeField(id: ID): this {
    Normalized.remove(id, this.fields)
    return this
  }

  public getAllFields(): FT[] {
    return Normalized.toArray(this.fields)
  }

  public setFields(fields: NormalizedData<FT>): this {
    this.set('fields', fields instanceof Normalized
      ? fields : new Normalized(fields)
    )
    return this
  }

}