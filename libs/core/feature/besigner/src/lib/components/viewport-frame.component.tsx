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

import { CanvasRendererComponent } from '@aglyn/core-feature-renderer'
import { styled } from '@aglyn/shared-feature-themes'
import { forwardRef, HTMLAttributes } from 'react'
import { HoverContextProvider } from '../contexts/hover-context-provider'
import { ElementRendererComponent } from './element-renderer.component'
import { ViewportPoppersComponent } from './viewport-poppers.component'


const ViewportFrame = styled('div', {
  name: 'AglynViewportFrame'
})(({ theme }) => ({
  flexGrow: 1,
  minHeight: '100%',
  width: '100%',
  background: theme.palette.background.paper,
  border: `0.3em solid ${theme.palette.grey[200]}`,
  // position: 'relative',
}))

export interface ViewportFrameComponentProps extends HTMLAttributes<HTMLDivElement> {}

const ViewportFrameComponent = forwardRef<any, ViewportFrameComponentProps>(
  function RefRenderFn(props, ref) {
    const { children, ...rest } = props

    return (
      <ViewportFrame ref={ref} {...rest}>
        <HoverContextProvider>
          <CanvasRendererComponent
            id="aglyn:canvas"
            elementRendererComponent={ElementRendererComponent}
          />
          <ViewportPoppersComponent />
        </HoverContextProvider>
        {children}
      </ViewportFrame>
    )
  }
)

ViewportFrameComponent.displayName = 'ViewportFrameComponent'
ViewportFrameComponent.defaultProps = {}

export { ViewportFrameComponent }
export default ViewportFrameComponent
