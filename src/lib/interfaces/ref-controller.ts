import { ID } from '../types'

import { CrudModel } from "./crud"
import { Box, FieldValueType, Ref } from './dod'
import { Initializable } from './initializable'
import { NormalizedData } from './normalized'

/**
 * Describes the base model object
 *
 * @export
 * @interface BaseModel
 * @extends {Initializable}
 * @extends {Crud<T>}
 * @extends {toJSON<T>}
 * @template T
 */
export interface BaseRef<T extends Box.Id = Box.Id> extends Initializable, CrudModel<T> {
  id: ID
}

/**
 * Instance outline base for all documents in the DB
 *
 * @export
 * @interface FieldRef
 * @extends {FieldRef<T>}
 * @extends {BaseRef<FieldRef<T>>}
 * @template T
 */
export interface FieldRef<T extends FieldValueType = FieldValueType> extends Ref.Field<T>, BaseRef<Ref.Field<T>> {

  readonly value: T | null
  readonly kind: string | number

  getValue(): T | null
  setValue(value: T): this

  getKind(): string | number
  setKind(value: string | number): this

}

/**
 * Instance outline base for all documents in the DB
 *
 * @export
 * @interface DocumentRef
 * @extends {DocumentRef<FT, ST>}
 * @extends {BaseRef<DocumentRef<FT, ST>>}
 * @template FT
 * @template ST
 */
export interface DocumentRef<FT extends FieldRef = FieldRef> extends Ref.Document<FT>, BaseRef<Ref.Document<FT>> {

  fieldModel: new (...args: any[]) => FT

  readonly fields: NormalizedData<FT>

  createField(...args: any[]): FT

  setField(id: ID, value: FT, index?: number): this

  getField(id: ID): FT | null

  removeField(id: ID): this

  getAllFields(): FT[]

  setFields(fields: NormalizedData<FT>): this

}


/**
 * Instance outline for modeling a collection of documents
 *
 * @export
 * @interface CollectionRef
 * @extends {DocumentRef<F>}
 * @extends {IterableIterator<D>}
 * @template D
 * @template F
 */
export interface CollectionRef<D extends DocumentRef = any> extends Ref.Collection<D>, BaseRef<Ref.Collection<D>> {

  documentModel: new (...args: any[]) => D
  readonly documents: NormalizedData<D>
  readonly length: number

  createDocument(...args: any[]): D
  setDocument(id: ID, value: D, index?: number): this
  getDocument(id: ID): D | null
  removeDocument(id: ID): this
  getAllDocuments(): D[]
  setDocuments(documents: NormalizedData<D>): this

}