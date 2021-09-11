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

import {
  AglynAppEventFlag,
  AglynAppInstance,
  AglynExtensionControllerInstance,
  AglynExtensionInstance,
  AglynExtensionMap,
  AglynModuleEventFlag,
  AglynModuleEventPayload,
} from '@aglyn/framework/sdk'
import { LifecycleFlag, MutableShallow } from '@aglyn/shared/util/types'
import { equalityIsSameType } from '@aglyn/shared/util/guards'
import { getStaticField } from '@aglyn/shared/util/tools'
import { AglynBaseModel } from '../models/aglyn-base.model'


const TAG = 'AglynExtensionController'

export class AglynExtensionController extends AglynBaseModel implements AglynExtensionControllerInstance {

  public static readonly [Symbol.toStringTag]: string = TAG
  protected app: AglynAppInstance
  protected extensions: AglynExtensionMap = new Map()
  public get [Symbol.toStringTag](): string {return getStaticField(Symbol.toStringTag, this)}
  constructor(props: { app: AglynAppInstance }) {
    super()
    const {app} = props
    this.app = app
    this.#initialize()
  }
  #initialize() {
    this.setErrorFactory(this.app.getErrorFactory())
    this.setEmitter(this.app.getEmitter())
    this.setLogger(this.app.getLogger())
  }
  public getExtensionByName = (id: string): AglynExtensionInstance => {
    const extension = this.extensions.get(id)
    const current = extension?.lifecycle
    const autoload = extension?.getOptions?.()?.autoload
    if (current === LifecycleFlag.INITIALIZED && autoload) {
      this.loadExtension({name: id})
    }
    return extension
  }
  public getAllExtensions = (): AglynExtensionInstance[] => {
    return [...this.extensions.values()]
  }
  public registerExtension = (
    data: AglynModuleEventPayload[AglynModuleEventFlag.EXTENSION_REGISTER],
  ): void => {
    const extension = data.extension as MutableShallow<AglynExtensionInstance>
    const name = extension.getName()
    this.extensions.set(name, extension)
    extension.lifecycle = LifecycleFlag.INITIALIZED
    this.getLogger().debug(AglynAppEventFlag.REGISTERED_EXTENSION, {name})
    this.getEmitter().emit(AglynAppEventFlag.REGISTERED_EXTENSION, {extension})
  }
  public unregisterExtension = (
    data: AglynModuleEventPayload[AglynModuleEventFlag.EXTENSION_UNREGISTER],
  ): void => {
    const {name} = data
    const extension = this.extensions.get(name) as MutableShallow<AglynExtensionInstance>
    if (extension) {
      const isLoaded = equalityIsSameType(
        extension.lifecycle,
        LifecycleFlag.INITIALIZED,
        LifecycleFlag.LOADING,
        LifecycleFlag.LOADED,
      )
      if (isLoaded) {
        this.unloadExtension({name})
      }
      this.extensions.delete(name)
      extension.lifecycle = LifecycleFlag.DESTROYED
      this.getLogger().debug(AglynAppEventFlag.UNREGISTERED_EXTENSION, {name})
      this.getEmitter().emit(AglynAppEventFlag.UNREGISTERED_EXTENSION, {name})
    }
  }
  public loadExtension = (
    data: AglynModuleEventPayload[AglynModuleEventFlag.EXTENSION_LOAD],
  ): void => {
    const {name} = data
    const extension = this.extensions.get(name) as MutableShallow<AglynExtensionInstance>
    if (extension) {
      extension.lifecycle = LifecycleFlag.LOADING
      extension.onInit?.(this.app)
      extension.lifecycle = LifecycleFlag.LOADED
      this.getLogger().debug(AglynAppEventFlag.LOADED_EXTENSION, {name})
      this.getEmitter().emit(AglynAppEventFlag.LOADED_EXTENSION, {name})
    }
  }
  public unloadExtension = (
    data: AglynModuleEventPayload[AglynModuleEventFlag.EXTENSION_UNLOAD],
  ): void => {
    const {name} = data
    const extension = this.extensions.get(name) as MutableShallow<AglynExtensionInstance>
    if (extension) {
      extension.onDestroy?.(this.app)
      extension.lifecycle = LifecycleFlag.UNLOADED
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
  public onInit = (): void => {
    this.getEmitter().on(AglynModuleEventFlag.EXTENSION_REGISTER, this.registerExtension)
    this.getEmitter().on(AglynModuleEventFlag.EXTENSION_UNREGISTER, this.unregisterExtension)
    this.getEmitter().on(AglynModuleEventFlag.EXTENSION_LOAD, this.loadExtension)
    this.getEmitter().on(AglynModuleEventFlag.EXTENSION_UNLOAD, this.unloadExtension)
  }
  public onDestroy = (): void => {
    this.getEmitter().off(AglynModuleEventFlag.EXTENSION_REGISTER, this.registerExtension)
    this.getEmitter().off(AglynModuleEventFlag.EXTENSION_UNREGISTER, this.unregisterExtension)
    this.getEmitter().off(AglynModuleEventFlag.EXTENSION_LOAD, this.loadExtension)
    this.getEmitter().off(AglynModuleEventFlag.EXTENSION_UNLOAD, this.unloadExtension)
  }

}
