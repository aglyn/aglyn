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

import {LOADING_OVERLAY_ELEMENT} from '@aglyn/shared-ui-jsx'
import {styled} from '@aglyn/shared-ui-theme'
import {Stack, type StackProps} from '@mui/material'
import dynamic from 'next/dynamic'
import {forwardRef} from 'react'
import AppBarBreadcrumbsComponent from './app-bar-breadcrumbs.component'
import AppBarSecondaryComponent from './app-bar-secondary.component'
import type {AsidePanelComponentProps} from './aside-panel.component'


const PanelLeftComponent = dynamic<AsidePanelComponentProps>(
  () => import('./aside-panel.component').then((mod) => mod.AsidePanelComponent),
  {ssr: false, loading: () => LOADING_OVERLAY_ELEMENT},
)

const ViewportRootComponent = dynamic(
  () => import('./viewport-root.component').then((mod) => mod.ViewportRootComponent),
  {ssr: false, loading: () => LOADING_OVERLAY_ELEMENT},
)

const WorkspaceEditor = styled(Stack, {
  name: 'AglynWorkspaceEditor',
})({
  position: 'absolute',
  left: 0,
  right: 0,
  top: 0,
  bottom: 0,
  height: '100%',
  width: '100%',
  overflow: 'hidden',
})

export interface WorkspaceEditorComponentProps extends StackProps {}

const WorkspaceEditorComponent = forwardRef<any, WorkspaceEditorComponentProps>(
  function RefRenderFn(props, ref) {
    const {children, ...rest} = props

    return (
      <WorkspaceEditor
        ref={ref}
        id="aglyn:besigner-workspace"
        direction="column"
        alignContent="stretch"
        alignItems="stretch"
        spacing={0}
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
          sx={{overflow: 'hidden', zIndex: 0}}
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
            sx={{overflow: 'hidden', zIndex: 0}}
          >
            <AppBarSecondaryComponent />

            <ViewportRootComponent />

            <AppBarBreadcrumbsComponent />
          </Stack>

          <PanelLeftComponent panel={'panelRight'} />
        </Stack>

        {children}
      </WorkspaceEditor>
    )
  },
)

WorkspaceEditorComponent.displayName = 'WorkspaceEditorComponent'
WorkspaceEditorComponent.aglyn = true
WorkspaceEditorComponent.defaultProps = {}

export {WorkspaceEditorComponent}
export default WorkspaceEditorComponent
