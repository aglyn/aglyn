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

import type { JSONSchema7 } from 'json-schema'
import { makeAutoObservable } from 'mobx'
import { nanoid } from 'nanoid'
import { NODE_ROOT_ID } from '../constants'
import type { PluginId } from '../plugin-manager'

export type NodeId = string

export interface NodeSchema<P = JSX.AnyProps> {
  $id: NodeId
  componentId: string
  pluginId?: PluginId
  parentId?: NodeId
  nodes?: NodeId[]
  className?: string
  props?: P
  sx?: JSX.SxProps
  displayName?: string
}

export const NodeSchemaJsonSchema: JSONSchema7 = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://aglyn.io/schema/node.schema.json',
  title: 'Aglyn Node Item',
  description: 'Aglyn screen node for hydrating view component',
  type: 'object',
  additionalProperties: false,
  properties: {
    $id: {
      description: 'The unique identifier for a node',
      type: 'string',
    },
    componentId: {
      description: 'The unique identifier of the node component',
      type: 'string',
    },
    pluginId: {
      description: 'The unique identifier of the node component bundle',
      type: 'string',
    },
    parentId: {
      description: 'The unique identifier of the node parent',
      type: 'string',
    },
    sx: {
      description: 'The node style properties for emotion',
      type: 'object',
    },
    props: {
      description: 'The node props/attributes passed to the component',
      type: 'object',
    },
    nodes: {
      description: 'List of the children unique identifiers for the node',
      type: 'array',
      items: {
        type: 'string',
      },
    },
  },
  required: ['$id', 'componentId'],
}

export type NodeSchemaNested<P = JSX.AnyProps> = Omit<
  NodeSchema<P>,
  'nodes'
> & { nodes?: NodeSchemaNested<any>[] }

export type NodeNavigationHierarchy = [
  root: typeof NODE_ROOT_ID,
  ...nodes: [...ancestors: NodeId[], node: NodeId],
]

export const NodeSchemaNestedJsonSchema: JSONSchema7 = {
  ...NodeSchemaJsonSchema,
  properties: {
    ...NodeSchemaJsonSchema.properties,
    nodes: {
      ...(NodeSchemaJsonSchema.properties['nodes'] as JSONSchema7),
      items: {
        $ref: '#',
      },
    },
  },
}

export const NODE_ID_LENGTH = 10

export function createNodeId(): NodeId {
  return nanoid(NODE_ID_LENGTH)
}

export function nodeFactory<P = JSX.AnyProps>(schema: NodeSchema<P>) {
  const node: NodeSchema<P> = {
    $id: schema.$id,
    componentId: schema.componentId,
    pluginId: schema.pluginId,
    parentId: schema.parentId,
    sx: Array.isArray(schema.sx) ? [...schema.sx] : { ...schema.sx },
    props: { ...schema.props },
    nodes: Array.isArray(schema.nodes) ? [...schema.nodes] : [],
  }

  return makeAutoObservable({
    $id: node.$id,
    componentId: node.componentId,
    pluginId: node.pluginId,
    parentId: node.parentId,
    sx: node.sx,
    props: node.props,
    nodes: node.nodes,
  })
}
