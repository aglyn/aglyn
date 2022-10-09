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

import * as Aglyn from '@aglyn/aglyn'
import { forwardRef } from 'react'
import Branch from './branch'
import Leaf from './leaf'

export interface StemProps {
  nodeId: Aglyn.NodeId
}

const Stem = forwardRef<any, StemProps>((props, ref) => {
  const { nodeId } = props

  if (!Aglyn.screen.hasNode(nodeId)) {
    console.error(`Error rendering ${nodeId}`)
    return <div></div>
  }

  const nodeSchema = Aglyn.screen.getNode(nodeId)
  let cmpFactory: Aglyn.ComponentFactory = null
  let cmpSchema: Aglyn.ComponentSchema = null

  if (Aglyn.components.hasComponent(nodeSchema.componentId)) {
    cmpFactory = Aglyn.components.getFactory(nodeSchema.componentId)
    cmpSchema = Aglyn.components.getSchema(nodeSchema.componentId)
  }

  return (
    <Leaf
      ref={ref}
      key={nodeSchema.$id}
      component={cmpFactory}
      nodeSchema={nodeSchema}
      cmpSchema={cmpSchema}
    >
      {!nodeSchema.nodes?.length ? null : (
        <Branch
          key={nodeSchema.$id}
          parentId={nodeSchema.$id}
          nodeIds={nodeSchema.nodes}
        />
      )}
    </Leaf>
  )
})
Stem.displayName = 'Stem'
Stem.defaultProps = {}
Stem.aglyn = true

export { Stem }
export default Stem
