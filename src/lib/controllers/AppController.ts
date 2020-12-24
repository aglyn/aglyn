import { defaultAppConfig } from '../app-defaults'
import { PKey } from '../interfaces/dod'
import { Ref } from '../interfaces/dod'
import { copyJson } from '../tools/utils'

import { CollectionRefController } from './CollectionRefController'
import { DatabaseRefController } from './DatabaseRefController'
import { DocumentRefController } from './DocumentRefController'
import { FieldRefController } from './FieldRefController'

/**
 * Describes the initial configuration for the application controller
 */
export interface AppControllerConfig {
  databases: {
    [databaseId: string]: Ref.Database
  }
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
   * Living collections data
   *
   * @private
   * @type {any}
   * @memberof AppController
   */
  private _databases: {
    [databaseId: string]: Ref.Database
  } = {}


  private constructor(config?: AppControllerConfig) {
    this._config = {
      ...copyJson(defaultAppConfig),
      ...copyJson(config ?? {})
    }
    this._databases = this._config.databases
    console.log('_blueprints', this._databases)
  }

  public getConfig() {
    return this._config
  }

  public getDatabase(dbId: PKey): DatabaseRefController<any> {
    const db = this._databases[dbId]
    return DatabaseRefController.from(dbId, db.schemas, db.instances)
  }

  public setDatabase(dbId: PKey, value: Ref.Database): this {
    this._databases[dbId] = value
    return this
  }

  public getCollection(dbId: PKey, cId: PKey): CollectionRefController<any> {
    const db = this.getDatabase(dbId)
    const c = db?.get(cId)
    return !c ? null : CollectionRefController.from(cId, db.meta.schema[cId], c)
  }

  public getDocument(dbId: PKey, cId: PKey, dId: PKey): DocumentRefController<any> {
    const c = this.getCollection(dbId, cId)
    const doc = c?.get(dId)
    return !doc ? null : DocumentRefController.from(dId, c.meta.schema.fields, doc)
  }

  public getField(dbId: PKey, cId: PKey, dId: PKey, fId: PKey): FieldRefController<any> {
    const doc = this.getDocument(dbId, cId, dId)
    const f = doc?.get(fId)
    return !f ? null : FieldRefController.from(fId, doc.meta.schema[fId], f)
  }

}

// console.log('app controller', AppController)