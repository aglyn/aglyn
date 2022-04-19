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

import {setBesignerCanvasHovered} from '@aglyn/core-data-besigner'
import {TreeRootComponent, useAglynAppContext} from '@aglyn/core-feature-renderer'
import {createTheme, styled, ThemeProvider} from '@aglyn/shared-feature-themes'
import Box from '@mui/material/Box'
// import {MuiShadowDom} from '@aglyn/shared-ui-jsx'
import {forwardRef, type HTMLAttributes, type MouseEvent, useCallback} from 'react'
import RenderedCanvasElementsProvider from '../contexts/rendered-canvas-elements'
import ElementLeafComponent from './element-leaf.component'
import ElementOverlayPopperComponent from './element-overlay-popper.component'


const hostTheme = createTheme({palette: {}})

const ViewportFrame = styled('div', {
  name: 'AglynViewportFrame',
})(({theme}) => ({
  flexGrow: 1,
  minHeight: '100%',
  width: '100%',
  background: theme.palette.background.paper,
  borderColor: theme.palette.divider,
  borderWidth: `0.3em`,
  borderStyle: 'solid',
  display: 'flex',
  // position: 'relative',
}))

export interface ViewportFrameComponentProps extends HTMLAttributes<HTMLDivElement> {}

const ViewportFrameComponent = forwardRef<any, ViewportFrameComponentProps>(
  function RefRenderFn(props, ref) {
    const {children, ...rest} = props


    const app = useAglynAppContext()
    const handleMouseLeave = useCallback((e: MouseEvent) => {
      e.stopPropagation()
      setBesignerCanvasHovered(app, {hovered: () => ({})})
    }, [app])

    return (
      <ViewportFrame
        ref={ref}
        id="aglyn:viewport-frame"
        {...rest}
      >
        <RenderedCanvasElementsProvider>
          {/*<MuiShadowDom.div>*/}
          <ThemeProvider theme={hostTheme}>
            <Box
              id="aglyn:site-container"
              onMouseLeave={handleMouseLeave}
              sx={{minHeight: 1, width: 1, bgcolor: 'background.paper'}}
            >
              <TreeRootComponent
                leafComponent={ElementLeafComponent}
                sx={{minHeight: 1}}
              />
            </Box>
          </ThemeProvider>
          {/*</MuiShadowDom.div>*/}

          <Box
            id="aglyn:site-overlay"
            sx={{position: 'relative', zIndex: 'tooltip'}}
          >
            <ElementOverlayPopperComponent
              id="aglyn:element-overlay-hovered"
              variant="hoveredOverlay"
            />
            <ElementOverlayPopperComponent
              id="aglyn:element-overlay-selected"
              variant="selectedOverlay"
            />
          </Box>
        </RenderedCanvasElementsProvider>
        {children}
      </ViewportFrame>
    )
  },
)

ViewportFrameComponent.displayName = 'ViewportFrameComponent'
ViewportFrameComponent.aglyn = true
ViewportFrameComponent.defaultProps = {}

export {ViewportFrameComponent}
export default ViewportFrameComponent
