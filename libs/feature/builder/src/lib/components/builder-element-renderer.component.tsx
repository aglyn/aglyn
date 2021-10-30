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

import { useAglynElementData, ElementRendererComponent, ElementRendererComponentProps } from '@aglyn/feature-renderer'
import { useConfirmationContext } from '@aglyn/shared-ui-jsx'
import { useThrottledCallback } from '@aglyn/shared-util-vendor'
import { forwardRef, memo, useCallback } from 'react'
import { useHoverContext } from '../contexts/hover-context'
import { useSelectionContext } from '../contexts/selection-context'


export interface BuilderElementRendererComponentProps extends ElementRendererComponentProps {
  [prop: string]: any
}

const BuilderElementRendererComponentRaw = forwardRef<any, BuilderElementRendererComponentProps>(
  function RefRenderFn(props, ref) {
    const {$id, ...rest} = props
    const {hover, close: closeHover} = useHoverContext()
    const {select, close: deselect, $id: selectedId} = useSelectionContext()
    const {confirm} = useConfirmationContext()

    const handleMouseOver = useThrottledCallback(
      useCallback((e) => {
        e.stopPropagation()
        const target = e.currentTarget
        const clientRect = target?.getBoundingClientRect?.().toJSON?.()
        if (target && clientRect) {
          hover({clientRect, $id})
        }
      }, [$id]),
      250
    )

    const handleMouseLeave = useThrottledCallback(
      useCallback((e) => {
        e.stopPropagation()
        closeHover()
      }, []),
      250
    )

    const handleMouseDown = useCallback((e) => {
      e.stopPropagation()
      if (selectedId === $id) {
        deselect()
      } else {
        const target = e.currentTarget
        const clientRect = target?.getBoundingClientRect?.().toJSON?.()
        select({clientRect, $id})
        confirm({title: 'clicked'})
      }
    }, [$id, selectedId])

    const {componentId, bundleId} = useAglynElementData($id)

    return (
      <ElementRendererComponent
        ref={ref}
        $id={$id}
        data-aglyn-element-id={$id}
        data-aglyn-component-id={componentId}
        data-aglyn-bundle-id={bundleId}
        onMouseOver={handleMouseOver}
        onMouseLeave={handleMouseLeave}
        onMouseDown={handleMouseDown}
        elementRendererComponent={BuilderElementRendererComponent}
        {...rest}
      />
    )
  }
)

BuilderElementRendererComponentRaw.displayName = 'BuilderElementRendererComponent'
BuilderElementRendererComponentRaw.defaultProps = {}

export const BuilderElementRendererComponent = BuilderElementRendererComponentRaw
export default BuilderElementRendererComponent
