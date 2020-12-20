import { DK } from './constants'

/** The index signature of any object */
export type ID = string

/** Allows conditional typing type alias */
export type Conditional<T, U, X, Y> = T extends U ? X : Y

/** Plain old object of key(K)-value(T) pairs */
export type Dictionary<T = any> = Record<ID, T> // AKA { [P in Key]: T }

/** The index signature type within the dictionary */
export type SignatureTypeOf<T extends Dictionary> = keyof T

/** The index type within the dictionary */
export type IndexOf<T extends Dictionary, K extends keyof T = any> = T[K]

/** The Type literal equivalent for named constants in FieldKind */
/** A document-oriented database *document value type* i.e. {[P in Key]: <Field>value} */
export type FieldType<Kind extends DK = any> =
  Kind extends DK.ARRAY ? any[]
  : Kind extends DK.BOOLEAN ? boolean
  : Kind extends DK.BLOB ? Uint8Array | string /* Base64 string */
  : Kind extends DK.DATETIME ? number | Date
  : Kind extends DK.FLOAT ? number
  // : Kind extends DK.GEOPOINT ? GeoPoint
  : Kind extends DK.INTEGER ? number
  : Kind extends DK.DICTIONARY ? Dictionary
  : Kind extends DK.NULL ? null
  : Kind extends DK.RELATION ? Dictionary
  : Kind extends DK.TEXT ? string
  : never
