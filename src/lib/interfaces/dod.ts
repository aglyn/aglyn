import { Timestamp } from './dod'
/**
 * (D)Document-(o)oriented (D)Database (DoD)
 *
 * A document-oriented database, or DoD, or document
 * store, is a data storage structure designed for
 * storing, retrieving and managing document-oriented
 * information, also known as semi-structured data.
 *
 * Each document contains a set of key-value pairs.
 * All documents must be stored in collections.
 *
 * Documents can contain literal fields such as
 * text/strings, numbers, or booleans, and secondly
 * nestable fields such as arrays or mapped objects.
 *
 * The special sauce here which deviates from a
 * traditional DoD is the overlaid design patterns
 * which provide the outlines for capabilities such
 * as relational- and model-driven
 *
 * @module DoD
 */

import { Dictionary } from '../types'

import { Name } from './name'
import { NormalizedData } from './normalized'

/** Primary key */
export type PKey = string
/** Foreign key */
export type FKey = string
/** Alternate key */
export type AKey = string

/** Tuple with exactly two elements */
export interface TupleLn2<T1, T2 = T1> extends Array<T1 | T2> {
  0: T1
  1: T2
  length: 2 // using the numeric literal type '2'
}

/** Tuple with a minimum of one elements */
interface TupleMinLn1<T> extends Array<T> {
  0: T
}

/** Tuple with a minimum of two elements */
interface TupleMinLn2<T1, T2 = T1> extends TupleMinLn1<T1 | T2> {
  0: T1
  1: T2
}

/**
 * Nominal Type hack to declare a typeof type for
 * a unique symbol. This is because `unique symbol`
 * can only be typed from a const.
 *
 * @see https://www.typescriptlang.org/docs/handbook/release-notes/typescript-2-7.html#unique-symbol
 */
declare const NominalSymbol: unique symbol
export type UniqSym = typeof NominalSymbol

/**
 * Describes relationship design patterns to
 * outline a RDBMS equivalent
 */
export namespace Relation {

  /**
   * A associative lookup for unnatural/extrinsic
   * Many-to-Many relationship.
   *
   * Note: intrinsic 2-way relations should live within
   * both documents and not use an extra query/join for
   * the lookup! However, a rare scenario that it is too
   * large, you may store the most recent (n) items in
   * the two documents and use the lookup for the rest.
   *
   * Consider the following 2-way relationship:
   * group1 = [user1, user3]
   * group2 = [user1, user2]
   * group3 = [user2, user3]
   * user1 = [group1, group2]
   * user2 = [group2, group3]
   * user3 = [group1, group3]
   *
   * That would be displayed in an associative as follows:
   * AK1 = [group1, user1]
   * AK2 = [group1, user3]
   * AK3 = [group2, user1]
   * AK4 = [group2, user2]
   * AK5 = [group3, user2]
   * AK6 = [group3, user3]
   */
  export type Associative = TupleLn2<FKey>

  /**
   * Similar to an associative relation but rather to
   * find many associations
   *
   * e.g. Invoice, Product, User lookups
   * AK1 = [invoiceId, productId, userId]
   */
  export type Lookup = TupleMinLn2<FKey>

}

export type Lookup = {

}

/** Field Type */
export namespace FT {

  export type Bool = boolean
  export type Bytes = Uint8Array | string
  export type Timestamp = number
  export type Float = number
  export type Int32 = number
  export type Int64 = number
  export type Null = null
  export type Text = string
  export type Coordinates = Record<'longitude' | 'latitude', number>
  export type Map = Dictionary
  export type Sorted<T = any> = T extends any[] ? never : T[]

  export type Nestable = Map | Sorted<any>

  export type Any<T = any> = Sorted<T>
    | Bool
    | Bytes
    | Timestamp
    | Float
    | Coordinates
    | Int32
    | Int64
    | Map
    | Null
    | Text

  export namespace Tag {
    export const bool = Symbol('bool')
    export const bytes = Symbol('bytes')
    export const timestamp = Symbol('timestamp')
    export const float = Symbol('float')
    export const int32 = Symbol('int32')
    export const int64 = Symbol('int64')
    export const nil = Symbol('nil')
    export const text = Symbol('text')
    export const coordinates = Symbol('coordinates')
    export const map = Symbol('map')
    export const sorted = Symbol('sorted')
  }

  /** Match Type from Tag symbol */
  export type TypeFromTag<Kind extends symbol> =
    Kind extends typeof Tag.sorted ? Sorted<any>
    : Kind extends typeof Tag.bool ? Bool
    : Kind extends typeof Tag.bytes ? Uint8Array
    : Kind extends typeof Tag.timestamp ? Timestamp
    : Kind extends typeof Tag.float ? Float
    : Kind extends typeof Tag.coordinates ? Coordinates
    : Kind extends typeof Tag.int32 ? Int32
    : Kind extends typeof Tag.int64 ? Int64
    : Kind extends typeof Tag.map ? Map
    : Kind extends typeof Tag.nil ? Null
    : Kind extends typeof Tag.text ? Text
    : never
}

/** Field */
export type FieldValueType<T = any> = FT.Any<T>
/** Document */
export type DocumentType = { [fieldId: string]: FieldValueType }
/** Collection */
export type CollectionType = { [documentId: string]: DocumentType }
/** Database */
export type DatabaseType = { [collectionId: string]: CollectionType }
/** Cluster */
export type ClusterType = { [databaseId: string]: DatabaseType }

/**
 * Outlines schemas for entity types (e.g., field, doc, collection)
 */
export namespace Schema {

  /**
   * Interface properties for a timestamp lifecycle
   *
   * @export
   * @interface StampedLifecycle
   */
  export interface StampedLifecycle {
    created?: Timestamp
    updated?: Timestamp
    deleted?: Timestamp
  }

  export interface Named {
    name: Name
  }

  export interface FieldMeta extends Named {
    $type: symbol
  }

  export interface ModelFields {
    [fieldId: string]: FieldMeta
  }

  export interface Collection extends DocumentType, StampedLifecycle, Named {
    fields: ModelFields
  }

}

/** Boxed properties */
export namespace Box {

  export type Id = {
    id: PKey
  }

  export type Kind = {
    kind: string | number
  }

  export type Value<T = FieldValueType> = {
    value?: T
  }

  export type Fields<F = DocumentType, T = NormalizedData<F>> = {
    fields: T
  }

  export type Documents<D = CollectionType, T = NormalizedData<D>> = {
    documents: T
  }

  export type Collections<C = DatabaseType, T = NormalizedData<C>> = {
    collections?: T
  }

}

export namespace Ref {

  export type Field<T = FieldValueType> =
    Box.Id & Box.Kind & Box.Value<T>

  export type Document<F = Field> =
    Box.Id & Box.Fields<F>

  export type Collection<D = Document> =
    Box.Id & Box.Documents<D>

}