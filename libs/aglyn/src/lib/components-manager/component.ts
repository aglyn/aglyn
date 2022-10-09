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
import type { ComponentClass, ComponentProps } from 'react'
import type { PluginId } from '../plugin-manager'
import type { NodeId, NodeSchema } from '../screen-manager'

export type ComponentId = string

export enum FEATURE_FLAG {
  DEFAULT,
  ENABLED = 1 << 1,
  DISABLED = 1 << 2,
}

export enum ComponentCategory {
  INPUT = 'Input',
  SURFACE = 'Surface',
  NAVIGATION = 'Navigation',
  LAYOUT = 'Layout',
  DATA_DISPLAY = 'Data Display',
}

export enum FieldComponentType {
  BUTTON = 'button',
  BUTTON_GROUP = 'button-group',
  CHECKBOX = 'checkbox',
  COLOR_PICKER = 'color-picker',
  DATE_PICKER = 'date-picker',
  DUAL_LIST_SELECT = 'dual-list-select',
  FIELD_ARRAY = 'field-array',
  ICON_PICKER = 'icon-picker',
  INPUT_ADDON_BUTTON_GROUP = 'input-addon-button-group',
  INPUT_ADDON_GROUP = 'input-addon-group',
  PLAIN_TEXT = 'plain-text',
  RADIO = 'radio',
  SELECT = 'select',
  SLIDER = 'slider',
  SUB_FORM = 'sub-form',
  SWITCH = 'switch',
  TAB_ITEM = 'tab-item',
  TABS = 'tabs',
  TEXT_FIELD = 'text-field',
  TEXTAREA = 'textarea',
  TIME_PICKER = 'time-picker',
  TOGGLE_BUTTON = 'toggle-button',
  WIZARD = 'wizard',
}

export enum ComponentsLinealDirectiveFlag {
  LIMIT_TO = 'limitedTo',
  DISALLOW = 'forbid',
}

export type ComponentFactory<
  P extends ComponentProps<C> | any = any,
  C extends keyof JSX.IntrinsicElements | JSX.ElementConstructor<any> = any,
> = ComponentClass<P> | JSX.ElementConstructor<P> | keyof JSX.IntrinsicElements
// | keyof JSX.IntrinsicElements[keyof JSX.IntrinsicElements]

export type ComponentsLinealOrder = [
  directiveType: ComponentsLinealDirectiveFlag,
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

export type NodePresetData = Omit<NodeSchema, '$id' | 'nodes'> & {
  $id?: NodeId
  nodes?: NodePresetData[]
}
