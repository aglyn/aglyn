import { defaultAppConfig } from '../app-defaults'

import { Collection, CollectionModel } from './collection'
import { DK } from './config'
import { DocumentModel } from './document'
import { Dictionary, FieldType, ID } from './types'

interface ModelBase extends Dictionary {
  id?: ID
  name?: string
  kind?: DK
}
export interface Field extends ModelBase {
  subFields?: Field[]

  // TODO: evaluation rules
  // eval?: Eval | Eval[] | { [field: string]: Eval | Eval[] }
}
export interface Blueprint extends ModelBase {
  kind: DK.DOCUMENT | DK.COLLECTION
  fields?: Field[]

  // TODO: rules for the fields
  // rules?: any[]
}
export interface BlueprintCollection<Model extends Blueprint = Blueprint> extends ModelBase {
  kind: DK.COLLECTION
  model: Model
  documents: (Model & {
    entries: Record<
      Model['fields'][any]['id'],
      FieldType<Model['fields'][any]['kind']>
    >[]
  })[]

  // TODO: Workflow operations/functions
  // operations?: any[]
}


/**
 * Describes the initial configuration for the application controller
 */
export interface AppControllerConfig {
  blueprints: BlueprintCollection
}

/**
 * All top level support
 *
 * @export
 * @class AppController
 */
export class AppController {

  /**
   * Singleton class instance
   *
   * @private
   * @static
   * @type {AppController}
   * @memberof AppController
   */
  private static _instance: AppController

  /**
   * Application configuration
   *
   * @private
   * @type {AppControllerConfig}
   * @memberof AppController
   */
  private readonly _config: AppControllerConfig

  /**
   * Create a new singleton instance only if it's undefined
   *
   * @private
   * @static
   * @throws
   * @param {AppControllerConfig} [config]
   * @returns {AppController}
   * @memberof AppController
   */
  private static _createInstance(config?: AppControllerConfig): AppController {
    return this._instance ??= new this(config)
  }

  /**
   * Initialize the app controller for the first time
   *
   * @static
   * @param {AppControllerConfig} [config]
   * @returns {AppController}
   * @memberof AppController
   */
  static initialize(config?: AppControllerConfig): AppController {
    return this._instance ?? this._createInstance(config)
  }

  /**
   * Get the current living singleton instance (must already be initialized!)
   *
   * @static
   * @throws
   * @returns {AppController}
   * @memberof AppController
   */
  static getInstance(): AppController {
    if (!this._instance) { throw new Error('App controller has not been initialized!') }
    return this._instance
  }

  /**
   * Living data
   *
   * @private
   * @type {CollectionModel}
   * @memberof AppController
   */
  private _collections: CollectionModel


  private constructor(config?: AppControllerConfig) {
    this._config = { ...defaultAppConfig, ...config }
    this._collections = new Collection()
    const bpCollection = new Collection(this._config.blueprints).init()
    this._collections.addSubCollection(bpCollection)
    this._collections.init()
  }

  getCollectionById(id: ID): CollectionModel | undefined
  getCollectionById(...ids: ID[]): CollectionModel[]
  getCollectionById(id: ID, ...ids: ID[]): CollectionModel | CollectionModel[] | undefined {
    return this._collections.getSubCollectionById(id, ...ids)
  }

  addCollection(v: CollectionModel<DocumentModel>): this {
    this._collections.addSubCollection(v)
    return this
  }

  removeCollection(id: ID): this
  removeCollection(item: CollectionModel): this
  removeCollection(item: ID | CollectionModel): this {
    this._collections.removeSubCollection(item)
    return this
  }

  getAllCollections(): CollectionModel {
    return this._collections
  }

}

console.log('app controller', AppController)