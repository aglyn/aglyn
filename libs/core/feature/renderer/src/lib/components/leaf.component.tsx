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

import {type ComponentId} from '@aglyn/core-data-framework'
import {_isArrEmpty} from '@aglyn/shared-util-guards'
import Box, {type BoxProps} from '@mui/material/Box'
import clsx from 'clsx'
import {forwardRef} from 'react'
import useAglynElementComponent from '../hooks/use-aglyn-element-component'
import useAglynElementData from '../hooks/use-aglyn-element-data'
import useAglynElementResolvedProps from '../hooks/use-aglyn-element-resolved-props'
import BranchComponent from './branch.component'


export interface LeafComponentProps extends BoxProps<any, any> {
  $id: ComponentId
  leafComponent?: LeafComponent
}

const LeafComponent = forwardRef<any, LeafComponentProps>(
  function RefRenderFn(props, ref) {
    const {
      $id,
      leafComponent,
      children: childrenProp,
      className: classNameProp,
      ...rest
    } = props

    const leaf = leafComponent || LeafComponent
    const elements = useAglynElementData($id, 'elements')
    const Component = useAglynElementComponent<any, any>($id)
    const {children, className: classNameElem, ...elemProps} = useAglynElementResolvedProps($id)
    const className = clsx(classNameProp, classNameElem)


    return (
      <Box
        ref={ref}
        className={className}
        component={Component}
        {...elemProps}
        {...rest}
      >
        {children}
        {childrenProp}
        {!_isArrEmpty(elements || []) ? (
          <BranchComponent
            leafComponent={leaf}
            elements={elements}
          />
        ) : null}
      </Box>
    )
  },
)

LeafComponent.displayName = 'Renderer.LeafComponent'
LeafComponent.defaultProps = {
  children: null,
}

type LeafComponent = typeof LeafComponent
export {LeafComponent}
export default LeafComponent
