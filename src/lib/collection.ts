import { Document, DocumentModel } from './document'
import { _isObj } from './guards'
import { ID } from './types'

/**
 * Instance outline for modeling a collection of documents
 *
 * @export
 * @interface CollectionModel
 * @extends {DocumentModel<F>}
 * @extends {IterableIterator<T>}
 * @template T
 * @template F
 */
export interface CollectionModel<T extends DocumentModel = DocumentModel, F = any> extends DocumentModel<F>, IterableIterator<T> {
  model: new (...args: any[]) => T
  documents: T[]

  getAllDocuments(): T[]

  getDocumentById(id: ID): T | undefined
  getDocumentById(...ids: ID[]): T[]
  getDocumentById(id: ID, ...ids: ID[]): T | T[] | undefined

  addDocument(item: T): this
  createDocument(...args: any[]): T

  removeDocument(id: ID): this
  removeDocument(item: T): this
  removeDocument(item: ID | T): this

  length: number
  [Symbol.iterator](): IterableIterator<T>
  next(): IteratorResult<T>
}

/**
 * Provides logic for modeling collections of documents
 *
 * @export
 * @class Collection
 * @extends {Document<F>}
 * @implements {CollectionModel<T, F>}
 * @template T
 * @template F
 */
export class Collection<T extends DocumentModel = Document, F = any> extends Document<F> implements CollectionModel<T, F> {

  public model: new (...args: any[]) => T = Document as any

  public get documents(): T[] { return this.data['documents'] }
  public set documents(v: T[]) { this.data['documents'] = v }

  public get length(): number { return (this.documents ?? []).length }

  init(): this {
    this.preInit && this.preInit()
    this.initDocuments()
    this.onInit && this.onInit()
    return this
  }

  protected initDocuments() {
    console.log('initDocs', this.get('id'), this.documents)
    // Ensure if items are an object we ensure they are a document instance
    this.documents = (this.documents ??= []).map(item => {
      if (_isObj(item) && !(item instanceof this.model)) {
        return this.createDocument(item).init()
      }
      return item
    })
  }

  getAllDocuments(): T[] {
    return this.documents
  }
  getDocumentById(id: ID): T | undefined
  getDocumentById(...ids: ID[]): T[]
  getDocumentById(id: ID, ...ids: ID[]): T | T[] | undefined {
    if (ids.length) {
      const _ids = Array.from([id, ...ids])
      return this.documents?.filter(d => _ids.some(i => i === d?.get('id')))
    }
    return this.documents?.find(i => i?.get('id') === id)
  }

  addDocument(item: T): this {
    (this.documents ??= []).push(item)
    return this
  }

  createDocument(...args: any[]): T {
    return new this.model(...args)
  }

  removeDocument(id: ID): this
  removeDocument(item: T): this
  removeDocument(item: ID | T): this {
    const _item = _isObj(item) ? item : this.getDocumentById(item)
    const items = Array.from(this.documents)
    this.documents = items.filter(i => i != _item)
    return this
  }

  removeDocumentById(id: ID): this {
    this.removeDocument(id)
    return this
  }


  private __index__ = 0;
  /** @inheritdoc */
  [Symbol.iterator](): IterableIterator<T> { return this }
  /** @inheritdoc */
  next(): IteratorResult<T> {
    if (this.__index__ < this.length) {
      return {
        done: false,
        value: this.documents[this.__index__++]
      }
    } else {
      return {
        done: true,
        value: null
      }
    }
  }
}