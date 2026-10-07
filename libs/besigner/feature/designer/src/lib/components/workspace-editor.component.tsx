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

import { canvas } from '@aglyn/aglyn'
import * as Besigner from '@aglyn/besigner'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import { useMergeRefs } from '@aglyn/shared-ui-jsx'
import { LOADING_OVERLAY_ELEMENT } from '@aglyn/shared-ui-jsx/const/prebuilt-components'
import { generateComponentClassKeys, styled } from '@aglyn/shared-ui-theme'
import { _isFnT } from '@aglyn/shared-util-tools'
import {
  DragEndEvent,
  DragMoveEvent,
  DragStartEvent,
  useDndMonitor,
} from '@dnd-kit/core'
import { getEventCoordinates } from '@dnd-kit/utilities'
import { Stack, useMediaQuery, useTheme } from '@mui/material'
import clsx from 'clsx'
import dynamic from 'next/dynamic'
import type { ComponentProps } from 'react'
import { ChangeEvent, forwardRef, useCallback, useEffect, useRef } from 'react'
import useAglynBesignerPanelValue from '../hooks/use-aglyn-besigner-panel-value'
import AppBarBreadcrumbsComponent from './app-bar-breadcrumbs.component'
import type { AsidePanelComponentProps } from './aside-panel.component'
import ViewportZoomControls from './viewport-zoom-controls'

const classKeys = generateComponentClassKeys('AglynViewport', [
  'panelLeftOpen',
  'panelBottomOpen',
  'panelRightOpen',
])
const PanelLeftComponent = dynamic<AsidePanelComponentProps>(
  () =>
    import('./aside-panel.component').then((mod) => mod.AsidePanelComponent),
  { ssr: false, loading: () => LOADING_OVERLAY_ELEMENT },
)

type ClientPoint = { x: number; y: number }

/**
 * The last viewport-relative position of whatever is pointing — mouse, pen or
 * finger. Kept in a ref rather than state: it is read once per drag move, and
 * re-rendering the whole workspace on every pointer move bought nothing.
 *
 * Touch needs `touchmove` as well as `pointermove`: once a touch drag is
 * active the sensor cancels the touch's default action, and some browsers
 * stop reporting that finger as a pointer from then on.
 */
function useLastClientPoint() {
  const point = useRef<ClientPoint | null>(null)
  useEffect(() => {
    const onPointer = (e: PointerEvent) => {
      point.current = { x: e.clientX, y: e.clientY }
    }
    const onTouch = (e: TouchEvent) => {
      const touch = e.touches[0]
      if (touch) point.current = { x: touch.clientX, y: touch.clientY }
    }
    const options = { capture: true, passive: true }
    document.addEventListener('pointerdown', onPointer, options)
    document.addEventListener('pointermove', onPointer, options)
    document.addEventListener('touchstart', onTouch, options)
    document.addEventListener('touchmove', onTouch, options)
    return () => {
      document.removeEventListener('pointerdown', onPointer, options)
      document.removeEventListener('pointermove', onPointer, options)
      document.removeEventListener('touchstart', onTouch, options)
      document.removeEventListener('touchmove', onTouch, options)
    }
  }, [])
  return point
}

const WorkspaceEditor = styled('div', {
  name: 'AglynWorkspaceEditor',
})({
  // position: 'absolute',
  left: 0,
  right: 0,
  top: 0,
  bottom: 0,
  height: '100%',
  width: '100%',
  overflow: 'hidden',
  display: 'flex',
  flexDirection: 'column',
  alignContent: 'stretch',
  alignItems: 'stretch',
  [`&.${classKeys.panelLeftOpen}`]: {},
  [`&.${classKeys.panelBottomOpen}`]: {},
  [`&.${classKeys.panelRightOpen}`]: {},
})

export interface WorkspaceEditorComponentProps
  extends ComponentProps<typeof WorkspaceEditor> {}

