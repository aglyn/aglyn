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

import { MutableShallow } from '@aglyn/shared-data-types'
import { _isEqualitySameType } from '@aglyn/shared-util-guards'
import { getStaticField } from '@aglyn/shared-util-tools'
import {
  AglynAppEffectFlag,
  AglynAppEventFlag,
  ExtensionDestroyPayload,
  ExtensionLoadPayload,
  ExtensionRegisterPayload,
  ExtensionUnloadPayload,
} from '../constants/emitter'
import { AglynLifecycleFlag } from '../constants/enums'
import { EXTENSION_TYPE, MODULE_TYPE } from '../constants/symbol'
import type { AglynExtension } from '../models/aglyn-extension.model'
import { AglynExtensionT } from '../models/aglyn-extension.model'
import { AglynModuleEffectListener, AglynModuleModel } from '../models/aglyn-module.model'
import { AglynExtensionMap, AglynTypeFields } from '../types'
import { isAglynExtension } from '../util/aglyn-is'
import { ExtensionUUN } from './aglyn-components.controller'


export type AglynExtensionTypeFields = AglynTypeFields<typeof MODULE_TYPE, typeof EXTENSION_TYPE>
export type AglynExtensionLoader = () => Promise<AglynExtensionT>

export interface AglynExtensionsController extends AglynModuleModel {
  registerExtension(payload: ExtensionRegisterPayload): void
  loadExtension(payload: ExtensionLoadPayload): void
  unloadExtension(payload: ExtensionUnloadPayload): void
  destroyExtension(payload: ExtensionDestroyPayload): void
  getExtensionByName(name: string): AglynExtension
  getAllExtensions(): AglynExtension[]
  unloadAllExtensions(): void
  destroyAllExtensions(): void
}

const TAG = 'AglynExtensions'

export class AglynExtensionsController extends AglynModuleModel {

  public static readonly [Symbol.toStringTag]: string = TAG

  public readonly moduleName: string = TAG

  protected extensions: AglynExtensionMap = new Map()

  public get [Symbol.toStringTag](): string {
    return getStaticField(Symbol.toStringTag, this)
  }

  constructor(options) {super(options)}

  public toString(): string {
    return `${TAG}(appName: '${this.app.getName()}')`
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
  public getExtensionByName = (extensionName: ExtensionUUN): AglynExtension => {
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
  public getAllExtensions = (): AglynExtension[] => {
    return [...this.extensions.values()]
  }

  public registerExtension = (payload: ExtensionRegisterPayload): void => {
    const {extension} = payload
    if (isAglynExtension(extension) && extension.extensionName) {
      const extensionName = extension.extensionName
      this.extensions.set(extensionName, extension as AglynExtension)
      extension.lifecycle = AglynLifecycleFlag.REGISTERED
      this.getLogger().debug(AglynAppEventFlag.EXTENSION_REGISTERED, {extensionName})
      this.getEmitter().emit(AglynAppEventFlag.EXTENSION_REGISTERED, {extensionName})
      extension.aglynOnInit?.(this.app)
      extension.lifecycle = AglynLifecycleFlag.INITIALIZED
      this.getLogger().debug(AglynAppEventFlag.EXTENSION_INITIALIZED, {extensionName})
      this.getEmitter().emit(AglynAppEventFlag.EXTENSION_INITIALIZED, {extensionName})
    }
    else {
      // TODO: throw errorFactory error
    }
  }
  public loadExtension = (payload: ExtensionLoadPayload): void => {
    const {extensionName} = payload
    const extension = this.extensions.get(extensionName) as MutableShallow<AglynExtension>
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
  public unloadExtension = (payload: ExtensionUnloadPayload): void => {
    const {extensionName} = payload
    const extension = this.extensions.get(extensionName) as MutableShallow<AglynExtension>
    if (extension) {
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
  public destroyExtension = (payload: ExtensionDestroyPayload): void => {
    const {extensionName} = payload
    const extension = this.extensions.get(extensionName)
    if (extension) {
      const isLoaded = _isEqualitySameType(
        extension.lifecycle,
        AglynLifecycleFlag.INITIALIZED,
        AglynLifecycleFlag.LOADING,
        AglynLifecycleFlag.LOADED,
      )
      if (isLoaded) {
        this.unloadExtension({extensionName})
      }
      this.getLogger().debug(AglynAppEventFlag.EXTENSION_DESTROYING, {extensionName})
      this.getEmitter().emit(AglynAppEventFlag.EXTENSION_DESTROYING, {extensionName})
      extension.aglynOnDestroy?.(this.app)
      extension.lifecycle = AglynLifecycleFlag.DESTROYED
      this.extensions.delete(extensionName)
      this.getLogger().debug(AglynAppEventFlag.EXTENSION_DESTROYED, {extensionName})
      this.getEmitter().emit(AglynAppEventFlag.EXTENSION_DESTROYED, {extensionName})
    }
    else {
      // TODO: throw errorFactory error
    }
  }
  public unloadAllExtensions = (): void => {
    this.extensions.forEach((extension, extensionName) => {
      if (extension.lifecycle === AglynLifecycleFlag.LOADED) {
        this.unloadExtension({extensionName})
      }
    })
  }
  public destroyAllExtensions = (): void => {
    this.extensions.forEach((_, extensionName) => {
      this.unloadExtension({extensionName})
    })
  }


  protected listeners: AglynModuleEffectListener<any>[] = [
    [AglynAppEffectFlag.EXTENSION_REGISTER, this.registerExtension],
    [AglynAppEffectFlag.EXTENSION_LOAD, this.loadExtension],
    [AglynAppEffectFlag.EXTENSION_UNLOAD, this.unloadExtension],
    [AglynAppEffectFlag.EXTENSION_DESTROY, this.destroyExtension],
  ]
}

export type AglynExtensionsControllerT = typeof AglynExtensionsController
export default AglynExtensionsController
