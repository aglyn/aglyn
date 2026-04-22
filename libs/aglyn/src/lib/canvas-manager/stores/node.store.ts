/**
 * @license
 * Copyright 2024 Aglyn LLC
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

import { type IAnyModelType, types } from 'mobx-state-tree'

// Interface for LeafModel
interface ILeafModel {
  aa: string
}

// Interface for BranchModel
interface IBranchModel {
  name: string
  children?: Array<IBranchModel | ILeafModel>
}

// Define a leaf-level model
const LeafModel = types.model('LeafModel', {
  aa: types.string,
})

// Define a branch-level model with a reference to child nodes
// @ts-ignore
const BranchModel = types.model<IBranchModel>('BranchModel', {
  name: types.string,
  children: types.maybe(
    types.array(types.late((): IAnyModelType => BranchModel)),
  ),
  // then typecast each array element to Instance<typeof BranchModel>
})

// Define the root-level model with a reference to child nodes
// @ts-ignore
export const TreeNodeModel = types.union(LeafModel, BranchModel)

// Create the root tree node
const rootNode = BranchModel.create({
  name: 'Root',
  children: [
    {
      name: 'Child1',
      children: [{ name: 'Child1.1', hh: '' }, { name: 'Child1.2' }],
    },
    {
      name: 'Child2',
      children: [{ name: 'Child2.1' }, { name: 'Child2.2' }],
    },
    {
      name: 'Child3',
    },
    {
      name: 'Child4',
      aa: 'Child2',
    },
  ],
})

// Accessing data
console.log('node.store.ts rootNode.name', rootNode.name) // Output: Root
console.log('node.store.ts rootNode', rootNode.toJSON())
