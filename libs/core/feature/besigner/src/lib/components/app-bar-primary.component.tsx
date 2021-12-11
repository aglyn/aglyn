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
import { AglynSvgIcon, BesignerSvgLogo } from '@aglyn/shared-ui-jsx'
import AppBar, { AppBarProps } from '@mui/material/AppBar'
import Toolbar from '@mui/material/Toolbar'
import { forwardRef } from 'react'

const AppBarPrimary = styled(AppBar, {
  name: 'AglynAppBarPrimary'
})(({ theme }) => ({
  top: 0,
  // backgroundColor: theme.palette.background.paper,
  borderBottom: `1px solid ${theme.palette.divider}`,
}))

export interface AppBarPrimaryComponentProps extends Partial<AppBarProps> {}

export const AppBarPrimaryComponent = forwardRef<any, AppBarPrimaryComponentProps>(
  function RefRenderFn(props, ref) {
    const { children, ...rest } = props

    return (
      <AppBarPrimary
        ref={ref}
        position="static"
        color="inherit"
        elevation={0}
        {...rest}
      >
        <Toolbar>
          <AglynSvgIcon
            sx={(theme) => ({
              borderRadius: theme.shape.appIconBorderRadius,
              // boxShadow: theme.shadows[1],
              ml: -1.5, mr: 0.5,
              fontSize: `1.75em`
            })}
          />
          <BesignerSvgLogo
            sx={{width:'auto'}}
            fontSize="medium"
            color="primary"
          />
          {children}
        </Toolbar>
      </AppBarPrimary>
    )
  }
)

AppBarPrimaryComponent.displayName = 'AppBarPrimaryComponent'
AppBarPrimaryComponent.defaultProps = {}

export default AppBarPrimaryComponent
