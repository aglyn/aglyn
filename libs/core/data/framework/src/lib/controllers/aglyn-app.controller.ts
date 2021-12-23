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

import {yes} from '@aglyn/shared-util-tools'
import {
  _INTERNAL_BESIGNERS_,
  _INTERNAL_CANVAS_,
  _INTERNAL_COMMANDS_,
  _INTERNAL_COMPONENTS_,
  _INTERNAL_CONTEXTS_,
  _INTERNAL_EXTENSIONS_,
  DEFAULT_APP_UUN,
} from '../constants/_internal'
import {AglynAppEffectFlag, AglynAppEventFlag} from '../constants/emitter'
import AglynBaseModel from '../models/aglyn-base.model'
import type {AglynAppOptions, AglynEffectOptions, IAglynAppController} from './aglyn-app.types'
import AglynBesignerController from './aglyn-besigner.controller'
import type {IAglynBesignerController} from './aglyn-besigner.types'
import AglynCanvasController from './aglyn-canvas.controller'
import type {IAglynCanvasController} from './aglyn-canvas.types'
import AglynCommandsController from './aglyn-commands.controller'
import type {IAglynCommandsController} from './aglyn-commands.types'
import AglynComponentsController from './aglyn-components.controller'
import type {IAglynComponentsController} from './aglyn-components.types'
import AglynContextsController from './aglyn-contexts.controller'
import type {IAglynContextsController} from './aglyn-contexts.types'
import AglynExtensionsController from './aglyn-extensions.controller'
import type {IAglynExtensionsController} from './aglyn-extensions.types'


const TAG = 'AglynApp'

export class AglynAppController extends AglynBaseModel<AglynAppOptions> implements IAglynAppController {

  public static readonly [Symbol.toStringTag]: string = TAG

  readonly #name: string = null

  #extensionsController: IAglynExtensionsController = null
  #contextsController: IAglynContextsController = null
  #commandsController: IAglynCommandsController = null
  #componentsController: IAglynComponentsController = null
  #canvasController: IAglynCanvasController = null
  #besignerController: IAglynBesignerController = null
  #isDeleted = false

  public get extensions(): IAglynExtensionsController {
    return this.#extensionsController
  }
  public get contexts(): IAglynContextsController {
    return this.#contextsController
  }
  public get commands(): IAglynCommandsController {
    return this.#commandsController
  }
  public get components(): IAglynComponentsController {
    return this.#componentsController
  }
  public get canvas(): IAglynCanvasController {
    return this.#canvasController
  }
  public get besigner(): IAglynBesignerController {
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

  public getName(): string {
    return this.#name
  }
  public getExtensionsController(): IAglynExtensionsController {
    return this.#extensionsController
  }
  public getContextsController(): IAglynContextsController {
    return this.#contextsController
  }
  public getCanvasController(): IAglynCanvasController {
    return this.#canvasController
  }
  public getCommandsController(): IAglynCommandsController {
    return this.#commandsController
  }
  public getComponentsController(): IAglynComponentsController {
    return this.#componentsController
  }
  public isDeleted(): boolean {
    return yes(this.#isDeleted)
  }
  public setDeleted(value: boolean): this {
    this.#isDeleted = Boolean(value)
    return this
  }
  public effect(data: AglynEffectOptions<AglynAppEffectFlag>) {
    const {type, payload} = data
    this.getEmitter().emit(type, payload as any)
    return this
  }
}

export default AglynAppController
