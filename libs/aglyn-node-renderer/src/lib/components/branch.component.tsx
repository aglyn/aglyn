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
import type { NodeId } from '@aglyn/aglyn'
import { forwardRef, Fragment, useMemo } from 'react'
import LeafComponent from './leaf.component'

export interface BranchComponentProps extends JSX.OverrideableComponentProps {
  leafComponent?: typeof LeafComponent
  $id?: NodeId
}

export const BranchComponent = forwardRef<any, BranchComponentProps>(
  (props, ref) => {
    const {
      component: Component = Fragment,
      leafComponent,
      $id,
      ...rest
    } = props

    const node = Aglyn.canvas.getNode($id)
    const Leaf = useMemo(() => leafComponent || LeafComponent, [leafComponent])

    return Array.isArray(node?.nodes) && node?.nodes.length ? (
      <Component ref={ref} {...rest}>
        {node?.nodes.map(($id) => (
          <Leaf key={`element-leaf-${$id}`} $id={$id} leafComponent={Leaf} />
        ))}
      </Component>
    ) : null
  },
)

BranchComponent.displayName = 'BranchComponent'
BranchComponent.aglyn = true

export default BranchComponent
