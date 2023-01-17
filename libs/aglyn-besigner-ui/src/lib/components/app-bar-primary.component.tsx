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

import {
  ICON_VARIANT_THEME_DARK,
  ICON_VARIANT_THEME_LIGHT,
  ICON_VARIANT_THEME_SYSTEM,
} from '@aglyn/shared-data-enums'
import { AglynSvgIcon, BesignerSvgLogo } from '@aglyn/shared-ui-jsx'
import { MdiIcon } from '@aglyn/shared-ui-mdi-jsx'
import {
  getThemeModeDisplayName,
  styled,
  useThemeMode,
} from '@aglyn/shared-ui-theme'
import AppBar, { type AppBarProps } from '@mui/material/AppBar'
import Box from '@mui/material/Box'
import MuiIconButton from '@mui/material/IconButton'
import Toolbar from '@mui/material/Toolbar'
import MuiTooltip from '@mui/material/Tooltip'
import { forwardRef } from 'react'

const AppBarPrimary = styled(AppBar, {
  name: 'AglynAppBarPrimary',
})(({ theme }) => ({
  top: 0,
  // backgroundColor: theme.palette.background.paper,
  borderBottom: `1px solid ${theme.palette.divider}`,
}))

export interface AppBarPrimaryComponentProps extends Partial<AppBarProps> {}

export const AppBarPrimaryComponent = forwardRef<
  any,
  AppBarPrimaryComponentProps
>((props, ref) => {
  const { children, ...rest } = props
  const [, toggleThemeMode, themeMode] = useThemeMode()
  const themeModeDisplayName = getThemeModeDisplayName(themeMode)

  return (
    <AppBarPrimary
      ref={ref}
      id="aglyn:besigner-appbar-primary"
      aria-label="primary app toolbar"
      position="static"
      color="surface"
      elevation={0}
      {...rest}
    >
      <Toolbar>
        <AglynSvgIcon
          sx={{
            fontSize: `1.75em`,
            borderRadius: (theme) => theme.shape.appIconBorderRadius,
            // boxShadow: theme.shadows[1],
            ml: -1.5,
            mr: 0.75,
          }}
        />
        <BesignerSvgLogo
          sx={{ width: 'auto' }}
          fontSize="medium"
          color="inherit"
        />
        <Box sx={{ flexGrow: 1 }} />
        <MuiTooltip
          aria-label="switch theme mode"
          title={`${themeModeDisplayName} theme`}
        >
          <MuiIconButton onClick={toggleThemeMode}>
            <MdiIcon
              path={
                themeMode === 'dark'
                  ? ICON_VARIANT_THEME_DARK.path
                  : themeMode === 'light'
                  ? ICON_VARIANT_THEME_LIGHT.path
                  : ICON_VARIANT_THEME_SYSTEM.path
              }
            />
          </MuiIconButton>
        </MuiTooltip>
        {children}
      </Toolbar>
    </AppBarPrimary>
  )
})

AppBarPrimaryComponent.displayName = 'AppBarPrimaryComponent'
AppBarPrimaryComponent.aglyn = true
AppBarPrimaryComponent.defaultProps = {}

export default AppBarPrimaryComponent
