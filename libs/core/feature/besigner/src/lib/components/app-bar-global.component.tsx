/**
 * @license
 * Copyright 2021 Aglyn LLC
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

import { styled } from '@aglyn/shared-feature-themes'
import { AglynSvgAppIcon } from '@aglyn/shared-ui-jsx'
import AppBar, { AppBarProps } from '@mui/material/AppBar'
import Toolbar from '@mui/material/Toolbar'
import Typography from '@mui/material/Typography'
import { forwardRef } from 'react'

const GlobalAppBar = styled(AppBar, { name: 'AglynGlobalAppBar' })(({ theme }) => ({
  top: 0,
  // backgroundColor: theme.palette.background.paper,
  borderBottom: `1px solid ${theme.palette.divider}`,
}))

export interface AppBarGlobalComponentProps extends Partial<AppBarProps> {}

export const AppBarGlobalComponent = forwardRef<any, AppBarGlobalComponentProps>(
  function RefRenderFn(props, ref) {
    const { children, ...rest } = props

    return (
      <GlobalAppBar ref={ref} position="static" color="inherit" elevation={0} {...rest}>
        <Toolbar>
          <AglynSvgAppIcon sx={{ ml: -1.5, mr: 1 }} fontSize="large" />
          <Typography variant="h4">besigner</Typography>
          {children}
        </Toolbar>
      </GlobalAppBar>
    )
  }
)

AppBarGlobalComponent.displayName = 'AppBarGlobalComponent'
AppBarGlobalComponent.defaultProps = {}

export default AppBarGlobalComponent
