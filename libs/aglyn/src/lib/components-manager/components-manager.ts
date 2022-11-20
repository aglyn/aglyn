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
import { makeAutoObservable, observable, runInAction, toJS } from 'mobx'
import type { ComponentClass, ComponentProps } from 'react'
import {
  type AbstractNodeSchema,
  type NodeSchemaNested,
  NodeType,
} from '../screen-manager'
import { createIdUrlSafe} from '../constants'
import {
  FEATURE_FLAG,
  FieldComponentType,
  LinealDirectiveFlag,
} from '../constants'
import { AglynEvent, emitter, lifecycleEvent } from '../emit-manager'
import type { PluginId } from '../plugin-manager'
import { hasDependency } from '../plugin-manager'
import type { NodeId, NodeSchema } from '../screen-manager'

export enum ComponentCategory {
  INPUT = 'Input',
  SURFACE = 'Surface',
  NAVIGATION = 'Navigation',
  LAYOUT = 'Layout',
  DATA_DISPLAY = 'Data Display',
  TEXT = 'Text',
  UNCATEGORIZED = 'Uncategorized',
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

export type NodePresetData = Omit<NodeSchema, '$id' | 'nodes'> & {
  $id?: NodeId
  nodes?: NodePresetData[]
}

export interface ComponentState {
  factories: Record<ComponentId, ComponentFactory>
  schemas: Record<ComponentId, ComponentSchema<any>>
  presets: Record<PresetId, PresetSchema<any>>
}

export const state = observable<ComponentState>({
  factories: {},
  schemas: {},
  presets: {},
})

export function _isFeatureExplicitlyDisabled(val: FEATURE_FLAG) {
  return Boolean(val === FEATURE_FLAG.DISABLED)
}
export function _isFeatureExplicitlyEnabled(val: FEATURE_FLAG) {
  return Boolean(val === FEATURE_FLAG.ENABLED)
}
export function _isFeatureDisabledDefault(val: FEATURE_FLAG) {
  return val === (val | FEATURE_FLAG.DISABLED_DEFAULT)
}
export function _isFeatureEnabledDefault(val: FEATURE_FLAG) {
  return val === (val | FEATURE_FLAG.ENABLED_DEFAULT)
}
export function _isFeatureUnknown(val: FEATURE_FLAG) {
  return val === FEATURE_FLAG.UNKNOWN || val === undefined || val === null
}
export function isFeatureDefaulted(val: FEATURE_FLAG) {
  return Boolean(val & FEATURE_FLAG.DEFAULT) || _isFeatureUnknown(val)
}
export function isFeatureDisabled(val: FEATURE_FLAG) {
  return Boolean(val & FEATURE_FLAG.DISABLED_DEFAULT)
}
export function isFeatureEnabled(val: FEATURE_FLAG) {
  return Boolean(val & FEATURE_FLAG.ENABLED_DEFAULT) || _isFeatureUnknown(val)
}

export function getFactory(componentId: ComponentId) {
  return state.factories[componentId]
}

export function getSchema(componentId: ComponentId) {
  console.log('schema', state.schemas)
  return state.schemas[componentId]
}

export function hasComponent(componentId: ComponentId) {
  return Object.hasOwn(state.factories, componentId)
}

export function registerComponent(
  component: ComponentFactory,
  schema: ComponentSchema,
) {
  const { $id, pluginId } = schema

  lifecycleEvent(
    () => {
      // TODO: throw errorFactory error
      if (pluginId && !hasDependency(pluginId)) {
        throw new Error(`No plugin exists with ID ${pluginId}.`)
      } /* else if (pluginId) {
        const ids = (plugins[pluginId].componentIds ??= [])
        ids.push(componentId)
      }*/
      runInAction(() => {
        state.factories[$id] = component
        state.schemas[$id] = schema
      })
    },
    {
      beforeEvent: AglynEvent.COMPONENT_REGISTERING,
      beforePayload: [{ $id: $id, pluginId: pluginId }],
      afterEvent: AglynEvent.COMPONENT_REGISTERED,
      afterPayload: [{ $id: $id, pluginId: pluginId }],
    },
  )
}

export function unregisterComponent(componentId: ComponentId) {
  lifecycleEvent(
    () => {
      if (!componentId || !hasComponent(componentId)) {
        throw new Error(`No component exists with ID ${componentId}.`)
      }
      const { pluginId } = getSchema(componentId)

      if (pluginId && !hasDependency(pluginId)) {
        throw new Error(`No plugin exists with ID ${pluginId}.`)
      } /*else if (pluginId) {
        plugins[pluginId].componentIds = plugins[pluginId].componentIds.filter(
          (i) => i !== componentId,
        )
      }*/
      runInAction(() => {
        delete state.schemas[componentId]
        delete state.factories[componentId]
      })
    },
    {
      beforeEvent: AglynEvent.COMPONENT_UNREGISTERING,
      beforePayload: [{ componentId }],
      afterEvent: AglynEvent.COMPONENT_UNREGISTERED,
      afterPayload: [{ componentId }],
    },
  )
}

export function getComponentLabel(componentId?: ComponentId) {
  const schema = getSchema(componentId)
  return schema?.displayName || schema?.title || schema?.$id || componentId
}

export function getPreset($id: PresetId) {
  return (state.presets ||= {})[$id]
}

export function hasPreset($id: PresetId) {
  return Boolean($id) && Object.hasOwn(state.presets, $id)
}

export function registerPreset(presets: PresetSchema[] | PresetSchema) {
  if (!presets) return
  const arr = Array.isArray(presets) ? presets : [presets]

  for (const preset of arr) {
    const $id = (preset.$id ||= createIdUrlSafe())
    lifecycleEvent(
      () => {
        runInAction(() => {
          state.presets[$id] = new AglynPreset(preset)
        })
      },
      {
        beforeEvent: AglynEvent.PRESET_REGISTERING,
        beforePayload: [{preset: toJS(preset)}],
        afterEvent: AglynEvent.PRESET_REGISTERED,
        afterPayload: [{preset: toJS(preset)}],
      },
    )
  }
}

export function unregisterPreset($ids: PresetId[] | PresetId) {
  if (!$ids) return
  const arr = Array.isArray($ids) ? $ids : [$ids]

  for (const $id of arr) {
    lifecycleEvent(
      () => {
        runInAction(() => {
          delete state.presets[$id]
        })
      },
      {
        beforeEvent: AglynEvent.PRESET_UNREGISTERING,
        beforePayload: [{$id}],
        afterEvent: AglynEvent.PRESET_UNREGISTERED,
        afterPayload: [{$id}],
      },
    )
  }
}

emitter.on(AglynEvent.COMPONENT_REGISTER, ({ component, schema }) => {
  registerComponent(component, schema)
})
emitter.on(AglynEvent.COMPONENT_UNREGISTER, ({ componentId }) => {
  unregisterComponent(componentId)
})


emitter.on(AglynEvent.PRESET_REGISTER, ({preset}) => {
  registerPreset(preset)
})
emitter.on(AglynEvent.PRESET_UNREGISTER, ({presetId}) => {
  unregisterPreset(presetId)
})
