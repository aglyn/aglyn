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
  AglynAppEventFlag,
  AglynModuleActionFlag,
  AglynModuleActionPayload,
} from '../constants/emitter'
import { EXTENSION_TYPE, MODULE_TYPE } from '../constants/symbol'
import type { AglynAppController } from '../controllers/aglyn-app.controller'
import { AglynBaseModel } from '../models/aglyn-base.model'
import type { AglynExtension } from '../models/aglyn-extension.model'
import { AglynExtensionT } from '../models/aglyn-extension.model'
import {
  AglynAppModule,
  AglynExtensionMap,
  AglynLifecycleFlag,
  AglynLoads,
  AglynRegisters,
  AglynTypeFields,
} from '../types'


const TAG = 'AglynExtensionController'

export type AglynExtensionTypeFields = AglynTypeFields<typeof MODULE_TYPE, typeof EXTENSION_TYPE>
export type AglynExtensionLoader = () => Promise<AglynExtensionT>

export interface AglynExtensionController
  extends AglynBaseModel,
    AglynRegisters<'extension',
      AglynModuleActionPayload[AglynModuleActionFlag.EXTENSION_REGISTER],
      AglynModuleActionPayload[AglynModuleActionFlag.EXTENSION_UNREGISTER]>,
    AglynLoads<'extension', AglynAppModule> {
  getExtensionByName(name: string): AglynExtension
  getAllExtensions(): AglynExtension[]
  unloadAllExtensions(): void
}

export class AglynExtensionController extends AglynBaseModel {
  public static readonly [Symbol.toStringTag]: string = TAG
  protected app: AglynAppController
  protected extensions: AglynExtensionMap = new Map()
  public get [Symbol.toStringTag](): string {
    return getStaticField(Symbol.toStringTag, this)
  }
  constructor(props: { app: AglynAppController }) {
    super()
    const {app} = props
    this.app = app
    this.#setup()
  }
  #setup() {
    this.setErrorFactory(this.app.getErrorFactory())
    this.setEmitter(this.app.getEmitter())
    this.setLogger(this.app.getLogger())
  }
  public getExtensionByName = (id: string): AglynExtension => {
    const extension = this.extensions.get(id)
    const current = extension?.lifecycle
    const autoload = extension?.getOptions?.()?.autoload
    if (current === AglynLifecycleFlag.INITIALIZED && autoload) {
      this.loadExtension({name: id})
    }
    return extension
  }
  public getAllExtensions = (): AglynExtension[] => {
    return [...this.extensions.values()]
  }
  public registerExtension = (
    data: AglynModuleActionPayload[AglynModuleActionFlag.EXTENSION_REGISTER],
  ): void => {
    const extension = data.extension as MutableShallow<AglynExtension>
    const name = extension.getName()
    this.extensions.set(name, extension as AglynExtension)
    extension.lifecycle = AglynLifecycleFlag.REGISTERED
    extension.aglynOnInit?.(this.app)
    extension.lifecycle = AglynLifecycleFlag.INITIALIZED
    this.getLogger().debug(AglynAppEventFlag.REGISTERED_EXTENSION, {name})
    this.getEmitter().emit(AglynAppEventFlag.REGISTERED_EXTENSION, {name})
  }
  public unregisterExtension = (
    data: AglynModuleActionPayload[AglynModuleActionFlag.EXTENSION_UNREGISTER],
  ): void => {
    const {name} = data
    const extension = this.extensions.get(name) as MutableShallow<AglynExtension>
    if (extension) {
      const isLoaded = _isEqualitySameType(
        extension.lifecycle,
        AglynLifecycleFlag.INITIALIZED,
        AglynLifecycleFlag.LOADING,
        AglynLifecycleFlag.LOADED,
      )
      if (isLoaded) {
        this.unloadExtension({name})
      }
      extension.aglynOnDestroy?.(this.app)
      this.extensions.delete(name)
      extension.lifecycle = AglynLifecycleFlag.DESTROYED
      this.getLogger().debug(AglynAppEventFlag.UNREGISTERED_EXTENSION, {name})
      this.getEmitter().emit(AglynAppEventFlag.UNREGISTERED_EXTENSION, {name})
    }
  }
  public loadExtension = (
    data: AglynModuleActionPayload[AglynModuleActionFlag.EXTENSION_LOAD],
  ): void => {
    const {name} = data
    const extension = this.extensions.get(name) as MutableShallow<AglynExtension>
    if (extension) {
      extension.lifecycle = AglynLifecycleFlag.LOADING
      extension.aglynOnLoad?.(this.app)
      extension.lifecycle = AglynLifecycleFlag.LOADED
      this.getLogger().debug(AglynAppEventFlag.LOADED_EXTENSION, {name})
      this.getEmitter().emit(AglynAppEventFlag.LOADED_EXTENSION, {name})
    }
  }
  public unloadExtension = (
    data: AglynModuleActionPayload[AglynModuleActionFlag.EXTENSION_UNLOAD],
  ): void => {
    const {name} = data
    const extension = this.extensions.get(name) as MutableShallow<AglynExtension>
    if (extension) {
      extension.aglynOnUnload?.(this.app)
      extension.lifecycle = AglynLifecycleFlag.UNLOADED
      this.getLogger().debug(AglynAppEventFlag.UNLOADED_EXTENSION, {name})
      this.getEmitter().emit(AglynAppEventFlag.UNLOADED_EXTENSION, {name})
    }
  }
  public unloadAllExtensions = (): void => {
    this.extensions.forEach((_, name) => {
      this.unloadExtension({name})
    })
  }
  public toString = (): string => {
    return `${TAG}(appName: '${this.app.getName()}')`
  }
  public toJSON = () => {
    return {
      ...super.toJSON(),
      extensions: this.extensions.keys(),
    }
  }
  public aglynOnInit = (): void => {
    this.getEmitter().on(AglynModuleActionFlag.EXTENSION_REGISTER, this.registerExtension)
    this.getEmitter().on(AglynModuleActionFlag.EXTENSION_UNREGISTER, this.unregisterExtension)
    this.getEmitter().on(AglynModuleActionFlag.EXTENSION_LOAD, this.loadExtension)
    this.getEmitter().on(AglynModuleActionFlag.EXTENSION_UNLOAD, this.unloadExtension)
  }
  public aglynOnDestroy = (): void => {
    this.getEmitter().off(AglynModuleActionFlag.EXTENSION_REGISTER, this.registerExtension)
    this.getEmitter().off(AglynModuleActionFlag.EXTENSION_UNREGISTER, this.unregisterExtension)
    this.getEmitter().off(AglynModuleActionFlag.EXTENSION_LOAD, this.loadExtension)
    this.getEmitter().off(AglynModuleActionFlag.EXTENSION_UNLOAD, this.unloadExtension)
  }
}
