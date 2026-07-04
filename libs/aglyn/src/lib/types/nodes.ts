/**
 * @license
 * Copyright 2026 Aglyn LLC
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
  ConditionDefinition,
  DataType,
  FieldActions,
  ResolvePropsFunction,
  Validator,
} from '@data-driven-forms/react-form-renderer'
import type { MuiStyledOptions } from '@mui/system/createStyled'
import type { SvgIconProps } from '@mui/material/SvgIcon'
/** Minimal icon-props type used in component/preset schemas. Structurally compatible with @aglyn/shared-ui-jsx MdiIconProps. */
export type MdiIconProps<D extends React.ElementType = 'svg', P = object> = SvgIconProps<D, P> & {
  path?: string
}
import type {
  ComponentId,
  ComponentsLinealOrder,
  NodeId,
  PresetId,
} from '../foundation'
import { ComponentCategory } from '../foundation'
import type { ITimestamp } from '@aglyn/shared-util-timestamp'
import type React from 'react'
import type { ComponentClass, ComponentProps } from 'react'
import type { NODE_ROOT_ID } from '../canvas-manager'

import type { FEATURE_FLAG, FieldComponentType } from '../foundation'
import type { PluginId } from '../plugin-manager'
import type { ElementContentMap, Node, Props, Taxonomic } from './ast'
import type { AglynDocument } from '../foundation'
import type { HostUid } from '../foundation'

declare module './ast' {
  /**
   * This map registers all node types that may be used as top-level content in
   * the document.
   *
   * These types are accepted inside `root` nodes.
   *
   * This interface can be augmented to register custom node types.
   *
   * @example
   * declare module 'hast' {
   *   interface RootContentMap {
   *     // Allow using raw nodes defined by `rehype-raw`.
   *     raw: Raw;
   *   }
   * }
   */
  export interface RootContentMap {
    canvasNode: CanvasNode
    canvasElement: CanvasElement
  }

  /**
   * This map registers all node types that may be used as content in an
   * element.
   *
   * These types are accepted inside `element` nodes.
   *
   * This interface can be augmented to register custom node types.
   *
   * @example
   * declare module 'hast' {
   *   interface RootContentMap {
   *     custom: Custom;
   *   }
   * }
   */
  export interface ElementContentMap {
    canvasNode: CanvasNode
    canvasElement: CanvasElement
  }
}

/**
 * This map registers all node types that may be used as content in an canvas
 * node.
 *
 * These types are accepted inside `element` nodes.
 *
 * This interface can be augmented to register custom node types.
 *
 * @example
 * declare module 'hast' {
 *   interface RootContentMap {
 *     custom: Custom;
 *   }
 * }
 */
export interface CanvasNodeContentMap extends ElementContentMap {
  canvasNode: CanvasNode
  canvasElement: CanvasElement
}

export type CanvasNodeContent = CanvasNodeContentMap[keyof CanvasNodeContentMap]

/**
 * CanvasNode represents a the schema for building a JSX Element.
 */
export interface CanvasNode extends Node {
  /**
   * Represents this variant of a Node.
   */
  type: 'node'

  /**
   * List representing the children of a node.
   */
  children?: CanvasNodeContent[] | undefined

  /**
   * Represents the element's internal name defined by the user
   */
  name?: string | undefined

  /**
   * Represents the element's parent unique identifier
   */
  parentId?: string | undefined

  /**
   * Represents the elements' component unique identifier
   */
  componentId?: string | undefined

  /**
   * Represents the elements' components' plugin unique identifier
   */
  pluginId?: string | undefined

  /**
   * Represents information associated with the element.
   */
  props?: Props | undefined
}

/**
 * CanvasElement represents a living JSX Element
 */
export interface CanvasElement extends CanvasNode {
  /**
   * Represents the element's unique identifier
   */
  $id: string
}

export type AbstractId = string

// @TODO ⚠️ Refactor for better adoption of hast
export interface AbstractNodeSchema<P = JSX.AnyProps> extends CanvasNode {
  /**
   * The unique identifier for a node
   */
  $id: AbstractId
  title?: string
  displayName?: string
  description?: string

  children?: any
  nodes?: any

  /**
   * The node style properties for emotion
   */
  sx?: JSX.SxProps
  /**
   * The node props/attributes passed to the component
   */
  props?: P

  category?: any
  icon?: any

  createdAt?: ITimestamp
  updatedAt?: ITimestamp
  deletedAt?: ITimestamp
}

/**
 * CanvasPreset represents an encapsulated 'node' type as the root node for
 * crafting a living JSX Element
 */
export interface CanvasPreset extends Node, Taxonomic {
  /**
   * Represents this variant of a Node.
   */
  type: 'preset'

  /**
   * Represents the element's unique identifier
   */
  $id: string

  /**
   * Represents the elements' component unique identifier
   */
  componentId?: string | undefined

  /**
   * Represents the elements' components' plugin unique identifier
   */
  pluginId?: string | undefined

  /**
   * Represents information associated with the element.
   */
  props?: Props | undefined

  /**
   * Represents the element's internal name defined by the user
   */
  name?: string | undefined
}

export type { NodeId }

// @TODO ⚠️ Refactor for better adoption of hast
type PresetI = AglynDocument &
  Omit<AbstractNodeSchema<any>, 'type' | 'data'> &
  Omit<CanvasPreset, 'type' | 'data'>

interface PresetII extends PresetI {
  type: NodeType.PRESET | string
}

export interface PresetSchema<P = JSX.AnyProps> extends PresetII {
  $id: PresetId
  pluginId?: PluginId
  displayName?: string
  description?: string
  category?: string | ComponentCategory
  icon?: MdiIconProps
  data: NodeSchemaNested<P>
}

// @TODO ⚠️ Refactor for better adoption of hast
type NodeI<P> = AglynDocument & Omit<AbstractNodeSchema<P>, 'type'>

export interface NodeSchema<P = JSX.AnyProps> extends NodeI<P> {
  type: NodeType | string
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

export { ComponentCategory }

export type { ComponentId }
export type { PresetId }

export type ComponentFactory<
  P extends ComponentProps<C> | any = any,
  C extends keyof JSX.IntrinsicElements | JSX.ElementConstructor<any> = any,
> = ComponentClass<P> | JSX.ElementConstructor<P> | keyof JSX.IntrinsicElements
// | keyof JSX.IntrinsicElements[keyof JSX.IntrinsicElements]

export type { ComponentsLinealOrder }

// @TODO ⚠️ Refactor for better adoption of hast
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

// @TODO ⚠️ Refactor for better adoption of hast
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
