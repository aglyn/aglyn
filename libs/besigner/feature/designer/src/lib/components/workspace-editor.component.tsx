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

import * as Besigner from '@aglyn/besigner'
import { LOADING_OVERLAY_ELEMENT, useMergeRefs } from '@aglyn/shared-ui-jsx'
import { generateComponentClassKeys, styled } from '@aglyn/shared-ui-theme'
import { _isFnT } from '@aglyn/shared-util-tools'
import {
  DragEndEvent,
  DragMoveEvent,
  DragStartEvent,
  useDndMonitor,
} from '@dnd-kit/core'
import { Stack } from '@mui/material'
import clsx from 'clsx'
import dynamic from 'next/dynamic'
import type { ComponentProps } from 'react'
import { ChangeEvent, forwardRef, useCallback, useRef } from 'react'
import { useMouse } from 'react-use'
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

    const [leftToggled] = useAglynBesignerPanelValue('panelLeft', 'toggled')
    const [rightToggled] = useAglynBesignerPanelValue('panelRight', 'toggled')
    const [bottomToggled] = useAglynBesignerPanelValue('panelBottom', 'toggled')

    const elemClassName = clsx(
      {
        [classKeys.panelLeftOpen]: Boolean(leftToggled),
        [classKeys.panelRightOpen]: Boolean(rightToggled),
        [classKeys.panelBottomOpen]: Boolean(bottomToggled),
      },
      className,
    )

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
    const mouse = useMouse(localRef)

    useDndMonitor({
      onDragMove(event: DragMoveEvent): void {
        let region: Besigner.DropRegion = null
        if (event.over) {
          region = Besigner.determineDropRegion(
            event.over.rect,
            mouse.docX,
            mouse.docY,
          )
          event.over.data.current.region = region
        }
        Besigner.dnd.setDropRegion(region)
        Besigner.dnd.setDropNode(event.over?.data.current.node)

        event.activatorEvent.stopPropagation()
      },
      onDragStart({ active }: DragStartEvent) {
        const node = active?.data.current.node
        Besigner.dnd.setDragNode(node)
      },
      onDragEnd(e: DragEndEvent) {
        e.activatorEvent.stopPropagation()
        return Besigner.dnd.onDragEnd()
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
