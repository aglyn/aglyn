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

import {AglynExtension} from '@aglyn/core-data-framework'
import type {MutableShallow} from '@aglyn/shared-data-types'
import {_isCtor} from '@aglyn/shared-util-guards'
import type {
  ExtensionDestroyPayload,
  ExtensionHandleLoaderPayload,
  ExtensionInitializePayload,
  ExtensionLoadPayload,
  ExtensionRegisterPayload,
  ExtensionUnloadPayload,
} from '../constants/emitter'
import {AglynAppEffectFlag, AglynAppEventFlag} from '../constants/emitter'
import {AGLYN_ERROR, AglynErrorEventFlag} from '../constants/error'
import {AglynLifecycleFlag} from '../constants/lifecycle'
import type {IAglynExtension} from '../models/aglyn-extension.types'
import AglynModuleModel from '../models/aglyn-module.model'
import type {AglynModuleEffectListener} from '../models/aglyn-module.types'
import type {AglynExtensionMap, ExtensionUUN} from '../types'
import {isAglynExtension, isAglynModule} from '../util/aglyn-is'
import type {IAglynAppController} from './aglyn-app.types'
import type {
  AglynExtensionsControllerOptions,
  IAglynExtensionsController,
} from './aglyn-extensions.types'


const TAG = 'AglynExtensions'
const MODULE_NAME = 'extensions'

export class AglynExtensionsController extends AglynModuleModel<AglynExtensionsControllerOptions> implements IAglynExtensionsController {

  public static readonly [Symbol.toStringTag]: string = TAG
  public static readonly namespace: string = `aglyn:${MODULE_NAME}`
  public static readonly moduleName: string = MODULE_NAME

  protected extensions: AglynExtensionMap = new Map()

