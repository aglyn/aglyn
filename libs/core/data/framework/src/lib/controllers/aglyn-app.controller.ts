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
  _commandsControllers,
  _componentsControllers,
  _contextsControllers,
  _extensionsControllers,
  DEFAULT_ENTRY_NAME,
} from '../constants/_internal'
import { AglynAppEffectFlag, AglynAppEventFlag } from '../constants/emitter'
import { TYPE_OF } from '../constants/symbol'
import { AglynBaseModel, AglynBaseModelOptions } from '../models/aglyn-base.model'
import { AppUUN, Payload } from '../types'
import { AglynCommandsController, AglynCommandsControllerT } from './aglyn-commands.controller'
import {
  AglynComponentsController,
  AglynCommandsControllerOptions,
  AglynComponentsControllerT,
} from './aglyn-components.controller'
import {
  AglynContextsController,
  AglynContextsControllerOptions,
  AglynContextsControllerT,
} from './aglyn-contexts.controller'
import {
  AglynExtensionsController,
  AglynExtensionsControllerOptions,
  AglynExtensionsControllerT,
} from './aglyn-extensions.controller'


export interface AglynAppOptions extends AglynBaseModelOptions {
  appName?: AppUUN
  modulesOptions?: {
    contexts?: Omit<AglynContextsControllerOptions, 'app'>
    extensions?: Omit<AglynExtensionsControllerOptions, 'app'>
    commands?: Omit<AglynExtensionsControllerOptions, 'app'>
    components?: Omit<AglynCommandsControllerOptions, 'app'>
  }
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

const TAG = 'AglynApp'

export class AglynAppController extends AglynBaseModel<AglynAppOptions> {

  public static readonly [Symbol.toStringTag]: string = TAG

  public readonly ExtensionController: AglynExtensionsControllerT = AglynExtensionsController
  public readonly ContextsController: AglynContextsControllerT = AglynContextsController
  public readonly CommandController: AglynCommandsControllerT = AglynCommandsController
  public readonly ComponentsController: AglynComponentsControllerT = AglynComponentsController

  #extensionsController: AglynExtensionsController = null
  #contextsController: AglynContextsController = null
  #commandsController: AglynCommandsController = null
  #componentsController: AglynComponentsController = null

  readonly #name: string = null
  #isDeleted = false

  public get [TYPE_OF]() {
    return getStaticField(TYPE_OF, this)
  }
  public get extensions(): AglynExtensionsController {
    return this.#extensionsController
  }
  public get contexts(): AglynContextsController {
    return this.#contextsController
  }
  public get commands(): AglynCommandsController {
    return this.#commandsController
  }
  public get components(): AglynComponentsController {
    return this.#componentsController
  }
  public get deleted(): boolean {
    return this.#isDeleted
  }

  constructor(options: AglynAppOptions) {
    super(options)
    this.#name = options.appName || DEFAULT_ENTRY_NAME
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
    _contextsControllers.set(
      this.#name,
      this.#contextsController = new this.ContextsController({
        ...this.options.modulesOptions?.contexts,
        app: this,
      }),
    )
    _commandsControllers.set(
      this.#name,
      this.#commandsController = new this.CommandController({
        ...this.options.modulesOptions?.commands,
        app: this,
      }),
    )
    _componentsControllers.set(
      this.#name,
      this.#componentsController = new this.ComponentsController({
        ...this.options.modulesOptions?.components,
        app: this,
      }),
    )
    _extensionsControllers.set(
      this.#name,
      this.#extensionsController = new this.ExtensionController({
        ...this.options.modulesOptions?.extensions,
        app: this,
      }),
    )
  }
  #initializeAppModules(): void {
    const modules = [
      // Load internal modules before extensions
      this.#contextsController,
      this.#commandsController,
      this.#componentsController,

      // Last step
      this.#extensionsController,
    ]

    modules.forEach((mod) => {
      const moduleName = mod.moduleName
      this.getLogger().debug(AglynAppEventFlag.APP_MODULE_INITIALIZING, {moduleName})
      this.getEmitter().emit(AglynAppEventFlag.APP_MODULE_INITIALIZING, {moduleName})
      mod.aglynOnInit(this)
      this.getLogger().debug(AglynAppEventFlag.APP_MODULE_INITIALIZED, {moduleName})
      this.getEmitter().emit(AglynAppEventFlag.APP_MODULE_INITIALIZED, {moduleName})
    })
  }
  #destroyAppModules(): void {
    const modules = [
      // Destroy extensions before internal modules
      this.#extensionsController,

      // Then destroy internal modules
      this.#contextsController,
      this.#commandsController,
      this.#componentsController,
    ]

    modules.forEach((mod) => {
      const moduleName = mod.moduleName
      this.getLogger().debug(AglynAppEventFlag.APP_MODULE_DESTROYING, {moduleName})
      this.getEmitter().emit(AglynAppEventFlag.APP_MODULE_DESTROYING, {moduleName})
      mod.aglynOnInit(this)
      this.getLogger().debug(AglynAppEventFlag.APP_MODULE_DESTROYED, {moduleName})
      this.getEmitter().emit(AglynAppEventFlag.APP_MODULE_DESTROYED, {moduleName})
    })
  }
  public toString(): string {
    return `${this[Symbol.toStringTag]}(name: '${name}')`
  }
  public toJSON() {
    return {
      ...super.toJSON(),
      name: this.#name,
    }
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

  public getName = (): string => {
    return this.#name
  }
  public getExtensionsController = (): AglynExtensionsController => {
    return this.#extensionsController
  }
  public getContextsController = (): AglynContextsController => {
    return this.#contextsController
  }
  public getCommandsController = (): AglynCommandsController => {
    return this.#commandsController
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
