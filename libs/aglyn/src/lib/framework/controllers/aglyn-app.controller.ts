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

import type {
  AglynAppOptions,
  AglynBaseModelT,
  AglynEffectOptions,
  AppUUN,
  IAglynAppController,
  IAglynCanvasController,
  IAglynCommandsController,
  IAglynComponentsController,
  IAglynContextsController,
  IAglynDependencyManager,
  IAglynExtensionsController,
  IAglynModuleModel,
} from '../../foundation'
import {
  _INTERNAL_CANVAS_,
  _INTERNAL_COMMANDS_,
  _INTERNAL_COMPONENTS_,
  _INTERNAL_CONTEXTS_,
  _INTERNAL_EXTENSIONS_,
  AGLYN_PLATFORM,
  AglynEventStateFlag,
  AglynEventTriggerFlag,
  AglynPlatform,
  AglynVersion,
  DEFAULT_APP_UUN,
  SDK_VERSION,
} from '../../foundation'
import { compress, decompress } from '../../app-utils'
import { getStaticField, truthy } from '@aglyn/shared-util-tools'
import { Bytes } from 'firebase/firestore'
import AglynBaseModel from '../models/aglyn-base.model'
import AglynDependencyManager from '../models/aglyn-depends.model'
import AglynCanvasController from './aglyn-canvas.controller'
import AglynCommandsController from './aglyn-commands.controller'
import AglynComponentsController from './aglyn-components.controller'
import AglynContextsController from './aglyn-contexts.controller'
import AglynExtensionsController from './aglyn-extensions.controller'

type BaseAppT = <T extends AglynBaseModelT>(
  model: T,
) => new <Options>(
  ...any: ConstructorParameters<T>
) => AglynBaseModel<Options> & IAglynDependencyManager
const BaseApp = AglynDependencyManager(
  AglynBaseModel,
) as unknown as ReturnType<BaseAppT>

const TAG = 'AglynApp'
const NS = 'com.aglyn.core.data.controller.app'

