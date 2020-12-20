import { Ref } from '../interfaces/dod'
import { NormalizedData } from '../interfaces/normalized'
import { CollectionRef, DocumentRef } from '../interfaces/ref-controller'
import { Normalized } from '../models/Normalized'
import { ID } from '../types'

import { BaseRefController } from './BaseRefController'
import { DocumentRefController } from './DocumentRefController'

/**
 * Provides logic for modeling collections of documents
 *
 * @export
 * @class CollectionRefController
 * @implements {CollectionRef<D>}
 * @template D
 */
export class CollectionRefController<D extends DocumentRef = DocumentRef> extends BaseRefController<Ref.Collection<D>> implements CollectionRef<D> {

  public documentModel: new (...args: any[]) => D = DocumentRefController as any
  public get documents(): NormalizedData<D> { return this.get('documents') }
  public get length(): number { return this.documents?.allIds?.length ?? 0 }

  constructor(id: ID, documents?: NormalizedData<D>) {
    super({
      id: id, documents: new Normalized(documents)
    })
  }

  public static from<T extends Ref.Collection>(model: T) {
    console.log('collection from', model)
    return new this(model?.id, <any>model?.documents)
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
    console.debug('initDocuments', this.id, this.documents)
    // Ensure if items are an object we ensure they are a document instance
    if (!(this.documents instanceof Normalized)) {
      this.setDocuments(new Normalized(this.documents))
    }
    if (this.documents instanceof Normalized) {
      this.documents.toArray().forEach(doc => {
        if (!(doc instanceof DocumentRefController)) {
          this.setDocument(
            doc.id, this.createDocument(doc).init()
          )
        }
      })
    }
  }

  public createDocument(model?): D {
    const { id, fields, subcollections } = model
    return new this.documentModel(id, fields, subcollections)
  }

  public setDocument(id: ID, value: D, index?: number): this {
    Normalized.set([id, value], this.documents, index)
    return this
  }

  public getDocument(id: ID): D | null {
    return Normalized.get(id, this.documents)
  }

  public removeDocument(id: ID): this {
    Normalized.remove(id, this.documents)
    return this
  }

  public getAllDocuments(): D[] {
    return Normalized.toArray(this.documents)
  }

  public setDocuments(documents: NormalizedData<D>): this {
    this.set('documents', documents instanceof Normalized
      ? documents : new Normalized(documents)
    )
    return this
  }


}