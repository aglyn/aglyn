/**
 * @license
 * Copyright 2022 Aglyn LLC
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

import { getStaticField, truthy } from '@aglyn/shared-util-tools'
import { DEFAULT_APP_UUN } from '../constants/app'
import { _INTERNAL_CANVAS_ } from '../constants/canvas'
import { _INTERNAL_COMMANDS_ } from '../constants/commands'
import { _INTERNAL_COMPONENTS_ } from '../constants/components'
import { _INTERNAL_CONTEXTS_ } from '../constants/contexts'
import { AglynEventStateFlag, AglynEventTriggerFlag } from '../constants/emitter'
import { _INTERNAL_EXTENSIONS_ } from '../constants/extensions'
import { AGLYN_PLATFORM, AglynPlatform } from '../constants/platform'
import { AglynVersion, SDK_VERSION } from '../constants/version'
import type {
  AglynAppOptions,
  AglynEffectOptions,
  AppUUN,
  IAglynAppController,
} from '../definitions/aglyn-app.types'
import type { AglynBaseModelT } from '../definitions/aglyn-base.types'
import type { IAglynCanvasController } from '../definitions/aglyn-canvas.types'
import type { IAglynCommandsController } from '../definitions/aglyn-commands.types'
import type { IAglynComponentsController } from '../definitions/aglyn-components.types'
import type { IAglynContextsController } from '../definitions/aglyn-contexts.types'
import type { IAglynDependencyManager } from '../definitions/aglyn-depends.types'
import type { IAglynExtensionsController } from '../definitions/aglyn-extensions.types'
import type { IAglynModuleModel } from '../definitions/aglyn-module.types'
import { AglynBaseModel } from '../models/aglyn-base.model'
import AglynDependencyManager from '../models/aglyn-depends.model'
import AglynCanvasController from './aglyn-canvas.controller'
import AglynCommandsController from './aglyn-commands.controller'
import AglynComponentsController from './aglyn-components.controller'
import AglynContextsController from './aglyn-contexts.controller'
import AglynExtensionsController from './aglyn-extensions.controller'

type BaseAppT = <T extends AglynBaseModelT>(
  model: T
) => new <Options>(...any: ConstructorParameters<T>) => AglynBaseModel<Options> &
  IAglynDependencyManager
const BaseApp: ReturnType<BaseAppT> = AglynDependencyManager(AglynBaseModel)

const TAG = 'AglynApp'
const NS = 'com.aglyn.core.data.framework.controller.app'

export class AglynAppController<Options extends AglynAppOptions = AglynAppOptions>
  extends BaseApp<Options>
  implements IAglynAppController<Options>
{
  public static get [Symbol.toStringTag](): string {
    return TAG
  }
  public static get namespace(): string {
    return NS
  }
  public static readonly platform: AglynPlatform = AGLYN_PLATFORM
  public static readonly version: AglynVersion = SDK_VERSION

  readonly #appName: AppUUN = null
  #deleted = false
  #extensionsController: IAglynExtensionsController = null
  #contextsController: IAglynContextsController = null
  #commandsController: IAglynCommandsController = null
  #componentsController: IAglynComponentsController = null
  #canvasController: IAglynCanvasController = null

  public get platform(): AglynPlatform {
    return getStaticField('platform', this)
  }
  public get version(): AglynVersion {
    return getStaticField('version', this)
  }
  public get appName(): AppUUN {
    return this.#appName
  }
  public get deleted(): boolean {
    return this.#deleted
  }
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

  protected get modules(): IAglynModuleModel[] {
    return [
      // Load internal modules before extensions
      this.#contextsController,
      this.#commandsController,
      this.#componentsController,
      this.#canvasController,

      // Last step
      this.#extensionsController,
    ]
  }

  constructor(options: Options) {
    super(options)
    this.#appName = options.appName || DEFAULT_APP_UUN
  }

  public setupModules() {
    this.handleEvent(
      [AglynEventStateFlag.APP_CREATING, AglynEventStateFlag.APP_CREATED],
      { appName: this.#appName },
      () => {
        this.#contextsController = new AglynContextsController(this, {
          ...this.options.modulesOptions?.contexts,
        })
        this.#commandsController = new AglynCommandsController(this, {
          ...this.options.modulesOptions?.commands,
        })
        this.#componentsController = new AglynComponentsController(this, {
          ...this.options.modulesOptions?.components,
        })
        this.#canvasController = new AglynCanvasController(this, {
          ...this.options.modulesOptions?.canvas,
        })
        _INTERNAL_CONTEXTS_.set(this.#appName, this.#contextsController)
        _INTERNAL_COMMANDS_.set(this.#appName, this.#commandsController)
        _INTERNAL_COMPONENTS_.set(this.#appName, this.#componentsController)
        _INTERNAL_CANVAS_.set(this.#appName, this.#canvasController)
      }
    )
    return this
  }
  public setupExtensions() {
    this.#extensionsController = new AglynExtensionsController(this, {
      ...this.options.modulesOptions?.extensions,
    })
    _INTERNAL_EXTENSIONS_.set(this.#appName, this.#extensionsController)
    return this
  }

  #initializeAppModules(): void {
    for (const mod of this.modules) {
      this.addDependency(mod)
    }
  }
  #destroyAppModules(): void {
    for (const mod of this.modules) {
      this.removeDependency(mod.namespace)
    }
  }

  public toString(): string {
    return `[object ${this[Symbol.toStringTag]}(name: '${this.#appName}')]`
  }
  public toJSON() {
    return {
      ...super.toJSON(),
      name: this.#appName,
      version: this.version,
      platform: this.platform,
    }
  }

  public onInitialize(): this {
    this.handleEvent(
      [AglynEventStateFlag.APP_INITIALIZING, AglynEventStateFlag.APP_INITIALIZED],
      { appName: this.#appName },
      () => {
        this.#initializeAppModules()
      }
    )
    return this
  }
  public onDestroy(): this {
    this.handleEvent(
      [AglynEventStateFlag.APP_DESTROYING, AglynEventStateFlag.APP_DESTROYED],
      { appName: this.#appName },
      () => {
        this.#destroyAppModules()
      }
    )
    return this
  }

  public getName(): AppUUN {
    return this.#appName
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
    return truthy(this.#deleted)
  }
  public setDeleted(value: boolean): this {
    this.#deleted = Boolean(value)
    return this
  }
  public effect<U>(data: AglynEffectOptions<AglynEventTriggerFlag, U>) {
    const { type, payload } = data
    this.emitter.emit(type, payload as any)
    return this
  }
}

export default AglynAppController