export class AglynAppController<
    Options extends AglynAppOptions = AglynAppOptions,
  >
  extends BaseApp<Options>
  implements IAglynAppController<Options>
{
  public static readonly platform: AglynPlatform = AGLYN_PLATFORM
  public static readonly version: AglynVersion = SDK_VERSION
  private readonly _appName: AppUUN = null
  private _deleted = false
  private _extensionsController: IAglynExtensionsController = null
  private _contextsController: IAglynContextsController = null
  private _commandsController: IAglynCommandsController = null
  private _componentsController: IAglynComponentsController = null
  private _canvasController: IAglynCanvasController = null

  public static get [Symbol.toStringTag](): string {
    return TAG
  }
  public static get namespace(): string {
    return NS
  }
  public get platform(): AglynPlatform {
    return getStaticField('platform', this)
  }
  public get version(): AglynVersion {
    return getStaticField('version', this)
  }
  public get appName(): AppUUN {
    return this._appName
  }
  public get deleted(): boolean {
    return this._deleted
  }
  public get extensions(): IAglynExtensionsController {
    return this._extensionsController
  }
  public get contexts(): IAglynContextsController {
    return this._contextsController
  }
  public get commands(): IAglynCommandsController {
    return this._commandsController
  }
  public get components(): IAglynComponentsController {
    return this._componentsController
  }
  public get canvas(): IAglynCanvasController {
    return this._canvasController
  }

  protected get modules(): IAglynModuleModel[] {
    return [
      // Load internal modules before extensions
      this._contextsController,
      this._commandsController,
      this._componentsController,
      this._canvasController,

      // Last step
      this._extensionsController,
    ]
  }

  constructor(options: Options) {
    super(options)
    this._appName = options.appName || DEFAULT_APP_UUN
  }

  private initializeAppModules(): void {
    for (const mod of this.modules) {
      this.addDependency(mod)
    }
  }
  private destroyAppModules(): void {
    for (const mod of this.modules) {
      this.removeDependency(mod.namespace)
    }
  }

  public setupModules() {
    this.handleEvent(
      [AglynEventStateFlag.APP_CREATING, AglynEventStateFlag.APP_CREATED],
      { appName: this._appName },
      () => {
        this._contextsController = new AglynContextsController(this, {
          ...this.options.modulesOptions?.contexts,
        })
        this._commandsController = new AglynCommandsController(this, {
          ...this.options.modulesOptions?.commands,
        })
        this._componentsController = new AglynComponentsController(this, {
          ...this.options.modulesOptions?.components,
        })
        this._canvasController = new AglynCanvasController(this, {
          ...this.options.modulesOptions?.canvas,
        })
        _INTERNAL_CONTEXTS_.set(this._appName, this._contextsController)
        _INTERNAL_COMMANDS_.set(this._appName, this._commandsController)
        _INTERNAL_COMPONENTS_.set(this._appName, this._componentsController)
        _INTERNAL_CANVAS_.set(this._appName, this._canvasController)
      },
    )
    return this
  }
  public setupExtensions() {
    this._extensionsController = new AglynExtensionsController(this, {
      ...this.options.modulesOptions?.extensions,
    })
    _INTERNAL_EXTENSIONS_.set(this._appName, this._extensionsController)
    return this
  }

  public toString(): string {
    return `[object ${this[Symbol.toStringTag]}('${this._appName}')]`
  }
  public toJSON() {
    return {
      ...super.toJSON(),
      name: this._appName,
      version: this.version,
      platform: this.platform,
    }
  }

  public onInitialize(): this {
    this.handleEvent(
      [
        AglynEventStateFlag.APP_INITIALIZING,
        AglynEventStateFlag.APP_INITIALIZED,
      ],
      { appName: this._appName },
      () => {
        this.initializeAppModules()
      },
    )
    return this
  }
  public onActivate(): this {
    this.handleEvent(
      [AglynEventStateFlag.APP_ACTIVATING, AglynEventStateFlag.APP_ACTIVATED],
      { appName: this._appName },
      () => {},
    )
    return this
  }
  public onDeactivate(): this {
    this.handleEvent(
      [
        AglynEventStateFlag.APP_DEACTIVATING,
        AglynEventStateFlag.APP_DEACTIVATED,
      ],
      { appName: this._appName },
      () => {},
    )
    return this
  }
  public onDestroy(): this {
    this.handleEvent(
      [AglynEventStateFlag.APP_DESTROYING, AglynEventStateFlag.APP_DESTROYED],
      { appName: this._appName },
      () => {
        this.destroyAppModules()
      },
    )
    return this
  }

  public getName(): AppUUN {
    return this._appName
  }
  public getExtensionsController(): IAglynExtensionsController {
    return this._extensionsController
  }
  public getContextsController(): IAglynContextsController {
    return this._contextsController
  }
  public getCanvasController(): IAglynCanvasController {
    return this._canvasController
  }
  public getCommandsController(): IAglynCommandsController {
    return this._commandsController
  }
  public getComponentsController(): IAglynComponentsController {
    return this._componentsController
  }
  public isDeleted(): boolean {
    return truthy(this._deleted)
  }
  public setDeleted(value: boolean): this {
    this._deleted = Boolean(value)
    return this
  }
  public effect<U>(data: AglynEffectOptions<AglynEventTriggerFlag, U>): this {
    const { type, payload } = data
    this.emitter.emit(type, payload as any)
    return this
  }
  public static compress<T>(value: T): Bytes {
    return compress(value)
  }
  public static decompress<T>(value: Bytes): T {
    return decompress(value)
  }
  public compress<T>(value: T): Bytes {
    return AglynAppController.compress(value)
  }
  public decompress<T>(value: Bytes): T {
    return AglynAppController.decompress(value)
  }
}

export default AglynAppController
