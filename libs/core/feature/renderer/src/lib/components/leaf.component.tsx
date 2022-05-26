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

import type {ComponentId} from '@aglyn/core-data-framework'
import {isValidElementType} from '@aglyn/shared-ui-jsx'
import {mergeSxProps} from '@aglyn/shared-ui-theme'
import {_isArrEmpty} from '@aglyn/shared-util-guards'
import {Box, type BoxProps} from '@mui/material'
import clsx from 'clsx'
import {forwardRef, Fragment, useMemo} from 'react'
import ReactMarkdown from 'react-markdown'
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
    const {$id, leafComponent, children, className, sx, ...rest} = props

    const leaf = useMemo(() => leafComponent || LeafComponent, [leafComponent])
    const {
      className: resolvedClassName,
      sx: resolvedSx,
      ...resolved
    } = useAglynElementResolvedProps($id)
    const elements = useAglynElementData($id, 'elements')
    const component = useAglynElementComponent<any, any>($id)
    const Component = useMemo(() => {
      return component && isValidElementType(component) ? component : Box
    }, [component])

    return (
      <Component
        ref={ref}
        key={`element-leaf-${$id}`}
        id={`element-leaf-${$id}`}
        className={clsx(className, resolvedClassName)}
        sx={mergeSxProps(sx, resolvedSx)}
        {...rest}
        {...resolved}
      >
        {children}
        <ReactMarkdown
          children={resolved.children}
          components={{
            p: Fragment,
          }}
        />
        {_isArrEmpty(elements) ? null : (
          <BranchComponent
            key={`element-branch-${$id}`}
            leafComponent={leaf}
            elements={elements}
          />
        )}
      </Component>
    )
  },
)

LeafComponent.displayName = 'LeafComponent'
LeafComponent.aglyn = true
LeafComponent.defaultProps = {
  children: undefined,
}

type LeafComponent = typeof LeafComponent
export {LeafComponent}
export default LeafComponent
