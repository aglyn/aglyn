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
import {CANVAS_ROOT_ELEMENT_ID} from '@aglyn/core-data-framework'
import {useAglynAppContext} from '@aglyn/core-feature-renderer'
import {createTheme, styled, ThemeProvider} from '@aglyn/shared-ui-theme'
import Box from '@mui/material/Box'
// import {MuiShadowDom} from '@aglyn/shared-ui-jsx'
import {type ComponentProps, forwardRef, useCallback, useMemo} from 'react'
import ElementLeafComponent from './element-leaf.component'
import ElementOverlayPopperComponent from './element-overlay-popper.component'


const Overlays = () => {
  return (
    <Box id="aglyn:site-overlay" sx={{position: 'relative', zIndex: 'tooltip'}}>
      <ElementOverlayPopperComponent
        id="aglyn:element-overlay-selected"
        variant="selectedOverlay"
      />
      <ElementOverlayPopperComponent
        id="aglyn:element-overlay-hovered"
        variant="hoveredOverlay"
      />
    </Box>
  )
}

const Elements = () => {
  return (
    <ElementLeafComponent
      leafComponent={ElementLeafComponent}
      $id={CANVAS_ROOT_ELEMENT_ID}
      sx={{minHeight: 1}}
    />
  )
}

const ThemedElementContainer = () => {
  const hostTheme = useMemo(() => {
    return createTheme({palette: {}})
  }, [])
  return (
    <ThemeProvider theme={hostTheme}>
      <Elements />
    </ThemeProvider>
  )
}


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

export interface ViewportFrameComponentProps extends ComponentProps<typeof ViewportFrame> {}

const ViewportFrameComponent = forwardRef<any, ViewportFrameComponentProps>(
  function RefRenderFn(props, ref) {
    const {children, onMouseLeave, ...rest} = props

    const app = useAglynAppContext()
    const handleMouseLeave = useCallback((e) => {
      e.stopPropagation()
      setBesignerCanvasHovered(app, {hovered: () => ({})})
      onMouseLeave && onMouseLeave(e)
    }, [app, onMouseLeave])

    return (
      <ViewportFrame
        ref={ref}
        id="aglyn:viewport-frame"
        onMouseLeave={handleMouseLeave}
        {...rest}
      >
        {/*<MuiShadowDom.div>*/}
        <Box
          id="aglyn:site-container"
          sx={{minHeight: 1, width: 1, bgcolor: 'background.paper'}}
        >
          <ThemedElementContainer />
        </Box>
        {/*</MuiShadowDom.div>*/}

        <Overlays />
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
