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

import { types } from 'mobx-state-tree'
import { PluginId } from '../../plugin-manager'
import { ComponentId, NodeId, NodeType } from '../../types'

// Interface for NodeModel
interface INodeModel<P = any> {
  $id: string
  nodes?: NodeId[]
  name?: string
  type: NodeType | string
  pluginId?: PluginId
  componentId?: ComponentId
  parentId?: NodeId
  props: P
  sx?: JSX.SxProps
  className?: string
}

// Define a branch-level model with a reference to child nodes
// @ts-expect-error — MST generic model type inference limitation
const NodeModel = types.model<INodeModel>('NodeModel', {
  $id: types.identifier,
  // children: types.maybe(
  //   // then typecast each array element to Instance<typeof INodeModel>
  //   types.array(types.late((): IAnyModelType => NodeModel)),
  // ),
  nodes: types.maybe(types.array(types.string)),
  name: types.maybe(types.string),
  type: types.maybe(types.string),
  pluginId: types.maybe(types.string),
  componentId: types.maybe(types.string),
  parentId: types.maybe(types.string),
  props: types.maybe(types.frozen()),
  sx: types.maybe(types.frozen()),
  className: types.maybe(types.string),
})

// Interface for LeafModel
interface ILeafModel {
  aa: string
}

// Define a leaf-level model
const LeafModel = types.model('LeafModel', {
  aa: types.maybe(types.string),
})

const CanvasModel = types.model('NodeStoreModel', {
  nodes: types.maybe(types.map(NodeModel)),
})

// Define the root-level model with a reference to child nodes
export const TreeNodeModel = types.union(LeafModel, NodeModel)

