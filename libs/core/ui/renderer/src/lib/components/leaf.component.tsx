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

import '@aglyn/shared-data-jsx'
import { forwardRef } from 'react'
import { LeafContext } from '../contexts/leaf-context'
import type { LeafType } from '../definitions/leaf'

export interface LeafProps<T extends LeafType = any>
  extends JSX.OverrideableComponentProps {
  data: T
}

const LeafComponent = forwardRef<any, LeafProps>(function RefRenderFn(
  props,
  ref,
) {
  const { component: Component, children, data, ...rest } = props

  return (
    <LeafContext.Provider value={data}>
      <Component ref={ref} {...rest}>
        {children}
      </Component>
    </LeafContext.Provider>
  )
})

LeafComponent.displayName = 'LeafComponent'
LeafComponent.defaultProps = {
  component: 'div',
  children: null,
}

export { LeafComponent }
export default LeafComponent
