/**
 * @license
 * Copyright 2023 Aglyn LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

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
 * @module dod
 */

/** Primary key */
export type PKey = string
/** Foreign key */
export type FKey = string
/** Alternate key */
export type AKey = string

/** Tuple with exactly two nodes */
export interface TupleLn2<T1, T2 = T1> extends Array<T1 | T2> {
  0: T1
  1: T2
  length: 2 // using the numeric literal type '2'
}

/** Tuple with a minimum of one nodes */
interface TupleMinLn1<T> extends Array<T> {
  0: T
}

/** Tuple with a minimum of two nodes */
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

  export type Any<T = any> =
    | Sorted<T>
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
    export const bool = 'bool'
    export const bytes = 'bytes'
    export const timestamp = 'timestamp'
    export const float = 'float'
    export const int32 = 'int32'
    export const int64 = 'int64'
    export const nil = 'nil'
    export const text = 'text'
    export const coordinates = 'coordinates'
    export const map = 'map'
    export const sorted = 'sorted'

    export const all = [
      Tag.bool,
      Tag.bytes,
      Tag.timestamp,
      Tag.float,
      Tag.int32,
      Tag.int64,
      Tag.nil,
      Tag.text,
      Tag.coordinates,
      Tag.map,
      Tag.sorted,
    ]

    export type T =
      | typeof Tag.bool
      | typeof Tag.bytes
      | typeof Tag.timestamp
      | typeof Tag.float
      | typeof Tag.int32
      | typeof Tag.int64
      | typeof Tag.nil
      | typeof Tag.text
      | typeof Tag.coordinates
      | typeof Tag.map
      | typeof Tag.sorted
  }

  /** Match Type from Tag symbol */
  export type TypeFromTag<Kind extends Tag.T> = Kind extends typeof Tag.bool
    ? Bool
    : Kind extends typeof Tag.bytes
      ? Uint8Array
      : Kind extends typeof Tag.timestamp
        ? Timestamp
        : Kind extends typeof Tag.float
          ? Float
          : Kind extends typeof Tag.int32
            ? Int32
            : Kind extends typeof Tag.int64
              ? Int64
              : Kind extends typeof Tag.nil
                ? Null
                : Kind extends typeof Tag.text
                  ? Text
                  : Kind extends typeof Tag.coordinates
                    ? Coordinates
                    : Kind extends typeof Tag.map
                      ? Map
                      : Kind extends typeof Tag.sorted
                        ? Sorted<any>
                        : never
}

/** Field */
export type FieldValueType<T = any> = FT.Any<T>
/** Document */
export type DocumentType<F extends FieldValueType = any> = {
  [fieldId: string]: F
}
/** Collection */
export type CollectionType = {[documentId: string]: DocumentType}
/** Database */
export type DatabaseType = {[collectionId: string]: CollectionType}
/** Cluster */
export type ClusterType = {[databaseId: string]: DatabaseType}

/**
 * Outlines schemas for entity types (e.g., field, doc, collection)
 */
export namespace Schema {
  /**
   * Name fields
   */
  export type Name = {
    singular?: FT.Text
    plural?: FT.Text
  }

  /**
   * Interface properties for a timestamp lifecycle
   *
   * @export
   * @interface StampedLifecycle
   */
  export type StampedLifecycle = Partial<Record<StampedKeys, FT.Timestamp>>
  export type StampedKeys = 'created' | 'updated' | 'delete'

  /** Just a boxed name field */
  export interface NamedField {
    name: Name
  }

  /**
   * Describes the meta object for a field instance
   */
  export interface FieldDefinition extends NamedField {
    type: FT.Tag.T
    description?: FT.Text
  }

  /**
   * Outlines the fields to be designated for a new
   * document instance within the parent collection
   */
  export type ModelFields = {
    [fieldId: string]: FieldDefinition
  }

  /**
   * Describes a collection of documents, the fields
   * property describes the fields of any document an
   * instance of the collection.
   */
  export interface CollectionModel
    extends DocumentType,
      StampedLifecycle,
      NamedField {
    fields: ModelFields
  }

  /**
   * Describes a collection of documents, each document
   * only describes another collection e.g. the meta
   */
  export type CollectionModels = CollectionType & {
    [collectionIdAsDocumentId: string]: CollectionModel
  }

  /**
   * =======================================================
   */

