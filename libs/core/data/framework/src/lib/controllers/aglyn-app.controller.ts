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

import { getStaticField, yes } from '@aglyn/shared-util-tools'
import {
  _commandControllers,
  _componentsControllers,
  _extensionControllers,
} from '../constants/_internal'
import { AGLYN_EMITTER, AglynAppEventFlag, AglynModuleActionFlag } from '../constants/emitter'
import { DEFAULT_ENTRY_NAME } from '../constants/enums'
import { AGLYN_ERROR } from '../constants/error'
import { AGLYN_LOGGER } from '../constants/logger'
import { TYPE_OF } from '../constants/symbol'
import { AglynBaseModel } from '../models/aglyn-base.model'
import { AglynNamed, AglynPlatform, AglynVersion, Payload } from '../types'
import { AglynCommandController } from './aglyn-command.controller'
import { AglynComponentsController } from './aglyn-components.controller'
import { AglynExtensionController, AglynExtensionLoader } from './aglyn-extension.controller'


const TAG = 'AglynAppController'

export type AglynAppOptions = AglynNamed & {
  extensions?: AglynExtensionLoader[]
}

export interface AglynEffectOptions<T, U = unknown> extends Payload<U> {
  type: T
}

export interface AglynAppController extends AglynBaseModel {
  getName(): string
  getOptions(): AglynAppOptions
  getDeleted(): boolean
  setDeleted(deleted: boolean): this
  getCommandsController(): AglynCommandController
  getExtensionsController(): AglynExtensionController

  effect(data: AglynEffectOptions<AglynModuleActionFlag>): this
}

export class AglynAppController extends AglynBaseModel {

  public static readonly [Symbol.toStringTag]: string = TAG

  public readonly AglynAppExtensionController = AglynExtensionController
  public readonly AglynAppCommandController = AglynCommandController
  public readonly AglynAppComponentsController = AglynComponentsController

  #extensionController: AglynExtensionController = null
  #commandController: AglynCommandController = null
  #componentsController: AglynComponentsController = null

  readonly #options: AglynAppOptions = null
  readonly #name: string = null
  #isDeleted = false

  public get [TYPE_OF]() {
    return getStaticField(TYPE_OF, this)
  }
  public get platform(): AglynPlatform {
    return getStaticField('platform', this)
  }
  public get version(): AglynVersion {
    return getStaticField('version', this)
  }
  public get extensions(): AglynExtensionController {
    return this.#extensionController
  }
  public get commands(): AglynCommandController {
    return this.#commandController
  }
  public get components(): AglynComponentsController {
    return this.#componentsController
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
    this.#componentsController = new this.AglynAppComponentsController({app: this})

    this.#extensionController = new this.AglynAppExtensionController({app: this})

    _commandControllers.set(this.#name, this.#commandController)
    _componentsControllers.set(this.#name, this.#componentsController)

    _extensionControllers.set(this.#name, this.#extensionController)

    this.getLogger().debug(AglynAppEventFlag.APP_CREATED, {app: this})
    this.getEmitter().emit(AglynAppEventFlag.APP_CREATED, {app: this})
  }

  public onInit = (): void => {
    this.#commandController.onInit()
    this.#componentsController.onInit()

    this.#extensionController.onInit()

    this.getLogger().debug(AglynAppEventFlag.APP_LOADED, {appName: this.#name})
    this.getEmitter().emit(AglynAppEventFlag.APP_LOADED, {appName: this.#name})
  }
  public onDestroy = (): void => {
    this.#extensionController.unloadAllExtensions()
    this.#extensionController.onDestroy()

    this.#commandController.onDestroy()
    this.#componentsController.onDestroy()

    this.getLogger().debug(AglynAppEventFlag.APP_UNLOADED, {appName: this.#name})
    this.getEmitter().emit(AglynAppEventFlag.APP_UNLOADED, {appName: this.#name})
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

  public getName = (): string => {
    return this.#name
  }
  public getOptions = (): AglynAppOptions => {
    return this.#options
  }
  public getExtensionsController = (): AglynExtensionController => {
    return this.#extensionController
  }
  public getCommandsController = (): AglynCommandController => {
    return this.#commandController
  }
  public getComponentsController = (): AglynComponentsController => {
    return this.#componentsController
  }
  public isDeleted = (): boolean => {
    return yes(this.#isDeleted)
  }
  public setDeleted = (value: boolean): this => {
    this.#isDeleted = Boolean(value)
    return this
  }
  public effect = (data: AglynEffectOptions<AglynModuleActionFlag>) => {
    const {type, payload} = data
    this.getEmitter().emit(type, payload as any)
    return this
  }
}

export default AglynAppController
