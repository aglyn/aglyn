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
import type { Dictionary } from '@aglyn/shared-data-types'
import type {
  ConditionDefinition,
  DataType,
  FieldActions,
  ResolvePropsFunction,
  Validator,
} from '@aglyn/shared-ui-jsx-forms'
import type { MdiIconProps } from '@aglyn/shared-ui-mdi-jsx'
import type { MuiStyledOptions } from '@aglyn/shared-ui-theme'
import type { ITimestamp } from '@aglyn/shared-util-timestamp'
import type { ComponentClass, ComponentProps } from 'react'
import type { NODE_ROOT_ID } from '../canvas-manager'
import type {
  FEATURE_FLAG,
  FieldComponentType,
  LinealDirectiveFlag,
} from '../constants'
import type { PluginId } from '../plugin-manager/index'
import type { VersionUid } from './screen'
import type { AglynDocument } from './shared'
import type { HostUid } from './workspace'

export type AbstractId = string

export interface AbstractNodeSchema<P = JSX.AnyProps> extends AglynDocument {
  /**
   * The unique identifier for a node
   */
  $id?: AbstractId
  name?: string
  title?: string
  displayName?: string
  description?: string

  children?: any
  nodes?: any

  data?: any
  attributes?: any
  /**
   * The node style properties for emotion
   */
  sx?: JSX.SxProps
  /**
   * The node props/attributes passed to the component
   */
  props?: P

  taxonomy?: any
  category?: any
  tags?: any
  icon?: any

  /**
   * The node type to describe the IST
   */
  type?: any
  kind?: any
  flags?: Record<string, boolean>

  createdAt?: ITimestamp
  updatedAt?: ITimestamp
  deletedAt?: ITimestamp

  inherits?: string

  versionId?: VersionUid
  /**
   * The unique identifier of the node component
   */
  componentId?: AbstractId
  /**
   * The unique identifier of the node parent
   */
  parentId?: AbstractId
  /**
   * The unique identifier of the node component plugin bundle
   */
  pluginId?: AbstractId
}

export type NodeId = string

export interface PresetSchema<P = JSX.AnyProps> extends AbstractNodeSchema {
  $id: PresetId
  pluginId?: PluginId
  displayName?: string
  description?: string
  category?: string | ComponentCategory
  icon?: MdiIconProps
  data: NodeSchemaNested<P>
  type?: NodeType.PRESET
}

export interface NodeSchema<P = JSX.AnyProps> extends AbstractNodeSchema<P> {
  /**
   * List of the children unique identifiers for the node
   */
  nodes?: NodeId[]
  /**
   * Class name to pass the DOM node, can also be defined in props
   */
  className?: string
  /**
   * The computed node parent (only for type completion)
   */
  readonly parent?: NodeSchema<any> | null
  /**
   * The computed node parent (only for type completion)
   */
  readonly children?: NodeSchema<any>[]
  /**
   * The computed index in parent nodes (only for type completion)
   */
  readonly index?: number | null
  /**
   * The computed label (only for type completion)
   */
  readonly labelShort?: string | undefined
  /**
   * The computed breadcrumb path (only for type completion)
   */
  readonly breadcrumbPath?: NodeBreadcrumbPath
  /**
   * The computed component schema (only for type completion)
   */
  readonly componentSchema?: ComponentSchema | undefined
  /**
   * The computed guard for of child nodes (only for type completion)
   */
  readonly hasNodes?: boolean
  /**
   * The computed property for the resolved props from component schema
   */
  readonly resolvedProps?: P
}

export enum NodeType {
  NODE = 'node',
  TEXT = 'text',
  NUMBER = 'number',
  SCREEN = 'screen',
  REF = 'ref',
  PRESET = 'preset',
}

export type NodeSchemaJSON<P = JSX.AnyProps> = Omit<
  NodeSchema<P>,
  | 'parent'
  | 'index'
  | 'labelShort'
  | 'breadcrumbPath'
  | 'componentSchema'
  | 'hasNodes'
>

export type NodeSchemaNested<P = JSX.AnyProps> = Omit<
  NodeSchemaJSON<P>,
  'nodes'
> & { nodes?: NodeSchemaNested<any>[] }

export type NodesMap = Record<NodeId, NodeSchema<any>>

export type NodeBreadcrumbPath = [
  root: string & typeof NODE_ROOT_ID,
  ...nodes: [...ancestors: NodeId[], node: NodeId],
]

export type ProcessableNodes =
  | NodeSchemaNested<any>[]
  | NodeSchemaNested<any>
  | Record<NodeId, NodeSchema>

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

export interface PresetSchema<P = JSX.AnyProps> extends AbstractNodeSchema {
  $id: PresetId
  pluginId?: PluginId
  displayName?: string
  description?: string
  category?: string | ComponentCategory
  icon?: MdiIconProps
  data: NodeSchemaNested<P>
  type?: NodeType.PRESET
}

export type SchemasByCategory = Record<
  ComponentCategory | string,
  (ComponentSchema<any> | PresetSchema<any>)[]
>

export interface ScreenSchema {
  nodes: NodeSchemaNested
  createdAt?: ITimestamp
  updatedAt?: ITimestamp
  hostId?: HostUid
}
