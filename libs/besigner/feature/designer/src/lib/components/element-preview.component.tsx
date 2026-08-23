/**
 * @license
 * Copyright 2026 Aglyn LLC
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
import { AglynNodeRenderer, useAglynSiteTheme } from '@aglyn/aglyn-node-renderer'
import {
  MuiShadowDom,
  type MuiShadowRootProps,
  useMuiShadowDomContext,
} from '@aglyn/shared-ui-jsx'
import { ThemeProvider, useHostThemeDocument } from '@aglyn/shared-ui-theme'
import { Box, GlobalStyles } from '@mui/material'
import { observer } from 'mobx-react-lite'
import {
  type HTMLAttributes,
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'

/**
 * The width the preview composes at, before it is scaled down to fit.
 *
 * Elements are authored for a page, not for a thumbnail: a Hero centres a
 * headline across a viewport and a Footer lays out four columns. Composing at
 * a phone width and calling it a preview would show neither. So it renders at
 * a desktop width and the whole stage is scaled — the proportions the element
 * was designed for survive, just smaller.
 */
const STAGE_WIDTH = 1280

/** Never blow a small element up past life size; only ever scale down. */
const MAX_SCALE = 1

/** Below this a preview is a smudge; better to show a short empty band. */
const MIN_HEIGHT = 40

export interface ElementPreviewProps {
  /** The picker item — a preset in both drawers. */
  node: any
  /** Bounded height of the preview box in CSS pixels. */
  height?: number
}

/**
 * Renders the preset's own nodes into an isolated stage, so a picker shows
 * what an element LOOKS like and not only what it is called (AGL-2486).
 *
 * Three things this must never do, each of which is a real hazard rather than
 * a hypothetical one:
 *
 * 1. **Touch `Aglyn.canvas`.** That singleton holds the document being
 *    edited; the console's Preview route calls `setNodes` on it, and doing
 *    the same here would blow away the user's screen to draw a thumbnail.
 *    Every preview gets its own `CanvasManager`, backed by the real app so
 *    component schemas still resolve — the pattern `useLayoutChromeCanvas`
 *    already uses for locked layout chrome.
 * 2. **Mutate anything from inside.** The stage is inert: pointer events are
 *    off, the subtree is marked `inert` so nothing in it is focusable or
 *    clickable, links are told not to navigate, and `SiteContext.preview`
 *    turns every write into a synthetic 423.
 * 3. **Escape its box.** The stage is scaled to fit and clipped, so a Footer
 *    cannot push Confirm off the dialog or stretch the docked column.
 *
 * Elements that cannot render standalone — a Cart, a Product grid, anything
 * reading site data — are NOT special-cased here. Deliberately: they already
 * render their own dashed "Cart — lines render here" placeholder when there
 * is no `hostId`, and this preview does not supply one. That placeholder is
 * the honest answer to "what will I get", and it means the picker needs no
 * second list of which elements are self-contained: each element already
 * says so itself.
 */
