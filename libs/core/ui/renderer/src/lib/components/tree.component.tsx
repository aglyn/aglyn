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

import { forwardRef } from 'react'
import {
  type LeafType,
  TreeComponentContext,
  TreeContext,
} from '../contexts/tree-context'
import LeafComponent from './leaf.component'

export interface TreeProps {
  leafs?: LeafType[]
  renderLeaf?: (leaf: LeafType) => JSX.Node
}

const TreeComponent = forwardRef<any, TreeProps>((props, ref) => {
  const { leafs, renderLeaf } = props

  return (
    <TreeContext.Provider value={leafs}>
      <TreeComponentContext.Consumer>
        {(TreeComponent) => (
          <TreeComponent ref={ref}>{leafs.map(renderLeaf)}</TreeComponent>
        )}
      </TreeComponentContext.Consumer>
    </TreeContext.Provider>
  )
})

TreeComponent.displayName = 'TreeComponent'
TreeComponent.defaultProps = {
  leafs: [],
  renderLeaf: (leaf) => <LeafComponent key={leaf.id} data={leaf} />,
}

export { TreeComponent }
export default TreeComponent
