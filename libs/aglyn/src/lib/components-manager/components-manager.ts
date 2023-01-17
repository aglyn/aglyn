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

import type { Dictionary } from '@aglyn/shared-data-types'
// eslint-disable-next-line @nrwl/nx/enforce-module-boundaries
import type {
  ConditionDefinition,
  DataType,
  FieldActions,
  ResolvePropsFunction,
  Validator,
} from '@aglyn/shared-ui-jsx-forms'
// eslint-disable-next-line @nrwl/nx/enforce-module-boundaries
import type { MdiIconProps } from '@aglyn/shared-ui-mdi-jsx'
// eslint-disable-next-line @nrwl/nx/enforce-module-boundaries
import type { MuiStyledOptions } from '@aglyn/shared-ui-theme'
import { makeAutoObservable, toJS } from 'mobx'
import { computedFn } from 'mobx-utils'
import type { ComponentClass, ComponentProps } from 'react'
import { type Aglyn, lifecycleEvent } from '../aglyn'
import type { NodeSchema } from '../canvas-manager'
import {
  type AbstractNodeSchema,
  type NodeSchemaNested,
  NodeType,
} from '../canvas-manager'
import {
  createIdUrlSafe,
  FEATURE_FLAG,
  FieldComponentType,
  LinealDirectiveFlag,
} from '../constants'
import { AglynEvent } from '../emit-manager'
import type { PluginId } from '../plugin-manager'

export enum ComponentCategory {
  INPUT = 'Input',
  SURFACE = 'Surface',
  NAVIGATION = 'Navigation',
  LAYOUT = 'Layout',
  DATA_DISPLAY = 'Data Display',
  TEXT = 'Text',
  UNCATEGORIZED = 'Uncategorized',
  ALL = 'All',
}

export type ComponentId = string
export type PresetId = string

export type ComponentFactory<
  P extends ComponentProps<C> | any = any,
  C extends keyof JSX.IntrinsicElements | JSX.ElementConstructor<any> = any,
> = ComponentClass<P> | JSX.ElementConstructor<P> | keyof JSX.IntrinsicElements
// | keyof JSX.IntrinsicElements[keyof JSX.IntrinsicElements]

export type ComponentsLinealOrder = [
  directiveType: LinealDirectiveFlag,
  directiveDefinition:
    | Array<ComponentId>
    | { plugins?: Array<PluginId>; components: Array<ComponentId> }
    | { plugins: Array<PluginId>; components?: Array<ComponentId> },
]

export interface AttributeSchema extends Dictionary<any> {
  name: string
  dataType?: DataType
  component: string | FieldComponentType
  validate?: Validator[]
  condition?: ConditionDefinition | ConditionDefinition[]
  initializeOnMount?: boolean
  initialValue?: any
  clearedValue?: any
  clearOnUnmount?: boolean
  actions?: FieldActions
  resolveProps?: ResolvePropsFunction
  description?: string
}

export interface ComponentSchema<P = any> {
  $id?: ComponentId
  pluginId?: PluginId
  kind?: 'element' | 'plaintext' | 'markdown'

  displayName: string
  title?: string
  subtitle?: string
  description?: string
  category?: string | ComponentCategory

  /**
   * Icon props for display around besigner
   */
  icon?: MdiIconProps
  /**
   * Options to be passed to styled(Component, \{...styledOptions\})
   */
  styledOptions?: MuiStyledOptions

  /**
   * Define a limitation for nodes allowed as direct descendents
   */
  restrictChildren?: ComponentsLinealOrder
  /**
   * Define a limitation for nodes allowed to be direct ancestors
   */
  restrictParent?: ComponentsLinealOrder

  /**
   * Filter props
   */
  resolveProps?: JSX.ResolveProps<NodeSchema<P>>

  /**
   * Attribute fields to modify the contextual properties
   * New version
   */
  attributes?: AttributeSchema[]

  /**
   * Feature flags
   */
  flags?: {
    /**
     * Disable the use of emotion styled
     */
    emotion?: FEATURE_FLAG
    /**
     * Can the nodes of this component type be cloned?
     */
    cloning?: FEATURE_FLAG
    /**
     * Allow dragging nodes of this component type
     */
    dragging?: FEATURE_FLAG
    /**
     * Allow dropping nodes inside nodes of this component type
     */
    dropping?: FEATURE_FLAG
    /**
     * Allow editing element attributes of this component type
     */
    editing?: FEATURE_FLAG
    /**
     * Allow removing nodes of this component type
     */
    removing?: FEATURE_FLAG
    /**
     * Describe nodes of this component type to be self-closing
     */
    selfClosing?: FEATURE_FLAG
  }
}

