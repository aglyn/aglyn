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
import { AglynNodeRenderer } from '@aglyn/aglyn-node-renderer'
import * as Besigner from '@aglyn/besigner'
import { useAglynSiteTheme } from '@aglyn/core-feature-renderer'
import {
  MuiShadowDom,
  type MuiShadowRootProps,
  useMuiShadowDomContext,
} from '@aglyn/shared-ui-jsx'
import { styled, ThemeProvider } from '@aglyn/shared-ui-theme'
import { Box, type BoxProps, CssBaseline, GlobalStyles } from '@mui/material'
import { observer } from 'mobx-react-lite'
// import {MuiShadowDom} from '@aglyn/shared-ui-jsx'
import {
  type ComponentProps,
  forwardRef,
  HTMLAttributes,
  useCallback,
} from 'react'
import CanvasDropIndicator from './dnd/canvas-drop-indicator'
import NodeLeaf from './node-leaf'
import NodeOverlay from './node-overlay'

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

type SiteShadowDomProps = HTMLAttributes<HTMLDivElement> & MuiShadowRootProps
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
const FramePaper = styled('div', {
  name: 'AglynFramePaper',
})<SiteShadowDomProps>(({ theme }) => ({
  backgroundColor: theme.palette.background.default,
  height: '100%',
  width: '100%',
  [`> [data-aglyn="leaf\\:_@_"]`]: {
    minHeight: '100%',
    width: '100%',
  },
}))
FramePaper.displayName = 'FramePaper'

const ViewportGlobalStyles = (
  <GlobalStyles
    styles={{
      ':host': {
        all: 'initial',
      },
    }}
  />
)
const ThemedElementContainer = ({ children }) => {
  const shadowDom = useMuiShadowDomContext()
  const hostTheme = useAglynSiteTheme({ container: shadowDom })
  return (
    <ThemeProvider theme={hostTheme}>
      <CssBaseline />
      {children}
    </ThemeProvider>
  )
}

const SiteContainer = observer(
  forwardRef<any, SiteShadowDomProps>((props, ref) => {
    const { ...rest } = props
    return (
      <SiteShadowDom
        ref={ref}
        data-aglyn={'viewport:dom'}
        mode="closed"
        {...rest}
      >
        <>
          {ViewportGlobalStyles}
          <ThemedElementContainer>
            <FramePaper>
              <AglynNodeRenderer
                node={Aglyn.canvas.getNode(Aglyn.NODE_ROOT_ID)}
                LeafComponent={NodeLeaf}
              />
            </FramePaper>
          </ThemedElementContainer>
        </>
      </SiteShadowDom>
    )
  }),
)

const Overlays = forwardRef<any, Partial<BoxProps>>((props, ref) => {
  const { ...rest } = props

  return (
    <Box
      ref={ref}
      data-aglyn="viewport:popover"
      sx={{
        // position: 'relative',
        zIndex: 'tooltip',
      }}
      {...rest}
    >
      <NodeOverlay data-aglyn="overlay:selected" variant="selected" />
      <NodeOverlay data-aglyn="overlay:hovered" variant="hovered" />
      <CanvasDropIndicator />
    </Box>
  )
})

export interface ViewportFrameComponentProps
  extends ComponentProps<typeof ViewportFrame> {}

export const ViewportFrameComponent = forwardRef<
  any,
  ViewportFrameComponentProps
>((props, ref) => {
  const { onMouseLeave, ...rest } = props

  const handlePointerLeave = useCallback(
    (e) => {
      // e.stopPropagation()
      Besigner.focus.clearHover()
      onMouseLeave && onMouseLeave(e)
    },
    [onMouseLeave],
  )

  return (
    <ViewportFrame
      ref={ref}
      data-aglyn="viewport:frame"
      onMouseLeave={handlePointerLeave}
      onPointerLeave={handlePointerLeave}
      {...rest}
    >
      <SiteContainer />
      <Overlays />
    </ViewportFrame>
  )
})

ViewportFrameComponent.displayName = 'ViewportFrameComponent'
ViewportFrameComponent.aglyn = true

export default ViewportFrameComponent
