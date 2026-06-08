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

import * as Aglyn from '@aglyn/aglyn'
import { observer } from 'mobx-react-lite'
import { forwardRef, useMemo } from 'react'
import RendererComponents, {
  type RenderComponentsContext,
} from '../contexts/renderer-components'
import Branch from './branch'
import Leaf from './leaf'
import Stem from './stem'
import Trunk from './trunk'

export interface TreeRootProps extends Partial<RenderComponentsContext> {
  node: Aglyn.NodeSchema
}

export const TreeRoot = observer(
  forwardRef<any, TreeRootProps>((props, ref) => {
    const {
      node,
      TrunkComponent,
      StemComponent,
      BranchComponent,
      LeafComponent,
    } = props

    const Components = useMemo<RenderComponentsContext>(
      () => ({
        TrunkComponent: (TrunkComponent ?? Trunk) as RenderComponentsContext['TrunkComponent'],
        StemComponent: (StemComponent ?? Stem) as RenderComponentsContext['StemComponent'],
        BranchComponent: (BranchComponent ?? Branch) as RenderComponentsContext['BranchComponent'],
        LeafComponent: (LeafComponent ?? Leaf) as RenderComponentsContext['LeafComponent'],
      }),
      [TrunkComponent, StemComponent, BranchComponent, LeafComponent],
    )

    return (
      <RendererComponents.Provider value={Components}>
        <Components.TrunkComponent ref={ref} node={node} />
      </RendererComponents.Provider>
    )
  }),
)
TreeRoot.displayName = 'TreeRoot'
TreeRoot['aglyn'] = true

export default TreeRoot
