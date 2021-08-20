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
  AglynApp,
  AglynAppEventFlag,
  AglynEmitter,
  AglynExtension,
  AglynExtensionController,
  AglynExtensionMap,
  AglynLogger,
  AglynModuleTriggerFlag,
  AglynModuleTriggerParams,
} from '@aglyn/framework/sdk'
import { LifecycleFlag, Mutable } from '@aglyn/shared/util/types'
import { EqualityIs } from '@aglyn/shared/util/guards'


const TAG = 'AglynExtensionController'

export class AglynAppExtensionController implements AglynExtensionController {

  protected app: AglynApp
  protected event: AglynEmitter
  protected logger: AglynLogger
  protected extensions: AglynExtensionMap = new Map()

  constructor(props: {
    app: AglynApp
  }) {
    const {app} = props
    this.app = app
    this.event = app.event
    this.logger = app.log
  }

  getExtension = (id: string): AglynExtension => {
    const extension = this.extensions.get(id)
    const current = extension?.lifecycle
    const autoload = extension?.config?.autoload
    if (current === LifecycleFlag.INITIALIZED && autoload) {
      this.loadExtension({extensionId: id})
    }
    return extension
  }
  getExtensions = (): AglynExtension[] => {
    return [...this.extensions.values()]
  }
  registerExtension = (
    data: AglynModuleTriggerParams[AglynModuleTriggerFlag.EXTENSION_REGISTER],
  ): void => {
    const extension = data.extension as Mutable<AglynExtension>
    const extensionId = extension.$id
    this.extensions.set(extensionId, extension)
    extension.lifecycle = LifecycleFlag.INITIALIZED
    this.logger.debug(AglynAppEventFlag.REGISTERED_EXTENSION, {extensionId})
    this.event.emit(AglynAppEventFlag.REGISTERED_EXTENSION, {extension})
  }
  unregisterExtension = (
    data: AglynModuleTriggerParams[AglynModuleTriggerFlag.EXTENSION_UNREGISTER],
  ) => {
    const {extensionId} = data
    const extension = this.extensions.get(extensionId) as Mutable<AglynExtension>
    if (extension) {
      const isLoaded = EqualityIs.sameType(
        extension.lifecycle,
        LifecycleFlag.INITIALIZED,
        LifecycleFlag.LOADING,
        LifecycleFlag.LOADED,
      )
      if (isLoaded) {
        this.unloadExtension({extensionId})
      }
      this.extensions.delete(extensionId)
      extension.lifecycle = LifecycleFlag.DESTROYED
      this.logger.debug(AglynAppEventFlag.UNREGISTERED_EXTENSION, {extensionId})
      this.event.emit(AglynAppEventFlag.UNREGISTERED_EXTENSION, {extensionId})
    }
  }
  loadExtension = (
    data: AglynModuleTriggerParams[AglynModuleTriggerFlag.EXTENSION_LOAD],
  ): void => {
    const {extensionId} = data
    const extension = this.extensions.get(extensionId) as Mutable<AglynExtension>
    if (extension) {
      extension.lifecycle = LifecycleFlag.LOADING
      extension.onInit?.(this.app)
      extension.lifecycle = LifecycleFlag.LOADED
      this.logger.debug(AglynAppEventFlag.LOADED_EXTENSION, {extensionId})
      this.event.emit(AglynAppEventFlag.LOADED_EXTENSION, {extensionId})
    }
  }
  unloadExtension = (
    data: AglynModuleTriggerParams[AglynModuleTriggerFlag.EXTENSION_UNLOAD],
  ): void => {
    const {extensionId} = data
    const extension = this.extensions.get(extensionId) as Mutable<AglynExtension>
    if (extension) {
      extension.onDestroy?.(this.app)
      extension.lifecycle = LifecycleFlag.UNLOADED
      this.logger.debug(AglynAppEventFlag.UNLOADED_EXTENSION, {extensionId})
      this.event.emit(AglynAppEventFlag.UNLOADED_EXTENSION, {extensionId})
    }
  }
  unloadExtensions = (): void => {
    this.extensions.forEach((_, extensionId) => {
      this.unloadExtension({extensionId})
    })
  }
  get [Symbol.toStringTag as any]() {
    return `${TAG}`
  }
  toString = () => {
    return `${TAG}(appName: '${this.app.getName()}')`
  }
  toJSON = () => {
    return {
      extensions: this.extensions.keys(),
    }
  }
  onInit = () => {
    this.event.on(AglynModuleTriggerFlag.EXTENSION_REGISTER, this.registerExtension)
    this.event.on(AglynModuleTriggerFlag.EXTENSION_UNREGISTER, this.unregisterExtension)
    this.event.on(AglynModuleTriggerFlag.EXTENSION_LOAD, this.loadExtension)
    this.event.on(AglynModuleTriggerFlag.EXTENSION_UNLOAD, this.unloadExtension)
  }
  onDestroy = () => {
    this.event.off(AglynModuleTriggerFlag.EXTENSION_REGISTER, this.registerExtension)
    this.event.off(AglynModuleTriggerFlag.EXTENSION_UNREGISTER, this.unregisterExtension)
    this.event.off(AglynModuleTriggerFlag.EXTENSION_LOAD, this.loadExtension)
    this.event.off(AglynModuleTriggerFlag.EXTENSION_UNLOAD, this.unloadExtension)
  }

}
