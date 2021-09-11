/**
 * @license
 * Copyright 2021 Aglyn LLC
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

import {
  AGLYN_ERROR,
  AglynAppEventFlag,
  AglynAppInstance,
  AglynAppOptions,
  AglynCommandControllerInstance,
  AglynEffectType,
  AglynExtensionControllerInstance,
  AglynModuleEventFlag,
  AglynPlatform,
  AglynVersion,
  APP_TYPE,
  DEFAULT_ENTRY_NAME,
  TYPE_OF,
} from '@aglyn/framework/sdk'
import { AglynExtensionController } from './aglyn-extension.controller'
import { AglynCommandController } from './aglyn-command.controller'
import { getStaticField } from '@aglyn/shared/util/tools'
import { AglynBaseModel } from '../models/aglyn-base.model'
import { _commandControllers, _extensionControllers } from '../_internal'
import { AGLYN_LOGGER } from '../logger'
import { AGLYN_EMITTER } from '../emitter'
import { AGLYN_PLATFORM } from '../platform'
import { SDK_VERSION } from '../version'


const TAG = 'AglynApp'

export class AglynAppController extends AglynBaseModel implements AglynAppInstance {

  public static readonly [Symbol.toStringTag]: string = TAG
  public static readonly [TYPE_OF]: number | symbol = APP_TYPE
  public static readonly platform: AglynPlatform = AGLYN_PLATFORM
  public static readonly version: AglynVersion = SDK_VERSION
  public readonly AglynAppCommandController = AglynCommandController
  public readonly AglynAppExtensionController = AglynExtensionController
  readonly #options: AglynAppOptions = null
  readonly #name: string = null
  #deleted = false
  #commandController: AglynCommandControllerInstance = null
  #extensionController: AglynExtensionControllerInstance = null
  public get [TYPE_OF]() {
    return getStaticField(TYPE_OF, this)
  }
  public get platform(): AglynExtensionControllerInstance {
    return getStaticField('platform', this)
  }
  public get version(): AglynExtensionControllerInstance {
    return getStaticField('version', this)
  }
  public get commands(): AglynCommandControllerInstance {
    return this.#commandController
  }
  public get extensions(): AglynExtensionControllerInstance {
    return this.#extensionController
  }
  constructor(options: AglynAppOptions) {
    super()
    this.#options = {...options}
    this.#name = this.#options.name ?? DEFAULT_ENTRY_NAME
    this.#initialize()
  }
  #initialize() {
    this.setErrorFactory(AGLYN_ERROR)
    this.setEmitter(AGLYN_EMITTER)
    this.setLogger(AGLYN_LOGGER)

    this.#commandController = new this.AglynAppCommandController({app: this})
    this.#extensionController = new this.AglynAppExtensionController({app: this})
    _commandControllers.set(this.#name, this.#commandController)
    _extensionControllers.set(this.#name, this.#extensionController)

    this.getLogger().debug(AglynAppEventFlag.APP_CREATED, {app: this})
    this.getEmitter().emit(AglynAppEventFlag.APP_CREATED, {app: this})
  }
  public toString = (): string => {
    return `${TAG}(name: '${name}')`
  }
  public toJSON = () => {
    return {
      ...super.toJSON(),
      name: this.#name,
      options: this.#options,
    }
  }
  public onInit = (): void => {
    this.#commandController.onInit()
    this.#extensionController.onInit()
    this.getLogger().debug(AglynAppEventFlag.APP_LOADED, {appName: this.#name})
    this.getEmitter().emit(AglynAppEventFlag.APP_LOADED, {appName: this.#name})
  }
  public onDestroy = (): void => {
    this.#extensionController.unloadAllExtensions()
    this.#commandController.onDestroy()
    this.#extensionController.onDestroy()
    this.getLogger().debug(AglynAppEventFlag.APP_UNLOADED, {appName: this.#name})
    this.getEmitter().emit(AglynAppEventFlag.APP_UNLOADED, {appName: this.#name})
  }
  public getName = (): string => {
    return this.#name
  }
  public getOptions = (): AglynAppOptions => {
    return this.#options
  }
  public getExtensionsController = (): AglynExtensionControllerInstance => {
    return this.#extensionController
  }
  public getCommandsController = (): AglynCommandControllerInstance => {
    return this.#commandController
  }
  public getDeleted = (): boolean => {
    return this.#deleted
  }
  public setDeleted = (value: boolean): this => {
    this.#deleted = Boolean(value)
    return this
  }
  public effect = (data: AglynEffectType<AglynModuleEventFlag>) => {
    const {type, payload} = data
    this.getEmitter().emit(type, payload as any)
  }

}
