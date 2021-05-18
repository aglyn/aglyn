import { FT } from './interfaces/dod'

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
export enum Persist {
  NONE = 'none',
  SESSION = 'session',
  LOCAL = 'local',
}