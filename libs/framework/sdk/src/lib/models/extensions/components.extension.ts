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

import { _isArr, _isUndOrNull } from '@aglyn/shared/util/guards'
import { getStaticField } from '@aglyn/shared/util/tools'
import { AglynAppInstance } from '../../types'
import { AglynExtensionModel } from '../aglyn-extension.model'
import {
  AglynComponent,
  AglynComponentEventFlag,
  AglynComponentsExtension,
  ComponentId,
  ComponentsRegistry,
  ComponentsRegistryEntries,
  ComponentsRegistryKeys,
  ComponentsRegistryValues,
  GetComponentPayload,
  PluginComponentIdString,
  PluginComponentIdTuple,
  PluginId,
  RegisterComponentPayload,
  RegisterPluginPayload,
  SelfComponentId,
  UnregisterComponentPayload,
  UnregisterPluginPayload,
} from './components-types.extension'


const TAG = 'AglynComponentsExtensionModel'

export default class AglynComponentsExtensionModel extends AglynExtensionModel<ComponentsRegistry> implements AglynComponentsExtension {
//start: overrides
  public static readonly $id: string = 'components'
  public static readonly [Symbol.toStringTag]: string = TAG
  protected context: ComponentsRegistry = {
    plugins: new Map(),
    components: new Map(),
  }
  public onDestroy = (app: AglynAppInstance): this => {
    this.listeners.forEach(([flag, method]) => app.getEmitter().off(flag, method))
    return this
  }
  public onInit = (app: AglynAppInstance): this => {
    this.listeners.forEach(([flag, method]) => app.getEmitter().on(flag, method))
    return this
  }
  public toJSON = () => {
    return {
      ...super.toJSON(),
      componentIds: this.context?.components?.keys(),
    }
  }
//end: overrides
//start: not private (readonly)
  /**
   * Match any text possibly following a plugin ID
   * TRUE:
   *  `aa:bb::cc:dd` -> match = "cc:dd"
   *  `aa::cc:dd` -> match = "cc:dd"
   *  `aa::cc` -> match = "cc"
   *  `cc` -> match = "cc"
   *
   * FALSE:
   *  `aa:bb::cc::dd`
   *  `::cc:dd`
   *  `::cc`
   *  `aa::`
   *
   * @type {RegExp}
   */
  public static readonly componentIdMatcher = /^(?:(?:(?:[^:]+:)+)?[^:]+)(?::{2})?((?:(?:[^:]+:)+)?[^:]+)$/g
  /**
   * Match any text always prefixing a plugin ID
   * TRUE:
   *  `aa:bb::cc:dd` -> match = "aa:bb"
   *  `aa::cc:dd` -> match = "aa"
   *  `aa::cc` -> match = "aa"
   *
   * FALSE:
   *  `aa:bb::cc::dd`
   *  `::cc:dd`
   *  `::cc`
   *  `aa::`
   *
   * @type {RegExp}
   */
  public static readonly pluginIdMatcher = /^((?:(?:[^:]+:)+)?[^:]+)(?::{2})(?:(?:[^:]+:)+)?[^:]+$/g
  public static readonly pluginSeparator = '::'
//end: not private (readonly)
//start: constructor
  constructor(app: AglynAppInstance) {
    super(app, {autoload: true})
  }
//end: constructor
//start: abstract + overridden
  public getAllComponents = (): ComponentsRegistryEntries => {
    return this._componentEntries()
  }
  public getAllComponentsKeys = (): ComponentsRegistryKeys => {
    return this._componentKeys()
  }
  public getAllComponentsValues = (): ComponentsRegistryValues => {
    return this._componentValues()
  }
  public getComponent = (payload: GetComponentPayload): AglynComponent => {
    const {componentId} = payload
    return this.context?.components?.get(this._decodeId(componentId))
  }
  public registerComponent = (payload: RegisterComponentPayload): this => {
    const {component} = payload
    const [pId, cId] = this._getDecodedId(component?.$id)
    if (cId) {
      this.context?.components?.set(this._decodeId([pId, cId]), component)
      this.context?.plugins?.get(pId)?.components?.set(cId, component)
    }
    return this
  }
  public registerComponentsPlugin = (payload: RegisterPluginPayload): this => {
    const {plugin} = payload
    const pId = plugin?.$id
    this.context?.plugins?.set(pId, plugin)
    plugin?.components?.forEach(component => {
      const cId = component?.$id
      this.context?.components?.set(this._decodeId([pId, cId]), component)
    })
    return this
  }
  public unregisterComponent = (payload: UnregisterComponentPayload): this => {
    const {componentId} = payload
    const [pId, cId] = this._getDecodedId(componentId)
    if (cId) {
      this.context?.components?.delete(this._decodeId([pId, cId]))
      this.context?.plugins?.get(pId)?.components?.delete(cId)
    }
    return this
  }
  public unregisterComponentsPlugin = (payload: UnregisterPluginPayload): this => {
    const {pluginId} = payload
    this.context?.plugins.get(pluginId)?.components?.forEach(component => {
      this.context?.components?.delete(this._decodeId([pluginId, component?.$id]))
    })
    this.context?.plugins.delete(pluginId)
    return this
  }
  private listeners: [AglynComponentEventFlag, (...args: unknown[]) => unknown][] = [
    [AglynComponentEventFlag.COMPONENT_REGISTER, this.registerComponent],
    [AglynComponentEventFlag.COMPONENT_UNREGISTER, this.unregisterComponent],
    [AglynComponentEventFlag.COMPONENTS_PLUGIN_REGISTER, this.registerComponentsPlugin],
    [AglynComponentEventFlag.COMPONENTS_PLUGIN_UNREGISTER, this.unregisterComponentsPlugin],
  ]
//end: abstract + overridden
//start: not public
  protected _decodeId = (id: ComponentId): PluginComponentIdString | SelfComponentId => {
    return !_isArr(id) ? id : id.filter(i => {
      return !_isUndOrNull(i)
    }).join(getStaticField('pluginSeparator', this))
  }
  protected _componentEntries = (): ComponentsRegistryEntries => {
    return [...this.context?.components?.entries()]
  }
  protected _componentKeys = (): ComponentId[] => {
    return [...this.context?.components.keys()]
  }
  protected _componentValues = (): AglynComponent[] => {
    return [...this.context?.components?.values()]
  }
  protected _decodeComponentId = (id: ComponentId): SelfComponentId => {
    const _id = this._decodeId(id)
    return (_id.match(getStaticField('componentIdMatcher', this)) ?? []) [0]
  }
  protected _getDecodedId = (id: ComponentId): PluginComponentIdTuple => {
    return [this._decodePluginId(id), this._decodeComponentId(id)]
  }
  protected _decodePluginId = (id: ComponentId): PluginId => {
    const _id = this._decodeId(id)
    return (_id.match(getStaticField('pluginIdMatcher', this)) ?? [])[0]
  }
//end: not public
}
