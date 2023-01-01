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

import * as Besigner from '@aglyn/besigner'
import { LOADING_OVERLAY_ELEMENT, useForkedRefs } from '@aglyn/shared-ui-jsx'
import { generateComponentClassKeys, styled } from '@aglyn/shared-ui-theme'
import { _isFnT } from '@aglyn/shared-util-guards'
import {
  DragEndEvent,
  DragMoveEvent,
  DragStartEvent,
  useDndMonitor,
} from '@dnd-kit/core'
import { Stack } from '@mui/material'
import clsx from 'clsx'
import dynamic from 'next/dynamic'
import { ChangeEvent, forwardRef, useCallback, useRef } from 'react'
import { useMouse } from 'react-use'
import useAglynBesignerPanelValue from '../hooks/use-aglyn-besigner-panel-value'
import { determineDropRegion } from '../utils/droppable-region-utils'
import AppBarBreadcrumbsComponent from './app-bar-breadcrumbs.component'
import type { AsidePanelComponentProps } from './aside-panel.component'
import ViewportZoomControlsComponent from './viewport-zoom-controls.component'

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
  extends JSX.ComponentProps<typeof WorkspaceEditor> {}

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

    const pannerRef = useRef<any>()

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

    const localRef = useRef()
    const mouse = useMouse(localRef)

    useDndMonitor({
      onDragMove(event: DragMoveEvent): void {
        event.activatorEvent.stopPropagation()
        let region: any = null
        if (event.over) {
          region = determineDropRegion(event.over.rect, mouse.docX, mouse.docY)
          event.over.data.current.region = region
        }
        Besigner.dnd.setDropRegion(region)
        Besigner.dnd.setDropNode(event.over?.data.current.node)
      },
      onDragStart({ active }: DragStartEvent) {
        const node = active?.data.current.node
        console.log('handleDragStart', node)
        Besigner.dnd.setDragNode(node)
      },
      onDragEnd(e: DragEndEvent) {
        e.activatorEvent.stopPropagation()
        const dragNode = e.active?.data.current
        const dropNode = e.over?.data.current
        console.log('handleDragEnd dragNode', dragNode)
        console.log('handleDragEnd dropNode', dropNode)
        console.log('handleDragEnd collisions', e.collisions)
        Besigner.dnd.clearDndStatus()
      },
    })

    return (
      <WorkspaceEditor
        ref={useForkedRefs(ref, localRef)}
        id="aglyn:besigner-workspace"
        className={elemClassName}
        {...rest}
      >
        <Stack
          direction="row"
          alignItems="stretch"
          justifyContent="space-between"
          id="aglyn:besigner-main"
          component="main"
          flexGrow={1}
          spacing={0}
          sx={{ overflow: 'hidden', zIndex: 0 }}
        >
          <PanelLeftComponent panel={'panelLeft'} />
          <Stack
            direction="column"
            alignItems="stretch"
            justifyContent="space-between"
            id="aglyn:besigner-viewport"
            component="main"
            flexGrow={1}
            spacing={0}
            sx={{ overflow: 'hidden', zIndex: 0 }}
          >
            {children}
            <ViewportZoomControlsComponent
              onZoomReset={handleZoomReset}
              onZoomDecrease={handleZoomDecrease}
              onZoomIncrease={handleZoomIncrease}
            />
            <AppBarBreadcrumbsComponent />
          </Stack>
          <PanelLeftComponent panel={'panelRight'} />
        </Stack>
      </WorkspaceEditor>
    )
  },
)

WorkspaceEditorComponent.displayName = 'WorkspaceEditorComponent'
WorkspaceEditorComponent.aglyn = true
WorkspaceEditorComponent.defaultProps = {}

export { WorkspaceEditorComponent }
export default WorkspaceEditorComponent
