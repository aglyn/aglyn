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
import { isValidElementType } from 'react-is'
import { mergeSxProps } from '@aglyn/shared-ui-theme'
import arraySafe from '@aglyn/shared-util-tools/array/array-safe'
import { Box, type BoxProps } from '@mui/material'
import clsx from 'clsx'
import { forwardRef, Fragment, useMemo } from 'react'
import ReactMarkdown from 'react-markdown'
import useAglynElementResolvedProps from '../hooks/use-aglyn-element-resolved-props'
import BranchComponent from './branch.component'

export interface LeafComponentProps extends BoxProps<any, any> {
  $id: Aglyn.NodeId
  leafComponent?: LeafComponent
}

export const LeafComponent = forwardRef<any, LeafComponentProps>(
  function RefRenderFn(props, ref) {
    const { $id, leafComponent, children, className, sx, ...rest } = props
    const node = Aglyn.canvas.getNode($id)
    const factory = Aglyn.components.getFactory(node?.componentId)
    const Component = useMemo(() => {
      return isValidElementType(factory) ? factory : Box
    }, [factory])
    const resolved = useAglynElementResolvedProps($id)
    const _className = clsx(
      className,
      ...arraySafe(resolved?.className, [resolved?.className]),
      ...arraySafe(resolved?.props?.className, [resolved?.props?.className]),
    )

    return (
      <Component
        ref={ref}
        id={`element-leaf-${$id}`}
        className={_className}
        sx={mergeSxProps(sx as any, resolved?.sx as any, resolved?.props?.sx as any)}
        {...resolved?.props}
        {...rest}
      >
        {children}
        <ReactMarkdown
          children={resolved?.props?.children}
          components={{
            p: Fragment,
          }}
        />
        <BranchComponent
          key={`element-branch-${$id}`}
          $id={$id}
          leafComponent={leafComponent}
        />
      </Component>
    )
  },
)

LeafComponent.displayName = 'LeafComponent'
LeafComponent.aglyn = true

type LeafComponent = typeof LeafComponent

export default LeafComponent
