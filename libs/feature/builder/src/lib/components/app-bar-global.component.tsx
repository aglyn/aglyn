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
import Divider from '@mui/material/Divider'
import Toolbar from '@mui/material/Toolbar'
import Typography from '@mui/material/Typography'
import { forwardRef } from 'react'


const StyledGlobalAppBar = styled(AppBar, {name: 'StyledGlobalAppBar'})({
  top: 0,
})

export interface AppBarGlobalComponentProps extends Partial<AppBarProps> {}

export const AppBarGlobalComponent = forwardRef<any, AppBarGlobalComponentProps>(
  function RefRenderFn(props, ref) {
    const {children, ...rest} = props

    return (
      <StyledGlobalAppBar
        ref={ref}
        position="static"
        color="secondary"
        elevation={0}
        {...rest}
      >
        <Toolbar>
          <AglynSvgAppIcon sx={{ml: -1.5, mr: 1}} fontSize="large" />
          <Typography variant="h4">
            Besigner
          </Typography>
          {children}
        </Toolbar>
        <Divider />
      </StyledGlobalAppBar>
    )
  },
)

AppBarGlobalComponent.displayName = 'AppBarGlobalComponent'
AppBarGlobalComponent.defaultProps = {}

export default AppBarGlobalComponent
