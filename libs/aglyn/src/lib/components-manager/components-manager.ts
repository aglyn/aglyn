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
import { observable, runInAction } from 'mobx'
import type { ComponentClass, ComponentProps } from 'react'
import * as Aglyn from '../../index'
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
}

export type ComponentId = string

export type ComponentFactory<
  P extends ComponentProps<C> | any = any,
  C extends keyof JSX.IntrinsicElements | JSX.ElementConstructor<any> = any,
> = ComponentClass<P> | JSX.ElementConstructor<P> | keyof JSX.IntrinsicElements
// | keyof JSX.IntrinsicElements[keyof JSX.IntrinsicElements]

export type ComponentsLinealOrder = [
  directiveType: LinealDirectiveFlag,
  directiveDefinition:
    | Array<ComponentId>
    | { bundles?: Array<PluginId>; components: Array<ComponentId> }
    | { bundles: Array<PluginId>; components?: Array<ComponentId> },
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
  componentId: ComponentId
  pluginId?: PluginId
  kind?: 'element' | 'plaintext' | 'markdown'

  displayName: string
  title?: string
  subtitle?: string
  description?: string

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
  restrictChildren?: Aglyn.ComponentsLinealOrder
  /**
   * Define a limitation for nodes allowed to be direct ancestors
   */
  restrictParent?: Aglyn.ComponentsLinealOrder

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

export type NodePresetData = Omit<NodeSchema, '$id' | 'nodes'> & {
  $id?: NodeId
  nodes?: NodePresetData[]
}

export const factories: Record<ComponentId, ComponentFactory> = observable({})
export const schemas: Record<ComponentId, ComponentSchema> = observable({})

emitter.on(AglynEvent.COMPONENT_REGISTER, ({ component, schema }) => {
  registerComponent(component, schema)
})
emitter.on(AglynEvent.COMPONENT_UNREGISTER, ({ componentId }) => {
  unregisterComponent(componentId)
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
  return factories[componentId]
}

export function getSchema(componentId: ComponentId) {
  return schemas[componentId]
}

export function hasComponent(componentId: ComponentId) {
  return Object.hasOwn(factories, componentId)
}

export function registerComponent(
  component: ComponentFactory,
  schema: ComponentSchema,
) {
  const { componentId, pluginId } = schema

  lifecycleEvent(
    () => {
      // TODO: throw errorFactory error
      if (pluginId && !hasDependency(pluginId)) {
        throw new Error(`No plugin exists with ID ${pluginId}.`)
      } /* else if (pluginId) {
        const ids = (bundles[pluginId].componentIds ??= [])
        ids.push(componentId)
      }*/
      runInAction(() => {
        factories[componentId] = component
        schemas[componentId] = schema
      })
    },
    {
      beforeEvent: AglynEvent.COMPONENT_REGISTERING,
      beforePayload: [{ componentId, pluginId: pluginId }],
      afterEvent: AglynEvent.COMPONENT_REGISTERED,
      afterPayload: [{ componentId, pluginId: pluginId }],
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
        bundles[pluginId].componentIds = bundles[pluginId].componentIds.filter(
          (i) => i !== componentId,
        )
      }*/
      runInAction(() => {
        delete schemas[componentId]
        delete factories[componentId]
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
  return schema?.displayName || schema?.title
}
