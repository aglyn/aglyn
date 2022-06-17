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

import type { ComponentId } from '@aglyn/foundation-data-core'
import type { OverrideableComponentProps } from '@aglyn/shared-data-types'
import { forwardRef, Fragment, useMemo } from 'react'
import LeafComponent from './leaf.component'

export interface BranchComponentProps extends OverrideableComponentProps {
  leafComponent?: LeafComponent
  elements?: ComponentId[]
}

const BranchComponent = forwardRef<any, BranchComponentProps>(function RefRenderFn(props, ref) {
  const { component: Component, leafComponent, elements, ...rest } = props

  const Leaf = useMemo(() => leafComponent || LeafComponent, [leafComponent])

  return (
    <Component ref={ref} {...rest}>
      {elements.map(($id) => (
        <Leaf key={$id} $id={$id} leafComponent={Leaf} />
      ))}
    </Component>
  )
})

BranchComponent.displayName = 'BranchComponent'
BranchComponent.aglyn = true
BranchComponent.defaultProps = {
  component: Fragment,
  children: null,
  elements: [],
}

export { BranchComponent }
export default BranchComponent
