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

import { makeAutoObservable } from 'mobx'
import { nanoid } from 'nanoid'
import type { PluginId } from '../plugin-manager'

export type NodeId = string

export interface NodeSchema<P = JSX.AnyProps> {
  $id: NodeId
  componentId: string
  bundleId?: PluginId
  parentId?: NodeId
  sx?: JSX.SxProps
  props?: P
  nodes?: NodeId[]
}

export type NodeSchemaDenormalized<P = JSX.AnyProps> = Omit<NodeSchema<P>, 'nodes'>
  & {nodes?: NodeSchemaDenormalized<any>[]}

export const NODE_ID_LENGTH = 10

export function createNodeId(): NodeId {
  return nanoid(NODE_ID_LENGTH)
}

export function nodeFactory<P>(schema: NodeSchema<P>) {
  const node: NodeSchema<P> = {
    $id: schema.$id,
    componentId: schema.componentId,
    bundleId: schema.bundleId,
    parentId: schema.parentId,
    sx: Array.isArray(schema.sx) ? [...schema.sx] : {...schema.sx},
    props: {...schema.props},
    nodes: Array.isArray(schema.nodes) ? [...schema.nodes] : [],
  }

  return makeAutoObservable({
    $id: node.$id,
    componentId: node.componentId,
    bundleId: node.bundleId,
    parentId: node.parentId,
    sx: node.sx,
    props: node.props,
    nodes: node.nodes,
  })
}
