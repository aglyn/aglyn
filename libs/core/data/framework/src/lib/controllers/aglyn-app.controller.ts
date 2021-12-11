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

import { yes } from '@aglyn/shared-util-tools'
import {
  _INTERNAL_BESIGNERS_,
  _INTERNAL_CANVAS_,
  _INTERNAL_COMMANDS_,
  _INTERNAL_COMPONENTS_,
  _INTERNAL_CONTEXTS_,
  _INTERNAL_EXTENSIONS_,
  DEFAULT_APP_UUN,
} from '../constants/_internal'
import { AglynAppEffectFlag, AglynAppEventFlag } from '../constants/emitter'
import { AglynBaseModel, AglynBaseModelOptions } from '../models/aglyn-base.model'
import { AppUUN, Payload } from '../types'
import {
  AglynBesignerController,
  AglynBesignerControllerOptions,
} from './aglyn-besigner.controller'
import { AglynCanvasController, AglynCanvasControllerOptions } from './aglyn-canvas.controller'
import { AglynCommandsController } from './aglyn-commands.controller'
import {
  AglynComponentsController,
  AglynComponentsControllerOptions,
} from './aglyn-components.controller'
import {
  AglynContextsController,
  AglynContextsControllerOptions,
} from './aglyn-contexts.controller'
import {
  AglynExtensionsController,
  AglynExtensionsControllerOptions,
} from './aglyn-extensions.controller'


export interface AglynAppOptions extends AglynBaseModelOptions {
  appName?: AppUUN
  modulesOptions?: {
    contexts?: AglynContextsControllerOptions
    extensions?: AglynExtensionsControllerOptions
    commands?: AglynExtensionsControllerOptions
    components?: AglynComponentsControllerOptions
    canvas?: AglynCanvasControllerOptions
    besigner?: AglynBesignerControllerOptions
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

  readonly #name: string = null

  #extensionsController: AglynExtensionsController = null
  #contextsController: AglynContextsController = null
  #commandsController: AglynCommandsController = null
  #componentsController: AglynComponentsController = null
  #canvasController: AglynCanvasController = null
  #besignerController: AglynBesignerController = null
  #isDeleted = false

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
  public get canvas(): AglynCanvasController {
    return this.#canvasController
  }
  public get besigner(): AglynBesignerController {
    return this.#besignerController
  }
  public get deleted(): boolean {
    return this.#isDeleted
  }

  constructor(options: AglynAppOptions) {
    super({...options})
    this.#name = options.appName || DEFAULT_APP_UUN
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
    _INTERNAL_CONTEXTS_.set(
      this.#name,
      this.#contextsController = new AglynContextsController(this, {
        ...this.options.modulesOptions?.contexts,
      }),
    )
    _INTERNAL_COMMANDS_.set(
      this.#name,
      this.#commandsController = new AglynCommandsController(this, {
        ...this.options.modulesOptions?.commands,
      }),
    )
    _INTERNAL_COMPONENTS_.set(
      this.#name,
      this.#componentsController = new AglynComponentsController(this, {
        ...this.options.modulesOptions?.components,
      }),
    )
    _INTERNAL_CANVAS_.set(
      this.#name,
      this.#canvasController = new AglynCanvasController(this, {
        ...this.options.modulesOptions?.canvas,
      }),
    )
    _INTERNAL_BESIGNERS_.set(
      this.#name,
      this.#besignerController = new AglynBesignerController(this, {
        ...this.options.modulesOptions?.besigner,
      }),
    )
    _INTERNAL_EXTENSIONS_.set(
      this.#name,
      this.#extensionsController = new AglynExtensionsController(this, {
        ...this.options.modulesOptions?.extensions,
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