export const ElementPreview = observer((props: ElementPreviewProps) => {
  const { node, height = 160 } = props
  const hostThemeDoc = useHostThemeDocument()

  // A throwaway store per preset. Never the global canvas.
  const canvas = useMemo(() => {
    const data = node?.data
    if (!data) return undefined
    try {
      const store = new Aglyn.CanvasManager(Aglyn.aglyn)
      // Seed an empty root, then insert through the SAME path the drawer
      // uses. Handing `preset.data` straight to `processNodesToDenormalized`
      // looks equivalent and is not: it keys nodes by `$id` and maps each
      // child to `i.$id`, and a preset's nodes carry `$id: null` until they
      // are minted — so every child was filtered out and the preview drew an
      // empty root. `addNodeFromPreset` runs `createDuplicateNode` first,
      // which is what assigns them.
      store.setNodes(
        store.processNodesToDenormalized([
          { $id: Aglyn.NODE_ROOT_ID, componentId: 'div', nodes: [] } as any,
        ]),
      )
      const rootNode = store.getNode(Aglyn.NODE_ROOT_ID)
      store.addNodeFromPreset(node, rootNode)
      return store
    } catch (error) {
      // A preset the renderer cannot compose must cost the picker nothing.
      console.error('Element preview failed to compose', error)
      return undefined
    }
  }, [node])

  const root = canvas?.getNode(Aglyn.NODE_ROOT_ID)

  // Hoisted above the early return — every hook this component calls has to
  // run on every render, including the one where there is nothing to draw.
  const siteValue = useMemo(() => ({ preview: true }), [])
  const linkValue = useMemo(() => ({ suppressNavigation: true }), [])

  const boxRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const [scale, setScale] = useState(0)
  // The box shrinks to the SCALED CONTENT rather than standing at its cap.
  // Most elements are wide and short — a Nav Bar is 1280x70 — so scaling to
  // the column width leaves a ~12px strip, and a fixed-height box renders it
  // as a sliver marooned at the top of a white rectangle. Measured, not
  // assumed: the content decides, the cap only stops a Footer running away.
  const [contentHeight, setContentHeight] = useState(0)

  useLayoutEffect(() => {
    const box = boxRef.current
    if (!box) return
    const fit = () => {
      const width = box.clientWidth
      if (width) setScale(Math.min(MAX_SCALE, width / STAGE_WIDTH))
      const natural = contentRef.current?.scrollHeight
      if (natural) setContentHeight(natural)
    }
    fit()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(fit)
    observer.observe(box)
    if (contentRef.current) observer.observe(contentRef.current)
    return () => observer.disconnect()
  }, [root])

  if (!root) return null

  // Below MIN_HEIGHT there is nothing to look at; above `height` a tall
  // element is clipped rather than allowed to grow the surface.
  const scaledHeight = contentHeight
    ? Math.max(MIN_HEIGHT, Math.min(height, Math.ceil(contentHeight * scale)))
    : height

  return (
    <Box
      ref={boxRef}
      data-testid="element-preview"
      aria-hidden
      sx={{
        position: 'relative',
        width: 1,
        height: scaledHeight,
        overflow: 'hidden',
        borderRadius: 1,
        border: 1,
        borderColor: 'divider',
        backgroundColor: 'background.paper',
        // Belt to the `inert` brace below: nothing in a picker preview is
        // clickable, draggable or selectable.
        pointerEvents: 'none',
        userSelect: 'none',
      }}
    >
      <InertStage>
        <Box
          ref={contentRef}
          sx={{
            width: STAGE_WIDTH,
            transform: `scale(${scale})`,
            transformOrigin: 'top left',
          }}
        >
          {/* The host needs its own box. `:host { all: initial }` inside the
              shadow root resets the host's display to `inline`, and an inline
              box with no intrinsic size collapses the whole preview to
              nothing — the canvas viewport never hits this because its host
              is a styled component carrying width and min-height. Outer
              styles beat `:host`, so setting it here is what wins. */}
          {/* Open, unlike the canvas viewport's closed root: the canvas
              closes it to keep the editor's own tooling from reaching in and
              treating site DOM as editable, and none of that applies to an
              inert thumbnail. Open is inspectable and testable. */}
          <PreviewShadowDom
            mode="open"
            data-preview-root
            style={{ display: 'block', width: '100%' }}
          >
            <Aglyn.SiteContext.Provider
              // No `hostId`: data-backed elements take their own placeholder
              // branch rather than fetching a site's real content into a
              // thumbnail. `preview` additionally 423s any write.
              value={siteValue}
            >
              <Aglyn.ScreenLinkContext.Provider
                value={linkValue}
              >
                <PreviewThemed hostThemeDoc={hostThemeDoc}>
                  <AglynNodeRenderer node={root} />
                </PreviewThemed>
              </Aglyn.ScreenLinkContext.Provider>
            </Aglyn.SiteContext.Provider>
          </PreviewShadowDom>
        </Box>
      </InertStage>
    </Box>
  )
})
ElementPreview.displayName = 'ElementPreview'

/**
 * Marks the subtree `inert` through the DOM property rather than the JSX
 * attribute, which React has spelled differently across versions. Nothing
 * inside can take focus, be clicked, or be found by a page search.
 */
function InertStage({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (ref.current) (ref.current as any).inert = true
  }, [])
  return <div ref={ref}>{children}</div>
}

// `MuiShadowDom` is a proxy whose members type loosely; the canvas viewport
// reaches the same shape through `styled()`.
const PreviewShadowDom = MuiShadowDom.div as unknown as React.FC<
  HTMLAttributes<HTMLDivElement> & MuiShadowRootProps
>

/**
 * The site theme, scoped to the shadow root so MUI's own styles — and any
 * portal the element opens — stay inside the preview.
 */
function PreviewThemed({ hostThemeDoc, children }: any) {
  const shadowDom = useMuiShadowDomContext()
  const theme = useAglynSiteTheme({
    container: shadowDom,
    theme: hostThemeDoc,
    scheme: 'light',
  })
  return (
    <ThemeProvider theme={theme}>
      {/* `:host { all: initial }` cuts the console's inherited styles, which
          means the body-level baseline never arrives either — so the stage
          carries it, exactly as the canvas viewport does. */}
      <GlobalStyles styles={{ ':host': { all: 'initial' } }} />
      <Box
        sx={{
          ...(theme.typography as any).body1,
          color: 'text.primary',
          backgroundColor: 'background.default',
          width: 1,
        }}
      >
        {children}
      </Box>
    </ThemeProvider>
  )
}

export default ElementPreview