export interface PresetSchema<P = JSX.AnyProps>
  extends AbstractNodeSchema<NodeType.PRESET> {
  $id: PresetId
  pluginId?: PluginId
  displayName?: string
  description?: string
  category?: string | ComponentCategory
  icon?: MdiIconProps
  data: NodeSchemaNested<P>
}

export class AglynPreset<P = JSX.AnyProps> implements PresetSchema<P> {
  public $id: PresetId
  public type: NodeType.PRESET = NodeType.PRESET
  public category: string | ComponentCategory
  public data: NodeSchemaNested<P>
  public description: string
  public displayName: string
  public icon: MdiIconProps
  public pluginId: PluginId

  constructor(schema: PresetSchema<P>) {
    this.$id = schema.$id
    this.category = schema.category || ComponentCategory.UNCATEGORIZED
    this.data = schema.data
    this.description = schema.description
    this.displayName = schema.displayName
    this.icon = schema.icon
    this.pluginId = schema.pluginId

    makeAutoObservable(this)
  }
}

type SchemasByCategory = Record<
  ComponentCategory | string,
  (ComponentSchema<any> | PresetSchema<any>)[]
>

export class ComponentManager {
  public factories: Record<ComponentId, ComponentFactory> = {}
  public schemas: Record<ComponentId, ComponentSchema<any>> = {}
  public presets: Record<PresetId, PresetSchema<any>> = {}

  public get schemasByCategory(): SchemasByCategory {
    const schemas: SchemasByCategory = {}
    const setSchema = (schema: ComponentSchema<any> | PresetSchema<any>) => {
      const category = schema.category || ComponentCategory.UNCATEGORIZED
      ;(schemas[category] ??= []).push(schema)
      ;(schemas[ComponentCategory.ALL] ??= []).push(schema)
    }
    // Object.values(this.schemas).forEach(setSchema)
    Object.values(this.presets).forEach(setSchema)
    return schemas
  }

  public getFactory = computedFn((id: ComponentId) => {
    return this.factories[id]
  })
  public getSchema = computedFn((id: ComponentId) => {
    return this.schemas[id]
  })
  public getPreset = computedFn((id: PresetId) => {
    return this.schemas[id]
  })
  public getLabel = computedFn((id: ComponentId) => {
    const schema = this.schemas[id]
    return schema?.displayName || schema?.title || schema?.$id
  })

  constructor(protected aglyn?: Aglyn) {
    makeAutoObservable(this)
  }

  public registerComponent(
    component: ComponentFactory,
    schema: ComponentSchema,
  ) {
    lifecycleEvent(
      () => {
        this.factories[schema.$id] = component
        this.schemas[schema.$id] = schema
      },
      {
        beforeEvent: AglynEvent.COMPONENT_REGISTERING,
        beforePayload: [{ $id: schema.$id, pluginId: schema.pluginId }],
        afterEvent: AglynEvent.COMPONENT_REGISTERED,
        afterPayload: [{ $id: schema.$id, pluginId: schema.pluginId }],
      },
    )
  }
  public unregisterComponent(id: ComponentId) {
    lifecycleEvent(
      () => {
        delete this.factories[id]
        delete this.schemas[id]
      },
      {
        beforeEvent: AglynEvent.COMPONENT_UNREGISTERING,
        beforePayload: [{ componentId: id }],
        afterEvent: AglynEvent.COMPONENT_UNREGISTERED,
        afterPayload: [{ componentId: id }],
      },
    )
  }
  public registerPreset(presets: PresetSchema[] | PresetSchema) {
    if (!presets) return
    const arr = Array.isArray(presets) ? presets : [presets]

    for (const preset of arr) {
      const $id = (preset.$id ||= createIdUrlSafe())
      lifecycleEvent(
        () => {
          this.presets[$id] = new AglynPreset(preset)
        },
        {
          beforeEvent: AglynEvent.PRESET_REGISTERING,
          beforePayload: [{ preset: toJS(preset) }],
          afterEvent: AglynEvent.PRESET_REGISTERED,
          afterPayload: [{ preset: toJS(preset) }],
        },
      )
    }
  }
  public unregisterPreset($ids: PresetId[] | PresetId) {
    if (!$ids) return
    const arr = Array.isArray($ids) ? $ids : [$ids]

    for (const $id of arr) {
      lifecycleEvent(
        () => {
          delete this.presets[$id]
        },
        {
          beforeEvent: AglynEvent.PRESET_UNREGISTERING,
          beforePayload: [{ $id }],
          afterEvent: AglynEvent.PRESET_UNREGISTERED,
          afterPayload: [{ $id }],
        },
      )
    }
  }
}

export default ComponentManager
