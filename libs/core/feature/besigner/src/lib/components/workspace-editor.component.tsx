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

import {styled} from '@aglyn/shared-feature-themes'
import Stack, {type StackProps} from '@mui/material/Stack'
import {forwardRef} from 'react'
import AppBarPrimaryComponent from './app-bar-primary.component'
import AppBarSecondaryComponent from './app-bar-secondary.component'
import PanelLeftComponent from './panel-left.component'
import PanelRightComponent from './panel-right.component'
import ViewportRootComponent from './viewport-root.component'


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
          direction="column"
          justifyContent="flex-start"
          alignItems="stretch"
          id="aglyn:besigner-header"
          spacing={0}
          sx={{
            zIndex: 1,
          }}
        >
          <AppBarPrimaryComponent />
          <AppBarSecondaryComponent />
        </Stack>

        <Stack
          direction="row"
          alignItems="stretch"
          flexGrow={1}
          spacing={0}
          id="aglyn:besigner-main"
          sx={{
            overflow: 'hidden',
            zIndex: 0,
          }}
        >
          <PanelLeftComponent />

          <ViewportRootComponent />

          <PanelRightComponent />
        </Stack>

        {children}
      </WorkspaceEditor>
    )
  },
)

WorkspaceEditorComponent.displayName = 'WorkspaceEditorComponent'
WorkspaceEditorComponent.defaultProps = {}

export {WorkspaceEditorComponent}
export default WorkspaceEditorComponent
