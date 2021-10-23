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
  _contextsControllers,
  _extensionControllers,
} from '../constants/_internal'
import { AglynAppEffectFlag, AglynAppEventFlag } from '../constants/emitter'
import { DEFAULT_ENTRY_NAME } from '../constants/enums'
import { TYPE_OF } from '../constants/symbol'
import { AglynBaseModel, AglynBaseModelOptions } from '../models/aglyn-base.model'
import { AglynNamed, Payload } from '../types'
import { AglynCommandsController, AglynCommandsControllerT } from './aglyn-commands.controller'
import {
  AglynComponentsController,
  AglynComponentsControllerT,
} from './aglyn-components.controller'
import { AglynContextsController, AglynContextsControllerT } from './aglyn-contexts.controller'
import {
  AglynExtensionLoader,
  AglynExtensionsController,
  AglynExtensionsControllerT,
} from './aglyn-extensions.controller'


const TAG = 'AglynAppController'

export interface AglynAppOptions extends AglynNamed, AglynBaseModelOptions {
  extensions?: AglynExtensionLoader[]
}

export interface AglynEffectOptions<T, U = unknown> extends Payload<U> {
  type: T
}

export interface AglynAppController extends AglynBaseModel<AglynAppOptions> {
  getName(): string
  isDeleted(): boolean

  getExtensionsController(): AglynExtensionsController
  getContextsController(): AglynContextsController
  getCommandsController(): AglynCommandsController
  getComponentsController(): AglynComponentsController

  effect(data: AglynEffectOptions<AglynAppEffectFlag>): this
}

export class AglynAppController extends AglynBaseModel<AglynAppOptions> {

  public static readonly [Symbol.toStringTag]: string = TAG

  public readonly ExtensionController: AglynExtensionsControllerT = AglynExtensionsController
  public readonly ContextsController: AglynContextsControllerT = AglynContextsController
  public readonly CommandController: AglynCommandsControllerT = AglynCommandsController
  public readonly ComponentsController: AglynComponentsControllerT = AglynComponentsController

  #extensionController: AglynExtensionsController = null
  #contextsController: AglynContextsController = null
  #commandController: AglynCommandsController = null
  #componentsController: AglynComponentsController = null

  readonly #name: string = null
  #isDeleted = false

  public get [TYPE_OF]() {
    return getStaticField(TYPE_OF, this)
  }
  public get extensions(): AglynExtensionsController {
    return this.#extensionController
  }
  public get contexts(): AglynContextsController {
    return this.#contextsController
  }
  public get commands(): AglynCommandsController {
    return this.#commandController
  }
  public get components(): AglynComponentsController {
    return this.#componentsController
  }

  constructor(options: AglynAppOptions) {
    super(options)
    this.#name = options.name || DEFAULT_ENTRY_NAME
    this.#setup()
  }
  #setup() {
    this.getLogger().debug(AglynAppEventFlag.APP_CREATING, {appName: this.#name})
    this.getEmitter().emit(AglynAppEventFlag.APP_CREATING, {appName: this.#name})

    this.#setupAppModules()

    this.getLogger().debug(AglynAppEventFlag.APP_CREATED, {appName: this.#name})
    this.getEmitter().emit(AglynAppEventFlag.APP_CREATED, {appName: this.#name})
  }
  #setupAppModules(): void {
    this.#contextsController = new this.ContextsController({app: this})
    _contextsControllers.set(this.#name, this.#contextsController)

    this.#commandController = new this.CommandController({app: this})
    _commandControllers.set(this.#name, this.#commandController)

    this.#componentsController = new this.ComponentsController({app: this})
    _componentsControllers.set(this.#name, this.#componentsController)

    this.#extensionController = new this.ExtensionController({app: this})
    _extensionControllers.set(this.#name, this.#extensionController)
  }
  #initializeAppModules(): void {
    const modules = [
      // Load internal modules before extensions
      this.#contextsController,
      this.#commandController,
      this.#componentsController,

      // Last step
      this.#extensionController,
    ]

    modules.forEach((mod) => {
      const moduleName = mod.moduleName
      this.getLogger().debug(AglynAppEventFlag.APP_INITIALIZING_MODULE, {moduleName})
      this.getEmitter().emit(AglynAppEventFlag.APP_INITIALIZING_MODULE, {moduleName})
      mod.aglynOnInit(this)
      this.getLogger().debug(AglynAppEventFlag.APP_INITIALIZED_MODULE, {moduleName})
      this.getEmitter().emit(AglynAppEventFlag.APP_INITIALIZED_MODULE, {moduleName})
    })
  }
  #destroyAppModules(): void {
    const modules = [
      // Destroy extensions before internal modules
      this.#extensionController,

      // Then destroy internal modules
      this.#contextsController,
      this.#commandController,
      this.#componentsController,
    ]

    modules.forEach((mod) => {
      const moduleName = mod.moduleName
      this.getLogger().debug(AglynAppEventFlag.APP_DESTROYING_MODULE, {moduleName})
      this.getEmitter().emit(AglynAppEventFlag.APP_DESTROYING_MODULE, {moduleName})
      mod.aglynOnInit(this)
      this.getLogger().debug(AglynAppEventFlag.APP_DESTROYED_MODULE, {moduleName})
      this.getEmitter().emit(AglynAppEventFlag.APP_DESTROYED_MODULE, {moduleName})
    })
  }

  public aglynOnInit(): void {
    this.getLogger().debug(AglynAppEventFlag.APP_INITIALIZING, {appName: this.#name})
    this.getEmitter().emit(AglynAppEventFlag.APP_INITIALIZING, {appName: this.#name})

    this.#initializeAppModules()

    this.getLogger().debug(AglynAppEventFlag.APP_INITIALIZED, {appName: this.#name})
    this.getEmitter().emit(AglynAppEventFlag.APP_INITIALIZED, {appName: this.#name})
  }
  public aglynOnDestroy(): void {
    this.getLogger().debug(AglynAppEventFlag.APP_DESTROYING, {appName: this.#name})
    this.getEmitter().emit(AglynAppEventFlag.APP_DESTROYING, {appName: this.#name})

    this.#destroyAppModules()

    this.getLogger().debug(AglynAppEventFlag.APP_DESTROYED, {appName: this.#name})
    this.getEmitter().emit(AglynAppEventFlag.APP_DESTROYED, {appName: this.#name})
  }
  public toString(): string {
    return `${TAG}(name: '${name}')`
  }
  public toJSON() {
    return {
      ...super.toJSON(),
      name: this.#name,
    }
  }

  public getName = (): string => {
    return this.#name
  }
  public getExtensionsController = (): AglynExtensionsController => {
    return this.#extensionController
  }
  public getContextsController = (): AglynContextsController => {
    return this.#contextsController
  }
  public getCommandsController = (): AglynCommandsController => {
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
  public effect = (data: AglynEffectOptions<AglynAppEffectFlag>) => {
    const {type, payload} = data
    this.getEmitter().emit(type, payload as any)
    return this
  }
}

export type AglynAppControllerT = typeof AglynAppController
export default AglynAppController
