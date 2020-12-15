import { CollectionModel } from './collection'
import { CrudModel } from './crud'
import { _isArr, _isObj } from './guards'
import { Dictionary, ID } from './types'


/** A document-oriented db document type */
export type DocumentType<T extends Dictionary = any> = { [P in keyof T]: T[P] }

/**
 * Instance outline base for all documents in the DB
 *
 * @export
 * @interface DocumentModel
 * @extends {CrudModel}
 * @template F
 */
export interface DocumentModel<F = any> extends CrudModel {
  model?: new (...args: any[]) => DocumentModel
  data: Readonly<F>
  subCollections: CollectionModel[]
  subFields: DocumentModel[]

  preInit?(): void
  init(...args: any[]): this
  onInit?(): void

  toJSON(): Dictionary

  createSubField(...args: any[]): DocumentModel

  getAllSubFields(): DocumentModel[]
  getSubFieldById(id: ID): DocumentModel | undefined
  getSubFieldById(...ids: ID[]): DocumentModel[]
  getSubFieldById(id: ID, ...ids: ID[]): DocumentModel | DocumentModel[] | undefined

  addSubField(item: DocumentModel): this

  removeSubField(id: ID): this
  removeSubField(item: DocumentModel): this
  removeSubField(item: ID | DocumentModel): this

  createField(...args: any[]): DocumentModel

  getAllFields(): DocumentModel[]
  getFieldById(id: ID): DocumentModel | undefined
  getFieldById(...ids: ID[]): DocumentModel[]
  getFieldById(id: ID, ...ids: ID[]): DocumentModel | DocumentModel[] | undefined

  addField(item: DocumentModel): this

  removeField(id: ID): this
  removeField(item: DocumentModel): this
  removeField(item: ID | DocumentModel): this

  getAllSubCollections(): DocumentModel[]
  getSubCollectionById(id: ID): CollectionModel | undefined
  getSubCollectionById(...ids: ID[]): CollectionModel[]
  getSubCollectionById(id: ID, ...ids: ID[]): CollectionModel | CollectionModel[] | undefined

  addSubCollection(item: CollectionModel): this

  removeSubCollection(id: ID): this
  removeSubCollection(item: CollectionModel): this
  removeSubCollection(item: ID | CollectionModel): this
}

/**
 * Provides base logic for all documents in the DB
 *
 * @export
 * @class Document
 * @implements {DocumentModel<F>}
 * @template F
 */
export class Document<F = any> implements DocumentModel<F> {

  public model: new (...args: any[]) => DocumentModel = Document as any

  public get subCollections(): CollectionModel[] { return this.data['subCollections'] }
  public set subCollections(v: CollectionModel[]) { this.data['subCollections'] = v }

  public get subFields(): DocumentModel[] { return this.data['subFields'] }
  public set subFields(v: DocumentModel[]) { this.data['subFields'] = v }

  public get fields(): DocumentModel[] { return this.data['fields'] }
  public set fields(v: DocumentModel[]) { this.data['fields'] = v }

  constructor(public data: Readonly<F> | F = {} as any) { }

  /**
   * Hook called before init
   *
   * @protected
   * @memberof Document
   */
  preInit?(): void

  /**
   * Initialize the instance, should be called immediately after
   * creating the object
   *
   * @public
   * @memberof Document
   */
  init(): this {
    this.preInit && this.preInit()
    this.initFields()
    this.initSubFields()
    this.onInit && this.onInit()
    return this
  }

  protected initFields() {
    if (!this.fields) { return }
    // Ensure if items are an object we ensure they are a document instance
    this.fields = (this.fields ??= []).map(item => {
      if (_isObj(item) && !(item instanceof this.model)) {
        return this.createField(item).init()
      }
      return item
    })
  }

  protected initSubFields() {
    if (!this.subFields) { return }
    // Ensure if items are an object we ensure they are a document instance
    this.subFields = (this.subFields ??= []).map(item => {
      if (_isObj(item) && !(item instanceof this.model)) {
        return this.createSubField(item).init()
      }
      return item
    })
  }

  /**
   * Hook called after init
   *
   * @protected
   * @memberof Document
   */
  onInit?(): void

  set(id: ID, v: any): this { this.data[id] = v; return this }
  get(id: ID): any { return this.data[id] }
  del(id: ID): this { delete this.data[id]; return this }
  has(id: ID): boolean { return Object.prototype.hasOwnProperty.call(this.data, id) }

  toJSON(): Dictionary { return { ...this.data } }

  createSubField(...args: any[]): DocumentModel {
    return new this.model(...args)
  }

  getAllSubFields(): DocumentModel[] {
    return this.subFields
  }
  getSubFieldById(id: ID): DocumentModel | undefined
  getSubFieldById(...ids: ID[]): DocumentModel[]
  getSubFieldById(id: ID, ...ids: ID[]): DocumentModel | DocumentModel[] | undefined {
    if (ids.length) {
      const _ids = Array.from([id, ...ids])
      return this.subFields?.filter(d => _ids.some(i => i === d?.get('id')))
    }
    return this.subFields?.find(i => i?.get('id') === id)
  }

  addSubField(item: DocumentModel): this {
    (this.subFields ??= []).push(item)
    return this
  }

  removeSubField(id: ID): this
  removeSubField(item: DocumentModel): this
  removeSubField(item: ID | DocumentModel): this {
    const _item = _isObj(item) ? item : this.getSubFieldById(item)
    const items = Array.from(this.subFields)
    this.subFields = items.filter(i => i != _item)
    return this
  }

  createField(...args: any[]): DocumentModel {
    return new this.model(...args)
  }

  getAllFields(): DocumentModel[] {
    return this.fields
  }
  getFieldById(id: ID): DocumentModel | undefined
  getFieldById(...ids: ID[]): DocumentModel[]
  getFieldById(id: ID, ...ids: ID[]): DocumentModel | DocumentModel[] | undefined {
    if (ids.length) {
      const _ids = Array.from([id, ...ids])
      return this.fields?.filter(d => _ids.some(i => i === d?.get('id')))
    }
    return this.fields?.find(i => i?.get('id') === id)
  }

  addField(item: DocumentModel): this {
    (this.fields ??= []).push(item)
    return this
  }

  removeField(id: ID): this
  removeField(item: DocumentModel): this
  removeField(item: ID | DocumentModel): this {
    const _item = _isObj(item) ? item : this.getFieldById(item)
    const items = Array.from(this.fields)
    this.fields = items.filter(i => i != _item)
    return this
  }

  getAllSubCollections(): CollectionModel[] {
    return this.subCollections
  }
  getSubCollectionById(id: ID): CollectionModel | undefined
  getSubCollectionById(...ids: ID[]): CollectionModel[]
  getSubCollectionById(id: ID, ...ids: ID[]): CollectionModel | CollectionModel[] | undefined {
    if (ids.length) {
      const _ids = Array.from([id, ...ids])
      return this.subCollections?.filter(d => _ids.some(i => i === d?.get('id')))
    }
    return this.subCollections?.find(i => i?.get('id') === id)
  }

  addSubCollection(item: CollectionModel): this {
    (this.subCollections ??= []).push(item)
    return this
  }

  removeSubCollection(id: ID): this
  removeSubCollection(item: CollectionModel): this
  removeSubCollection(item: ID | CollectionModel): this {
    const _item = _isObj(item) ? item : this.getSubCollectionById(item)
    const items = Array.from(this.subCollections)
    this.subCollections = items.filter(i => i != _item)
    return this
  }
}