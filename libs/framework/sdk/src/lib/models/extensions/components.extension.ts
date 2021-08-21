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

import { AglynAppInstance } from '../../types'
import { AglynModuleTriggerFlag } from '../../constants'
import {
  AglynComponent,
  AglynComponentsExtension,
  ComponentsRegistry,
  PayloadParams,
  RegistryEntries, RegistryKeys, RegistryValues,
} from './components-types.extension'
import { AglynExtensionModel } from '../aglyn-extension.model'


const TAG = 'AglynComponentsExtensionModel'

export default class AglynComponentsExtensionModel extends AglynExtensionModel<ComponentsRegistry> implements AglynComponentsExtension {
  public static readonly [Symbol.toStringTag]: string = TAG
  public static readonly $id: string = 'components'
  protected context: ComponentsRegistry = new Map()
  constructor(app: AglynAppInstance) {
    super(app, {autoload: true})
  }
  public onInit = (app: AglynAppInstance): this => {
    app.getEmitter().on(
      AglynModuleTriggerFlag.EXTENSION_COMPONENT_REGISTER,
      this.registerComponent,
    )
    app.getEmitter().on(
      AglynModuleTriggerFlag.EXTENSION_COMPONENT_UNREGISTER,
      this.deleteComponent,
    )
    return this
  }
  public onDestroy = (app: AglynAppInstance): this => {
    app.getEmitter().off(
      AglynModuleTriggerFlag.EXTENSION_COMPONENT_REGISTER,
      this.registerComponent,
    )
    app.getEmitter().off(
      AglynModuleTriggerFlag.EXTENSION_COMPONENT_UNREGISTER,
      this.deleteComponent,
    )
    return this
  }
  public toJSON = () => {
    return {
      ...super.toJSON(),
      componentIds: this.context.keys(),
    }
  }
  public _componentEntries = (): RegistryEntries => {
    return [...this.context.entries()]
  }
  public _componentKeys = (): string[] => {
    return [...this.context.keys()]
  }
  public _componentValues = (): AglynComponent[] => {
    return [...this.context.values()]
  }
  public getAllComponentsValues = (): RegistryValues => {
    return this._componentValues()
  }
  public getAllComponentsKeys = (): RegistryKeys => {
    return this._componentKeys()
  }
  public getAllComponents = (): RegistryEntries => {
    return this._componentEntries()
  }
  public getComponent = (payload: PayloadParams.Get): AglynComponent => {
    const {componentId} = payload
    return this.context.get(componentId)
  }
  public registerComponent = (payload: PayloadParams.Register): this => {
    const {component} = payload
    this.context.set(component?.$id, component)
    return this
  }
  public deleteComponent = (payload: PayloadParams.Delete): this => {
    const {componentId} = payload
    this.getContext().delete(componentId)
    return this
  }
}
