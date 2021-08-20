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

import { AglynApp } from '../types'
import { AglynModuleTriggerFlag } from '../constants'
import {
  AglynComponent,
  AglynComponentsExtension,
  ComponentsRegistry,
  PayloadParams,
  RegistryEvery,
} from './components-type.extension'
import { AglynExtensionModel } from '../models/aglyn-extension.model'


const extension = new (class extends AglynExtensionModel implements AglynComponentsExtension {
  protected static override __$ID__ = 'components'
  public override context: ComponentsRegistry = new Map()
  constructor() {
    super()
  }
  public entries = (): [id: string, component: AglynComponent][] => {
    return [...this.context.entries()]
  }
  public keys = (): string[] => {
    return [...this.context.keys()]
  }
  public values = (): AglynComponent[] => {
    return [...this.context.values()]
  }
  public getAll = (options?: PayloadParams.GetAll): RegistryEvery<typeof options> => {
    const {variant} = {...options}
    switch (variant) {
      case 'values':
        return this.values()
      case 'keys':
        return this.keys()
    }
    return this.entries()
  }
  public get = (payload: PayloadParams.Get): AglynComponent => {
    const {componentId} = payload
    return this.context.get(componentId)
  }
  public set = (payload: PayloadParams.Set): this => {
    const {component} = payload
    this.context.set(component?.$id, component)
    return this
  }
  public delete = (payload: PayloadParams.Delete): this => {
    const {componentId} = payload
    this.getContext().delete(componentId)
    return this
  }
  onInit(app: AglynApp) {
    app.event.on(
      AglynModuleTriggerFlag.EXTENSION_COMPONENT_REGISTER,
      this.set,
    )
    app.event.on(
      AglynModuleTriggerFlag.EXTENSION_COMPONENT_UNREGISTER,
      this.delete,
    )
  }
  onDestroy(app: AglynApp) {
    app.event.off(
      AglynModuleTriggerFlag.EXTENSION_COMPONENT_REGISTER,
      this.set,
    )
    app.event.off(
      AglynModuleTriggerFlag.EXTENSION_COMPONENT_UNREGISTER,
      this.delete,
    )
  }
  public override toJSON() {
    return {
      ...super.toJSON(),
      componentIds: this.context.keys(),
    }
  }
})()

exports = extension
