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

import { setBesignerCanvasHovered } from '@aglyn/besigner-data-app'
import { CANVAS_ROOT_ELEMENT_ID } from '@aglyn/core-data-foundation'
import {
  useAglynAppContext,
  useAglynSiteTheme,
} from '@aglyn/core-feature-renderer'
import {
  MuiShadowDom,
  type ShadowRootProps,
  useShadowDomContext,
} from '@aglyn/shared-ui-jsx'
import { styled, ThemeProvider } from '@aglyn/shared-ui-theme'
import { Box, type BoxProps, CssBaseline } from '@mui/material'
// import {MuiShadowDom} from '@aglyn/shared-ui-jsx'
import {
  type ComponentProps,
  forwardRef,
  HTMLAttributes,
  useCallback,
} from 'react'
import ElementLeafComponent from './element-leaf.component'
import ElementOverlayPopperComponent from './element-overlay-popper.component'

const ViewportFrame = styled('div', {
  name: 'AglynViewportFrame',
})(({ theme }) => ({
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
ViewportFrame.displayName = 'ViewportFrame'
type SiteShadowDomProps = HTMLAttributes<HTMLDivElement> & ShadowRootProps
const SiteShadowDom = styled(MuiShadowDom.div, {
  name: 'AglynViewportShadowDom',
})<SiteShadowDomProps>(({ theme }) => ({
  minHeight: '100%',
  width: '100%',
  /**
   * Positioning hack
   * @see https://stackoverflow.com/a/70422489/16134372
   */
  transform: 'scale(1)',
}))
SiteShadowDom.displayName = 'SiteShadowDom'

const Elements = () => {
  return (
    <Box
      sx={{
        // bgcolor: 'background.paper',
        minHeight: 1,
        minWidth: 1,
      }}
    >
      <ElementLeafComponent
        leafComponent={ElementLeafComponent}
        $id={CANVAS_ROOT_ELEMENT_ID}
        sx={{ minHeight: 1 }}
      />
    </Box>
  )
}

const ThemedElementContainer = () => {
  const shadowDom = useShadowDomContext()
  const hostTheme = useAglynSiteTheme({ container: shadowDom })
  return (
    <ThemeProvider theme={hostTheme}>
      <CssBaseline>
        <Elements />
      </CssBaseline>
    </ThemeProvider>
  )
}

const SiteContainer = (props: SiteShadowDomProps) => {
  const { ...rest } = props
  return (
    <SiteShadowDom
      key="aglyn:site-container"
      id="aglyn:site-container"
      mode="closed"
      {...rest}
    >
      <ThemedElementContainer />
    </SiteShadowDom>
  )
}

const Overlays = (props: Partial<BoxProps>) => {
  const { ...rest } = props
  return (
    <Box
      key="aglyn:site-overlay"
      id="aglyn:site-overlay"
      sx={{
        position: 'relative',
        zIndex: 'tooltip',
      }}
      {...rest}
    >
      <ElementOverlayPopperComponent
        key="aglyn:element-overlay-selected"
        id="aglyn:element-overlay-selected"
        variant="selectedOverlay"
      />
      <ElementOverlayPopperComponent
        key="aglyn:element-overlay-hovered"
        id="aglyn:element-overlay-hovered"
        variant="hoveredOverlay"
      />
    </Box>
  )
}

export interface ViewportFrameComponentProps
  extends ComponentProps<typeof ViewportFrame> {}

const ViewportFrameComponent = forwardRef<any, ViewportFrameComponentProps>(
  (props, ref) => {
    const { onMouseLeave, ...rest } = props

    const app = useAglynAppContext()
    const handleMouseLeave = useCallback(
      (e) => {
        e.stopPropagation()
        setBesignerCanvasHovered(app, { hovered: () => ({}) })
        onMouseLeave && onMouseLeave(e)
      },
      [app, onMouseLeave],
    )

    return (
      <ViewportFrame
        ref={ref}
        id="aglyn:viewport-frame"
        onMouseLeave={handleMouseLeave}
        {...rest}
      >
        <SiteContainer />
        <Overlays />
      </ViewportFrame>
    )
  },
)

ViewportFrameComponent.displayName = 'ViewportFrameComponent'
ViewportFrameComponent.aglyn = true
ViewportFrameComponent.defaultProps = {}

export { ViewportFrameComponent }
export default ViewportFrameComponent
