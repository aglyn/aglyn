/**
 * @license
 * Copyright 2024 Aglyn LLC
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
import { AglynNodeRenderer, Leaf } from '@aglyn/aglyn-node-renderer'
import * as Besigner from '@aglyn/besigner'
import { useAglynSiteTheme } from '@aglyn/aglyn-node-renderer'
import {
  MuiShadowDom,
  type MuiShadowRootProps,
  useMuiShadowDomContext,
} from '@aglyn/shared-ui-jsx'
import {
  styled,
  ThemeProvider,
  useHostThemeDocument,
} from '@aglyn/shared-ui-theme'
import { Box, type BoxProps, CssBaseline, GlobalStyles } from '@mui/material'
import { observer } from 'mobx-react-lite'
// import {MuiShadowDom} from '@aglyn/shared-ui-jsx'
import {
  type ComponentProps,
  forwardRef,
  HTMLAttributes,
  useCallback,
} from 'react'
import { useLayoutChromeContext } from '../contexts/layout-chrome-context'
import useAglynBesignerFlag from '../hooks/use-aglyn-besigner-flag'
import CanvasDropIndicator from './dnd/canvas-drop-indicator'
import NodeLeaf from './node-leaf'
import NodeOverlay from './node-overlay'

const ViewportFrame = styled('div', {
  name: 'AglynViewportFrame',
})(({ theme }) => {
  // In CSS vars mode, theme.palette.* is pinned to the static light-mode values.
  // Use (theme.vars || theme) so these resolve to CSS custom-property references
  // that update automatically when setMode() applies the .dark class.
  const t = theme as any
  const tv = t.vars || theme
  return {
    flexGrow: 1,
    minHeight: '100%',
    width: '100%',
    background: tv.palette.background.paper,
    borderColor: tv.palette.divider,
    borderWidth: `0.3em`,
    borderStyle: 'solid',
    display: 'flex',
    // position: 'relative',
  }
})
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
})<SiteShadowDomProps>(({ theme }) => {
  const tv = (theme as any).vars || theme
  return {
    // CssBaseline styles the document body, which a closed shadow root never
    // sees (and `:host { all: initial }` resets inheritance), so this surface
    // carries the body-level baseline itself.
    ...theme.typography.body1,
    color: tv.palette.text.primary,
    backgroundColor: tv.palette.background.default,
    colorScheme: theme.palette.mode,
    WebkitFontSmoothing: 'antialiased',
    MozOsxFontSmoothing: 'grayscale',
    height: '100%',
    width: '100%',
    [`> [data-aglyn="leaf\\:_@_"]`]: {
      minHeight: '100%',
      width: '100%',
    },
  }
})
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
  const hostThemeDoc = useHostThemeDocument()
  const [canvasScheme] = useAglynBesignerFlag('canvasScheme')
  const hostTheme = useAglynSiteTheme({
    container: shadowDom,
    theme: hostThemeDoc,
    scheme: canvasScheme,
  })
  return (
    <ThemeProvider theme={hostTheme}>
      <CssBaseline />
      {children}
    </ThemeProvider>
  )
}

const EditableScreenRenderer = observer(() => (
  <AglynNodeRenderer
    node={Aglyn.canvas.getNode(Aglyn.NODE_ROOT_ID)!}
    LeafComponent={NodeLeaf}
  />
))
EditableScreenRenderer.displayName = 'EditableScreenRenderer'

/**
 * Leaf for the read-only layout chrome tree: the LayoutSlot renders the
 * editable screen canvas after any chrome the designer left inside the slot
 * (matching composition semantics); everything else renders with the
 * production Leaf, which carries none of the designer's selection/dnd
 * behavior — the chrome is locked by construction.
 */
const LayoutChromeLeaf = forwardRef<any, any>((props, ref) => {
  const { node, children, ...rest } = props
  if (node?.componentId === Aglyn.LAYOUT_SLOT_COMPONENT_ID) {
    return (
      <Leaf ref={ref} node={node} {...rest}>
        {children}
        <EditableScreenRenderer />
      </Leaf>
    )
  }
  return (
    <Leaf ref={ref} node={node} {...rest}>
      {children}
    </Leaf>
  )
})
LayoutChromeLeaf.displayName = 'LayoutChromeLeaf'

const SiteContainer = observer(
  forwardRef<any, SiteShadowDomProps>((props, ref) => {
    const { ...rest } = props
    const { chromeCanvas } = useLayoutChromeContext()
    const chromeRoot = chromeCanvas?.getNode(Aglyn.NODE_ROOT_ID)
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
              {chromeRoot ? (
                <AglynNodeRenderer
                  node={chromeRoot}
                  LeafComponent={LayoutChromeLeaf}
                />
              ) : (
                <EditableScreenRenderer />
              )}
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
        // Above the canvas content, below the designer chrome (app bars and
        // breadcrumbs sit at zIndex.appBar) within the workspace context.
        zIndex: 10,
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
