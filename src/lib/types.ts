// FIRESTORE COLLECTIONS
// e.g.
// <COLLECTION 1>
//      <DOCUMENT 1>
//      <DOCUMENT 2>
//            <FIELD 1>
//            <FIELD 2>
//
//            <SUB-COLLECTIONS>
//                  <SUB-COLLECTION 1>
//
// components
//      <id>
//            id
//            name
//            description
//            variables: [<variableId>,...] (e.g. Stateful/Context)
//
//            <SUB-COLLECTIONS>
//
//
// variables
//      <id>
//            id
//            name
//
//            <SUB-COLLECTIONS>
//


export type DbDocument = {
  id: string
  [metaKey: string]: any
}

export type KeyValue<T = string> = {
  keys: Array<keyof KeyValue['byKey']>
  byKey: {
    [key: string]: T
  }
}

export type Metadata = KeyValue<string>

export enum AuthResult {
  Allow = 0,
  Deny = 1
}

export interface Component extends DbDocument {
  variables?: KeyValue<Variable>
}

export interface Variable extends DbDocument {
  type: VariableType
  value?: any
}

export enum VariableType {
  string = 'string',
  number = 'number',
  boolean = 'boolean',
  object = 'object',

  arrayString = 'arrayString',
  arrayNumber = 'arrayNumber',
  arrayBoolean = 'arrayBoolean',
  arrayObject = 'arrayObject',
  arrayArray = 'arrayArray',
}

/**
 * IF {Array<CoreComponent['id']>} - Array of component IDs to deny or allow
 * IF {false} - None allowed or deny all
 */
export type ConstrainComponentIds = false | Array<Component['id']>
export type RelationConstraint = [type: AuthResult, uuids: ConstrainComponentIds]
