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
import {
  AppBar as MuiAppBar,
  type AppBarProps as MuiAppBarProps,
  Box,
  Toolbar as MuiToolbar,
} from '@mui/material'
import {forwardRef} from 'react'
import AddControlsComponent from './add-controls.component'
import DevicePreviewControlsComponent from './device-preview-controls.component'
import HistoryControlsComponent from './history-controls.component'
import InteractControlsComponent from './interact-controls.component'
import PanelControlsComponent from './panel-controls.component'


const AppBarSecondary = styled(MuiAppBar, {
  name: 'AglynAppBarSecondary',
})<MuiAppBarProps>(({theme}) => ({
  top: 0,
  borderBottom: `1px solid ${theme.palette.divider}`,
  [`& .MuiToolbar-root`]: {
    minHeight: 40,
  },
}))

export interface AppBarSecondaryComponentProps extends Partial<MuiAppBarProps> {}

const AppBarSecondaryComponent = forwardRef<any, AppBarSecondaryComponentProps>(
  function RefRenderFn(props, ref) {
    const {children, ...rest} = props

    return (
      <AppBarSecondary
        ref={ref}
        id="aglyn:besigner-appbar-secondary"
        aria-label="secondary app toolbar"
        position="static"
        color="inherit"
        elevation={0}
        {...rest}
      >
        <MuiToolbar variant="dense">
          <AddControlsComponent />

          <Box sx={{mx: 0.25}} />

          <HistoryControlsComponent />

          <Box sx={{flexGrow: 1}} />

          <DevicePreviewControlsComponent />

          <Box sx={{mx: 1}} />

          <InteractControlsComponent />

          <Box sx={{mx: 1}} />

          <PanelControlsComponent />

          {children}
        </MuiToolbar>
      </AppBarSecondary>
    )
  },
)

AppBarSecondaryComponent.displayName = 'AppBarSecondaryComponent'
AppBarSecondaryComponent.defaultProps = {}

export {AppBarSecondaryComponent}
export default AppBarSecondaryComponent
