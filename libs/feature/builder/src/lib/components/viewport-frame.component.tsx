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

import { CanvasRendererComponent } from '@aglyn/feature-renderer'
import { styled } from '@aglyn/shared-feature-themes'
import { forwardRef, HTMLAttributes } from 'react'
import { CanvasRenderedElementRefsConsumer } from '../contexts/canvas-rendered-element-refs'
import { HoverContextProvider } from '../contexts/hover-context-provider'
import { useCanvasHovered } from '../hooks/use-builder-hovered'
import { useCanvasSelected } from '../hooks/use-builder-selected'
import { ElementOutlineComponent } from './element-outline.component'
import { ElementRendererComponent } from './element-renderer.component'


const Toolbox = forwardRef(
  function RefRenderFn(props) {
    const selected = useCanvasSelected()
    const selectedId = selected?.$id
    const hovered = useCanvasHovered()
    const hoveredId = hovered?.$id

    return (
      <CanvasRenderedElementRefsConsumer>
        {({getElement}) => (
          <>
            <ElementOutlineComponent
              anchorRef={getElement(selectedId)}
              // variant={outlineVariant}
              // isDragging={isDragging}
              // isOver={isOver}
              data-aglyn-element-outline={selectedId ? `selected:${selectedId}` : undefined}
              $id={selectedId}
            />
            <ElementOutlineComponent
              anchorRef={getElement(hoveredId)}
              // variant={outlineVariant}
              // isDragging={isDragging}
              // isOver={isOver}
              data-aglyn-element-outline={hoveredId ? `hover:${hoveredId}` : undefined}
              $id={hoveredId}
            />
          </>
        )}
      </CanvasRenderedElementRefsConsumer>
    )
  },
)


const ViewportFrame = styled('div', {name: 'ViewportFrame'})(({theme}) => ({
  flexGrow: 1,
  minHeight: '100%',
  width: '100%',
  background: theme.palette.background.paper,
  border: `0.3em solid ${theme.palette.grey[200]}`,
  // position: 'relative',
}))

export interface ViewportFrameComponentProps extends HTMLAttributes<HTMLDivElement> {

}

export const ViewportFrameComponent = forwardRef<any, ViewportFrameComponentProps>(
  function RefRenderFn(props, ref) {
    const {children, ...rest} = props

    return (
      <ViewportFrame ref={ref} {...rest}>
        <HoverContextProvider>
          <CanvasRendererComponent
            id="aglyn:canvas"
            elementRendererComponent={ElementRendererComponent}
          />
          <Toolbox />
        </HoverContextProvider>
        {children}
      </ViewportFrame>
    )
  },
)

ViewportFrameComponent.displayName = 'ViewportFrameComponent'
ViewportFrameComponent.defaultProps = {}

export default ViewportFrameComponent