  constructor(app: IAglynAppController, options: AglynExtensionsControllerOptions) {
    super(app, options)
    this.#setup()
  }
  #setup() {
    this.#setupInitialExtensions()
  }
  #setupInitialExtensions(): void {
    this.options.initialExtensions?.forEach((payload) => {
      this.handleLoader(payload)
    })
  }

  public toJSON() {
    return {
      ...super.toJSON(),
      extensions: this.extensions.keys(),
    }
  }
  public aglynOnDestroy(): void {
    this.unloadAllExtensions()
    this.destroyAllExtensions()
    super.aglynOnDestroy()
  }

  public handleLoader(payload: ExtensionHandleLoaderPayload): IAglynExtension {
    const {loader, options} = payload
    const module = loader()
    const appName = this.app.getName()
    if (!module) {
      throw AGLYN_ERROR.create(AglynErrorEventFlag.EXTENSION_BAD_MODULE_LOADER, {appName})
    }
    if (!isAglynModule(module) || !isAglynExtension(module) || !_isCtor(module)) {
      throw AGLYN_ERROR.create(AglynErrorEventFlag.EXTENSION_BAD_MODULE, {
        appName, extensionName: module?.['extensionName'] ?? 'unknown',
      })
    }
    const instance = new module({...options, app: this.app})
    if (!(instance instanceof AglynExtension)) {
      throw AGLYN_ERROR.create(AglynErrorEventFlag.EXTENSION_BAD_MODULE, {
        appName, extensionName: module?.['extensionName'] ?? 'unknown',
      })
    }
    this.registerExtension({extension: instance})
    return instance
  }
  public getExtensionByName(extensionName: ExtensionUUN): IAglynExtension {
    const extension = this.extensions.get(extensionName)
    if (extension) {
      const current = extension?.lifecycle
      const autoload = extension?.getOptions?.()?.autoload
      if (current === AglynLifecycleFlag.INITIALIZED && autoload) {
        this.loadExtension({extensionName})
      }
    }
    else {
      // TODO: throw errorFactory error
    }
    return extension
  }
  public getAllExtensions(): IAglynExtension[] {
    return [...this.extensions.values()]
  }

  public registerExtension(payload: ExtensionRegisterPayload): void {
    const {extension} = payload
    const extensionName = extension?.extensionName
    if (extensionName && isAglynExtension(extension)) {
      extension.lifecycle = AglynLifecycleFlag.REGISTERING
      this.getLogger().debug(AglynAppEventFlag.EXTENSION_REGISTERED, {extensionName})
      this.getEmitter().emit(AglynAppEventFlag.EXTENSION_REGISTERED, {extensionName})
      this.extensions.set(extensionName, extension)
      extension.lifecycle = AglynLifecycleFlag.REGISTERED
      this.getLogger().debug(AglynAppEventFlag.EXTENSION_REGISTERED, {extensionName})
      this.getEmitter().emit(AglynAppEventFlag.EXTENSION_REGISTERED, {extensionName})
    }
    else {
      // TODO: throw errorFactory error
    }
  }
  public initializeExtension(payload: ExtensionInitializePayload): void {
    const {extension} = payload
    const extensionName = extension?.extensionName
    if (extensionName && isAglynExtension(extension)) {
      extension.lifecycle = AglynLifecycleFlag.INITIALIZING
      this.getLogger().debug(AglynAppEventFlag.EXTENSION_INITIALIZING, {extensionName})
      this.getEmitter().emit(AglynAppEventFlag.EXTENSION_INITIALIZING, {extensionName})
      extension.aglynOnInit?.(this.app)
      extension.lifecycle = AglynLifecycleFlag.INITIALIZED
      this.getLogger().debug(AglynAppEventFlag.EXTENSION_INITIALIZED, {extensionName})
      this.getEmitter().emit(AglynAppEventFlag.EXTENSION_INITIALIZED, {extensionName})
    }
    else {
      // TODO: throw errorFactory error
    }
  }
  public loadExtension(payload: ExtensionLoadPayload): void {
    const {extensionName} = payload
    const extension = this.extensions.get(extensionName) as MutableShallow<IAglynExtension>
    const lifecycle = extension.lifecycle
    if (
      extension && (
        lifecycle === AglynLifecycleFlag.INITIALIZED
        || lifecycle === AglynLifecycleFlag.UNLOADED
      )
    ) {
      extension.lifecycle = AglynLifecycleFlag.LOADING
      this.getLogger().debug(AglynAppEventFlag.EXTENSION_LOADING, {extensionName})
      this.getEmitter().emit(AglynAppEventFlag.EXTENSION_LOADING, {extensionName})
      extension.aglynOnLoad?.(this.app)
      extension.lifecycle = AglynLifecycleFlag.LOADED
      this.getLogger().debug(AglynAppEventFlag.EXTENSION_LOADED, {extensionName})
      this.getEmitter().emit(AglynAppEventFlag.EXTENSION_LOADED, {extensionName})
    }
    else {
      // TODO: throw errorFactory error
    }
  }
  public unloadExtension(payload: ExtensionUnloadPayload): void {
    const {extensionName} = payload
    const extension = this.extensions.get(extensionName) as MutableShallow<IAglynExtension>
    if (extension) {
      extension.lifecycle = AglynLifecycleFlag.UNLOADING
      this.getLogger().debug(AglynAppEventFlag.EXTENSION_UNLOADING, {extensionName})
      this.getEmitter().emit(AglynAppEventFlag.EXTENSION_UNLOADING, {extensionName})
      extension.aglynOnUnload?.(this.app)
      extension.lifecycle = AglynLifecycleFlag.UNLOADED
      this.getLogger().debug(AglynAppEventFlag.EXTENSION_UNLOADED, {extensionName})
      this.getEmitter().emit(AglynAppEventFlag.EXTENSION_UNLOADED, {extensionName})
    }
    else {
      // TODO: throw errorFactory error
    }
  }
  public destroyExtension(payload: ExtensionDestroyPayload): void {
    const {extensionName} = payload
    const extension = this.extensions.get(extensionName)
    if (extension) {
      extension.lifecycle = AglynLifecycleFlag.DESTROYING
      this.getLogger().debug(AglynAppEventFlag.EXTENSION_DESTROYING, {extensionName})
      this.getEmitter().emit(AglynAppEventFlag.EXTENSION_DESTROYING, {extensionName})
      extension.aglynOnDestroy?.(this.app)
      this.extensions.delete(extensionName)
      extension.lifecycle = AglynLifecycleFlag.DESTROYED
      this.getLogger().debug(AglynAppEventFlag.EXTENSION_DESTROYED, {extensionName})
      this.getEmitter().emit(AglynAppEventFlag.EXTENSION_DESTROYED, {extensionName})
    }
    else {
      // TODO: throw errorFactory error
    }
  }
  public unloadAllExtensions(): void {
    this.extensions.forEach((extension, extensionName) => {
      if (extension.lifecycle === AglynLifecycleFlag.LOADED) {
        this.unloadExtension({extensionName})
      }
    })
  }
  public destroyAllExtensions(): void {
    this.extensions.forEach((extension, extensionName) => {
      if (extension.lifecycle !== AglynLifecycleFlag.UNREGISTERED) {
        this.destroyExtension({extensionName})
      }
    })
  }


  protected listeners: AglynModuleEffectListener<any>[] = [
    [AglynAppEffectFlag.EXTENSION_REGISTER, this.registerExtension],
    [AglynAppEffectFlag.EXTENSION_INITIALIZE, this.initializeExtension],
    [AglynAppEffectFlag.EXTENSION_LOAD, this.loadExtension],
    [AglynAppEffectFlag.EXTENSION_UNLOAD, this.unloadExtension],
    [AglynAppEffectFlag.EXTENSION_DESTROY, this.destroyExtension],
  ]
}

export default AglynExtensionsController
