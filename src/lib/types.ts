/** Allows conditional typing type alias */
export type Conditional<T, U, X, Y> = T extends U ? X : Y

/** Plain old object of key(K)-value(T) pairs */
export type Dictionary<T = any> = Record<string, T> // AKA { [P in Key]: T }

/** The index signature type within the dictionary */
export type SignatureTypeOf<T extends Dictionary> = keyof T

/** The index type within the dictionary */
export type IndexOf<T extends Dictionary, K extends keyof T = keyof T> = T[K]

/** Persistence types */
export enum Persist {
  NONE = 'none',
  SESSION = 'session',
  LOCAL = 'local',
}