const WorkspaceEditorComponent = forwardRef<any, WorkspaceEditorComponentProps>(
  (props, ref) => {
    const { children, className, ...rest } = props

    const [leftToggled, setLeftToggled] = useAglynBesignerPanelValue(
      'panelLeft',
      'toggled',
    )
    const [rightToggled, setRightToggled] = useAglynBesignerPanelValue(
      'panelRight',
      'toggled',
    )
    const [bottomToggled] = useAglynBesignerPanelValue('panelBottom', 'toggled')

    const elemClassName = clsx(
      {
        [classKeys.panelLeftOpen]: Boolean(leftToggled),
        [classKeys.panelRightOpen]: Boolean(rightToggled),
        [classKeys.panelBottomOpen]: Boolean(bottomToggled),
      },
      className,
    )

    // Below `md` the panels overlay the canvas (see AsidePanelComponent), so
    // the open-by-default a docked panel gets would greet a phone with a
    // covered canvas. They start closed there, and the toolbar opens them.
    // Only the live panel state changes — the defaults a wide screen starts
    // from are untouched.
    const theme = useTheme()
    const compact = useMediaQuery(theme.breakpoints.down('md'), {
      noSsr: true,
    })
    const closedForCompact = useRef(false)
    useEffect(() => {
      if (!compact) {
        closedForCompact.current = false
        return
      }
      if (closedForCompact.current) return
      closedForCompact.current = true
      setLeftToggled(false)
      setRightToggled(false)
      // The setters are rebuilt every render; the guard is what matters.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [compact])

    // Two overlays at once is one hidden behind the other, so below `md`
    // opening a panel closes the one that was already open.
    const lastToggled = useRef({ left: leftToggled, right: rightToggled })
    useEffect(() => {
      const last = lastToggled.current
      lastToggled.current = { left: leftToggled, right: rightToggled }
      if (!compact || !leftToggled || !rightToggled) return
      if (last.left) setLeftToggled(false)
      else setRightToggled(false)
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [compact, leftToggled, rightToggled])

    const pannerRef = useRef<any>(null)

    const handleZoomReset = useCallback((e: ChangeEvent<unknown>) => {
      if (_isFnT(pannerRef.current?.reset)) {
        pannerRef.current.reset()
      }
    }, [])

    const handleZoomDecrease = useCallback((e: ChangeEvent<unknown>) => {
      if (_isFnT(pannerRef.current?.zoomOut)) {
        pannerRef.current.zoomOut()
      }
    }, [])

    const handleZoomIncrease = useCallback((e: ChangeEvent<unknown>) => {
      if (_isFnT(pannerRef.current?.zoomIn)) {
        pannerRef.current.zoomIn()
      }
    }, [])

    const localRef = useRef(null)
    const pointer = useLastClientPoint()
    // Null-safe: surfaces render without a snackbar provider in tests.
    const { enqueueSnackbar } = useSnackbar() ?? {}

    useDndMonitor({
      onDragMove(event: DragMoveEvent): void {
        let region: Besigner.DropRegion = null
        // A keyboard drag has no pointer of its own; it keeps reading the
        // last place the pointer was, as it always has.
        const at = pointer.current
        if (event.over && at) {
          // Both viewport-relative: dnd-kit rects and client coordinates.
          const overNode = event.over.data.current?.node
          region = Besigner.determineDropRegion(
            event.over.rect,
            at.x,
            at.y,
            // Leaves (self-closing / text-editable) never offer a CHILDREN
            // region — the center reads as a sibling insert, matching where
            // the drop actually lands (see dnd-manager onDragEnd).
            overNode ? canvas.nodeAcceptsChildren(overNode) : true,
          )
          event.over.data.current.region = region
        }
        Besigner.dnd.setDropRegion(region)
        Besigner.dnd.setDropNode(event.over?.data.current.node)

        event.activatorEvent.stopPropagation()
      },
      onDragStart({ active, activatorEvent }: DragStartEvent) {
        // The gesture that started the drag is the freshest position there
        // is — a touch hold may not have moved since it went down.
        const start = getEventCoordinates(activatorEvent)
        if (start) pointer.current = start
        const node = active?.data.current.node
        Besigner.dnd.setDragNode(node)
      },
      onDragEnd(e: DragEndEvent) {
        e.activatorEvent.stopPropagation()
        // Compute before completing the drag — onDragEnd clears dnd state.
        const rejection = Besigner.dnd.describeDropRejection()
        Besigner.dnd.onDragEnd()
        if (rejection) {
          enqueueSnackbar?.(rejection, { variant: 'warning', persist: false })
        }
      },
    })

    return (
      <WorkspaceEditor
        ref={useMergeRefs(ref, localRef)}
        id="aglyn:besigner-workspace"
        className={elemClassName}
        {...rest}
      >
        <Stack
          direction="row"
          id="aglyn:besigner-main"
          component="main"
          spacing={0}
          sx={{
            alignItems: "stretch",
            justifyContent: "space-between",
            flexGrow: 1,
            overflow: 'hidden',
            zIndex: 0
          }}>
          <PanelLeftComponent panel={'panelLeft'} />
          <Stack
            direction="column"
            id="aglyn:besigner-viewport"
            component="main"
            spacing={0}
            sx={{
              alignItems: "stretch",
              justifyContent: "space-between",
              flexGrow: 1,
              overflow: 'hidden',
              zIndex: 0
            }}>
            {children}
            <ViewportZoomControls
              onZoomReset={handleZoomReset}
              onZoomDecrease={handleZoomDecrease}
              onZoomIncrease={handleZoomIncrease}
            />
            <AppBarBreadcrumbsComponent />
          </Stack>
          <PanelLeftComponent panel={'panelRight'} />
        </Stack>
      </WorkspaceEditor>
    );
  },
)

WorkspaceEditorComponent.displayName = 'WorkspaceEditorComponent'

export { WorkspaceEditorComponent }
export default WorkspaceEditorComponent
