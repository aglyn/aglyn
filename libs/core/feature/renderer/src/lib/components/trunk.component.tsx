/**
 * @license
 * Copyright 2021 Aglyn LLC
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

import {CANVAS_ROOT_ELEMENT_ID} from '@aglyn/core-data-framework'
import {type OverrideableComponentProps} from '@aglyn/shared-data-types'
import {forwardRef, HTMLAttributes} from 'react'
import {LeafComponent} from './leaf.component'


export interface TrunkComponentProps extends HTMLAttributes<HTMLElement>, OverrideableComponentProps {
  leafComponent?: LeafComponent
}

const TrunkComponent = forwardRef<any, TrunkComponentProps>(
  function RefRenderFn(props, ref) {
    const {
      leafComponent,
      children,
      $id,
      ...rest
    } = props
    const Leaf = leafComponent || LeafComponent
    // const elements = useAglynElementData(CANVAS_ROOT_ELEMENT_ID, 'elements')
    return (
      <Leaf
        ref={ref}
        $id={$id}
        leafComponent={Leaf}
        {...rest}
      >
        {children}
      </Leaf>
    )
  },
)

TrunkComponent.displayName = 'TrunkComponent'
TrunkComponent.aglyn = true
TrunkComponent.defaultProps = {
  component: 'div',
  $id: CANVAS_ROOT_ELEMENT_ID,
}

export {TrunkComponent}
export default TrunkComponent
