import { PKey, Ref, Schema } from '../interfaces/dod'

import { BaseRefController } from './BaseRefController'


export class CollectionRefController<S extends Schema.CollectionModel> extends BaseRefController<S, Ref.Collection<S>> {

  constructor(id: PKey, schema: S, documents?: Ref.Collection<S>) {
    super({ id, schema }, { ...documents })
  }

  public static from<S extends Schema.CollectionModel>(id: PKey, schema: S, documents?: Ref.Collection<S>) {
    return new this(id, schema, documents)
  }

  /**
   * Initialize the instance, should be called immediately after
   * creating the object
   *
   * @public
   * @memberof CollectionRefController
   */
  public init(): this {
    this.preInit && this.preInit()
    this.initDocuments()
    this.onInit && this.onInit()
    return this
  }

  protected initDocuments() {
    console.debug('initDocuments', this.getId(), this.getSchema(), this.getDocuments())
    // Ensure if items are an object we ensure they are a document instance
    // if (!(this.documents instanceof Normalized)) {
    //   this.setDocuments(new Normalized(this.documents))
    // }
    // if (this.documents instanceof Normalized) {
    //   this.documents.toArray().forEach(doc => {
    //     if (!(doc instanceof DocumentRefController)) {
    //       this.setDocument(
    //         doc.id, this.createDocument(doc).init()
    //       )
    //     }
    //   })
    // }
  }

  public getDocuments(): Ref.CollectionDocuments<S> {
    return this.model
  }

  public setDocuments(value: Ref.CollectionDocuments<S>): this {
    this.model = value
    return this
  }

}