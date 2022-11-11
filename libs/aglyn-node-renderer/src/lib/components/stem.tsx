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
import { observer } from 'mobx-react-lite'
import RendererComponents from '../contexts/renderer-components'

export interface StemProps {
  nodeId: Aglyn.NodeId
}

function RawStem(props, ref) {
  const { nodeId } = props

  if (!Aglyn.screen.hasNode(nodeId)) {
    console.error(`Error rendering ${nodeId}`)
    return <div></div>
  }

  const node = Aglyn.screen.getNode(nodeId)

  return (
    <RendererComponents.Consumer>
      {({ LeafComponent, BranchComponent }) => (
        <LeafComponent ref={ref} key={node?.$id} node={node}>
          <BranchComponent node={node} />
        </LeafComponent>
      )}
    </RendererComponents.Consumer>
  )
}
RawStem.displayName = 'Stem'
RawStem.aglyn = true

const Stem = observer<StemProps, any>(RawStem, { forwardRef: true })

export { Stem }
export default Stem
