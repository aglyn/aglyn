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

import { mergeSxProps } from '@aglyn/shared-ui-theme'
import {
  AppBar as MuiAppBar,
  type AppBarProps as MuiAppBarProps,
  Stack,
  Toolbar as MuiToolbar,
} from '@mui/material'
import { forwardRef } from 'react'
import AddControlsComponent from './add-controls.component'
import DevicePreviewControlsComponent from './device-preview-controls.component'
import HistoryControlsComponent from './history-controls.component'
import InteractControlsComponent from './interact-controls.component'
import PanelControlsComponent from './panel-controls.component'

export interface AppBarSecondaryComponentProps extends Partial<MuiAppBarProps> {}

const AppBarSecondaryComponent = forwardRef<any, AppBarSecondaryComponentProps>(
  function RefRenderFn(props, ref) {
    const { children, sx, ...rest } = props

    return (
      <MuiAppBar
        ref={ref}
        id="aglyn:besigner-appbar-secondary"
        aria-label="secondary app toolbar"
        position="static"
        color="inherit"
        component="header"
        elevation={0}
        sx={mergeSxProps(
          {
            top: 0,
            borderBottomWidth: '1px',
            borderBottomStyle: 'solid',
            borderBottomColor: 'divider',
            [`& .MuiToolbar-root`]: { minHeight: 40 },
          },
          sx
        )}
        {...rest}
      >
        <MuiToolbar variant="dense" sx={{ pr: { xs: 2, sm: 2 } }}>
          <Stack
            direction="row"
            alignItems="center"
            justifyContent="space-between"
            width={1}
            spacing={1}
          >
            <AddControlsComponent />
            <HistoryControlsComponent sx={{ flexGrow: 1 }} />
            <DevicePreviewControlsComponent />
            {/*<InteractControlsComponent />*/}
            <PanelControlsComponent />
            {children}
          </Stack>
        </MuiToolbar>
      </MuiAppBar>
    )
  }
)

AppBarSecondaryComponent.displayName = 'AppBarSecondaryComponent'
AppBarSecondaryComponent.aglyn = true
AppBarSecondaryComponent.defaultProps = {}

export { AppBarSecondaryComponent }
export default AppBarSecondaryComponent
