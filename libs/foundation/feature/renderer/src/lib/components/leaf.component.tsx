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
import { isValidElementType } from '@aglyn/shared-ui-jsx'
import { mergeSxProps } from '@aglyn/shared-ui-theme'
import { Box, type BoxProps } from '@mui/material'
import clsx from 'clsx'
import { forwardRef, Fragment, useMemo } from 'react'
import ReactMarkdown from 'react-markdown'
import useAglynElementComponent from '../hooks/use-aglyn-element-component'
import useAglynElementResolvedProps from '../hooks/use-aglyn-element-resolved-props'
import BranchComponent from './branch.component'

export interface LeafComponentProps extends BoxProps<any, any> {
  $id: ComponentId
  leafComponent?: LeafComponent
}

const LeafComponent = forwardRef<any, LeafComponentProps>(function RefRenderFn(
  props,
  ref,
) {
  const { $id, leafComponent, children, className, sx, ...rest } = props
  const component = useAglynElementComponent<any, any>($id)
  const Component = useMemo(() => {
    return component && isValidElementType(component) ? component : Box
  }, [component])
  const {
    className: resolvedClassName,
    sx: resolvedSx,
    ...resolved
  } = useAglynElementResolvedProps($id)

  return (
    <Component
      ref={ref}
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
      <BranchComponent
        key={`element-branch-${$id}`}
        $id={$id}
        leafComponent={leafComponent}
      />
    </Component>
  )
})

LeafComponent.displayName = 'LeafComponent'
LeafComponent.aglyn = true
LeafComponent.defaultProps = {
  children: undefined,
}

type LeafComponent = typeof LeafComponent
export { LeafComponent }
export default LeafComponent
