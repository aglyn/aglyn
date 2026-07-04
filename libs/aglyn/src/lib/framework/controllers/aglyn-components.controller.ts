/**
 * @license
 * Copyright 2023 Aglyn LLC
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
  AglynBundleSchema,
  AglynComponentSchema,
  AglynComponentsControllerOptions,
  AglynExoticComponent,
  AglynModuleEffectListener,
  AglynNodePresetSchema,
  BundleId,
  ComponentGetPayload,
  ComponentId,
  ComponentRegisterPayload,
  ComponentsBundleGetPayload,
  ComponentsBundleRegisterPayload,
  ComponentsBundleUnregisterPayload,
  ComponentsRegistryContext,
  ComponentsRegistryEntry,
  ComponentsRegistryKeys,
  ComponentsRegistryValues,
  ComponentUnregisterPayload,
  IAglynAppController,
  IAglynComponentsController,
  InstanceBundles,
  InstanceComponents,
  InstanceNodePresets,
  InstanceSchemas,
} from '../../foundation'
import {
  AglynEventStateFlag,
  AglynEventTriggerFlag,
} from '../../foundation'
import { isAglynComponentElement } from '../../app-utils'
// eslint-disable-next-line @nx/enforce-module-boundaries
import { _isArr } from '@aglyn/shared-util-tools'
import { AglynModuleModel } from '../models/aglyn-module.model'

const TAG = 'AglynComponents'
const NS = 'com.aglyn.core.data.controller.components'

export class AglynComponentsController
  extends AglynModuleModel<AglynComponentsControllerOptions>
  implements IAglynComponentsController
{
  public static get [Symbol.toStringTag](): string {
    return TAG
  }
  public static get namespace(): string {
    return NS
  }

  _context: ComponentsRegistryContext = {
    bundles: new Map(),
    components: new Map(),
    schemas: new Map(),
    presets: new Map(),
  }

  public get bundles(): InstanceBundles {
    return this._context.bundles
  }
  public get components(): InstanceComponents {
    return this._context.components
  }
  public get schemas(): InstanceSchemas {
    return this._context.schemas
  }
  public get presets(): InstanceNodePresets {
    return this._context.presets
  }

  protected get listeners(): AglynModuleEffectListener<any>[] {
    return [
      [AglynEventTriggerFlag.COMPONENT_GET, this.getComponent],
      [AglynEventTriggerFlag.COMPONENT_SCHEMA_GET, this.getComponentSchema],
      [AglynEventTriggerFlag.COMPONENTS_GET, this.getAllComponents],
      [AglynEventTriggerFlag.COMPONENTS_BUNDLE_GET, this.getBundle],
      [AglynEventTriggerFlag.COMPONENT_REGISTER, this.registerComponent],
      [AglynEventTriggerFlag.COMPONENT_UNREGISTER, this.unregisterComponent],
      [AglynEventTriggerFlag.COMPONENTS_BUNDLE_REGISTER, this.registerBundle],
      [
        AglynEventTriggerFlag.COMPONENTS_BUNDLE_UNREGISTER,
        this.unregisterBundle,
      ],
    ]
  }

  constructor(
    app: IAglynAppController,
    options: AglynComponentsControllerOptions,
  ) {
    super(app, options)
  }

  public toJSON() {
    return {
      ...super.toJSON(),
      componentIds: this.components?.keys() as any,
      plugins: this.bundles as any,
      schemas: this.schemas as any,
    }
  }

  protected _componentEntries(): ComponentsRegistryEntry[] {
    return [...this.components.entries()]
  }
  protected _componentKeys(): ComponentsRegistryKeys {
    return [...this.components.keys()]
  }
  protected _componentValues(): ComponentsRegistryValues {
    return [...this.components.values()]
  }
  protected _presetValues(): AglynNodePresetSchema[] {
    return [...this.presets.values()]
  }

  public getAllComponents(): ComponentsRegistryEntry[] {
    return this._componentEntries()
  }
  public getAllComponentsKeys(): ComponentsRegistryKeys {
    return this._componentKeys()
  }
  public getAllComponentsValues(): ComponentsRegistryValues {
    return this._componentValues()
  }
  public getAllNodePresetsValues(): AglynNodePresetSchema[] {
    return this._presetValues()
  }

  public getComponent<P, T>(
    payload: ComponentGetPayload,
  ): OrUndef<AglynExoticComponent<P, T>> {
    const { componentId, pluginId = undefined } = payload
    const key = this.buildMapKey({ pluginId, componentId })
    if (pluginId) {
      return this.components?.get(key) as unknown as OrUndef<
        AglynExoticComponent<P, T>
      >
    }
    return this.components?.get(key) as unknown as OrUndef<
      AglynExoticComponent<P, T>
    >
  }
  public getComponentSchema(
    payload: ComponentGetPayload,
  ): OrUndef<AglynComponentSchema> {
    const { componentId, pluginId } = payload
    const key = this.buildMapKey({ pluginId, componentId })
    if (pluginId) {
      return this.schemas?.get(key)
    }
    return this.schemas?.get(key)
  }
  public getBundle(
    payload: ComponentsBundleGetPayload,
  ): OrUndef<AglynBundleSchema> {
    const { pluginId } = payload
    return this.bundles.get(pluginId)
  }
  public buildMapKey(data: {
    componentId: ComponentId
    pluginId: BundleId
  }): string {
    const { componentId, pluginId } = data
    return pluginId ? `${pluginId}:${componentId}` : componentId
  }

  public registerComponent(payload: ComponentRegisterPayload): this {
    const { component, schema } = payload
    const componentId = schema.$id
    const pluginId = schema.pluginId || undefined
    const key = this.buildMapKey({ pluginId, componentId })

    if (!isAglynComponentElement(component)) {
      // TODO: throw errorFactory error
      throw new Error(`Invalid component provided #'${key}'`)
    }
    this.handleEvent(
      [
        AglynEventStateFlag.COMPONENT_REGISTERING,
        AglynEventStateFlag.COMPONENT_REGISTERED,
      ],
      { componentId, pluginId },
      () => {
        if (pluginId) {
          const bundle = this.bundles.get(pluginId)
          if (bundle) {
            this.components.set(key, component)
            this.schemas.set(key, schema)
            bundle.componentIds.push(componentId)
          } else {
            // TODO: throw errorFactory error
            throw new Error(`Bundle does not exists: (${pluginId})`)
          }
        } else {
          this.components.set(componentId, component)
          this.schemas.set(componentId, schema)
        }
        if (_isArr(schema.presets)) {
          schema.presets.forEach((i) => {
            this.presets.set(i.$id, i)
          })
        }
      },
    )
    return this
  }
  public registerBundle(payload: ComponentsBundleRegisterPayload): this {
    const { bundle, components } = payload
    const _bundle: AglynBundleSchema = { ...bundle, componentIds: [] }
    const pluginId: BundleId = _bundle.pluginId
    this.handleEvent(
      [
        AglynEventStateFlag.COMPONENT_BUNDLE_REGISTERING,
        AglynEventStateFlag.COMPONENT_BUNDLE_REGISTERED,
      ],
      { pluginId },
      () => {
        this.bundles.set(pluginId, _bundle)
        ;[...components].forEach(({ schema, component }) => {
          schema.pluginId = pluginId
          this.registerComponent({ schema, component })
        })
      },
    )
    return this
  }

  public unregisterComponent(payload: ComponentUnregisterPayload): this {
    const { componentId, pluginId = undefined } = payload
    const key = this.buildMapKey({ pluginId, componentId })
    this.handleEvent(
      [
        AglynEventStateFlag.COMPONENT_UNREGISTERING,
        AglynEventStateFlag.COMPONENT_UNREGISTERED,
      ],
      { pluginId, componentId },
      () => {
        if (pluginId) {
          const bundle = this.bundles.get(pluginId)
          if (!bundle) {
            throw new Error(`No bundle exists with ID ${pluginId}.`)
            // TODO: throw errorFactory error
          }
          this.schemas.get(key)?.presets?.forEach((i) => {
            this.presets.delete(i.$id)
          })
          this.components.delete(key)
          this.schemas.delete(key)
          bundle.componentIds = bundle.componentIds.filter(
            (i) => i !== componentId,
          )
          this.bundles.set(pluginId, bundle)
        } else {
          this.schemas.get(componentId)?.presets?.forEach((i) => {
            this.presets.delete(i.$id)
          })
          this.schemas.delete(componentId)
          this.components.delete(componentId)
        }
      },
    )
    return this
  }
  public unregisterBundle(payload: ComponentsBundleUnregisterPayload): this {
    const { pluginId } = payload
    const bundle = this.bundles.get(pluginId)
    if (!bundle) {
      throw new Error(`No bundle exists with ID ${pluginId}.`)
      // TODO: throw errorFactory error
    }
    this.handleEvent(
      [
        AglynEventStateFlag.COMPONENT_BUNDLE_UNREGISTERING,
        AglynEventStateFlag.COMPONENT_BUNDLE_UNREGISTERED,
      ],
      { pluginId },
      () => {
        bundle.componentIds.forEach((componentId) => {
          this.unregisterComponent({ componentId, pluginId })
        })
        this.bundles.delete(pluginId)
      },
    )
    return this
  }
}

export default AglynComponentsController
