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

import { forwardRef, Fragment } from 'react'
import { LeafComponentContext } from '../contexts/leaf-context'
import { TreeContext } from '../contexts/tree-context'
import type { TreeType } from '../definitions/tree'

export interface TreeProps<T extends TreeType = any>
  extends JSX.OverrideableComponentProps {
  data?: T
}

const TreeComponent = forwardRef<any, TreeProps>(function RefRenderFn(
  props,
  ref,
) {
  const { component: Component, data, ...rest } = props
  const { items } = data

  return (
    <TreeContext.Provider value={data}>
      <Component ref={ref} {...rest}>
        {Array.isArray(items) &&
          items.map((item) => (
            <LeafComponentContext.Consumer>
              {(Leaf) => <Leaf key={item.id} data={item} />}
            </LeafComponentContext.Consumer>
          ))}
      </Component>
    </TreeContext.Provider>
  )
})

TreeComponent.displayName = 'TreeComponent'
TreeComponent.defaultProps = {
  component: Fragment,
  children: null,
  data: { items: [] },
}

export { TreeComponent }
export default TreeComponent