  /**
   * The actual collection instance of a collection meta
   */
  export type CollectionInstance<T extends CollectionModel> = CollectionType & {
    [documentId: string]: DocumentType<
      FT.TypeFromTag<T['fields'][string]['type']>
    >
  }

  /**
   * Just simply a database of collections
   */
  export type DatabaseCollections<C extends CollectionModels> = DatabaseType & {
    [CID in keyof C]: CollectionInstance<C[CID]>
  }
}

export namespace Ref {
  export interface Base<S = any> {
    id: PKey
    schema: S
  }

  /**
   * =======================================================
   */
  export type Field<S extends Schema.FieldDefinition> = FT.TypeFromTag<
    S['type']
  >

  /**
   * =======================================================
   */
  export type DocumentFields<S extends Schema.ModelFields> = {
    [K in keyof S]: Field<S[K]>
  }
  export type Document<S extends Schema.ModelFields> = DocumentFields<S>

  /**
   * =======================================================
   */
  export type CollectionDocuments<S extends Schema.CollectionModel> = {
    [documentId: string]: Document<S['fields']>
  }
  export type Collection<S extends Schema.CollectionModel> =
    CollectionDocuments<S>

  /**
   * =======================================================
   */
    // export type DatabaseCollections<S extends Schema.CollectionModels> = {
    //   [K in keyof S]: Collection<S[K]>
    // }
  export interface Database {
    schemas: Schema.CollectionModels
    instances: Schema.DatabaseCollections<this['schemas']>
  }
}

/**
 * Evaluation kinds
 */
export enum Eval {
  Required = 'r6d',
  Regex = 'r3x',
}

/**
 * Property name index signatures
 */
export const Sig = {
  Field: 'field',
  Fields: 'fields',
  Document: 'document',
  Documents: 'documents',
  Collection: 'collection',
  Collections: 'collections',
  Subcollection: 'subcollection',
  Subcollections: 'subcollections',

  Model: 'model',
  Models: 'models',
  Blueprint: 'blueprint',
  Blueprints: 'blueprints',
  Entry: 'entry',
  Entries: 'entries',

  Id: 'id',
  Name: 'name',
  Kind: 'kind',
  Type: 'type',
  Value: 'value',

  Created: 'created',
  Updated: 'updated',
  Deleted: 'deleted',
}

/**
 * Friendly-text/display-names of local names or
 *
 * TODO: i18n
 */
export const lbl = {
  /** Field Data Types */
  [FT.Tag.bool]: 'True/False',
  [FT.Tag.bytes]: 'Bytes',
  [FT.Tag.timestamp]: 'Date/Time',
  [FT.Tag.float]: 'Decimal',
  [FT.Tag.int32]: 'Number',
  [FT.Tag.int64]: 'Large Number',
  [FT.Tag.nil]: 'Null',
  [FT.Tag.text]: 'Text',
  [FT.Tag.coordinates]: 'Coordinates (lat/lon)',
  [FT.Tag.map]: 'Map',
  [FT.Tag.sorted]: 'Sorted',

  /** Entity type fields */
  [Sig.Field]: 'Field',
  [Sig.Fields]: 'Fields',
  [Sig.Document]: 'Document',
  [Sig.Documents]: 'Documents',
  [Sig.Collection]: 'Collection',
  [Sig.Collections]: 'Collections',
  [Sig.Subcollection]: 'Subcollection',
  [Sig.Subcollections]: 'Subcollections',

  /** Instance fields */
  [Sig.Blueprint]: 'Blueprint',
  [Sig.Blueprints]: 'Blueprints',
  [Sig.Model]: 'Model',
  [Sig.Models]: 'Models',
  [Sig.Entry]: 'Entry',
  [Sig.Entries]: 'Entries',

  /** Meta fields */
  [Sig.Id]: 'Unique ID',
  [Sig.Name]: 'Display Name',
  [Sig.Kind]: 'Kind',
  [Sig.Type]: 'Type',
  [Sig.Value]: 'Value',

  /** Timestamp fields */
  [Sig.Created]: 'Created At',
  [Sig.Updated]: 'Updated At',
  [Sig.Deleted]: 'Deleted At',
}

/** Contextual persistence types */
export enum Persistance {
  NONE = 'NONE',
  SESSION = 'SESSION',
  LOCAL = 'LOCAL',
}
