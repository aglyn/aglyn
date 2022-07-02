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

import { APP_CONSOLE, ICON_VARIANT_MENU_DOWN } from '@aglyn/shared-data-enums'
import {
  AglynSvgIcon,
  AglynSvgLogo,
  AppLink,
  type AppLinkProps,
  ElevateOnScroll,
  Menu,
  type MenuItemProps,
  type MenuProps,
} from '@aglyn/shared-ui-jsx'
import { MdiIcon, type MdiIconProps } from '@aglyn/shared-ui-mdi-jsx'
import { NextPageTitle } from '@aglyn/shared-ui-next'
import { mergeSxProps } from '@aglyn/shared-ui-theme'
import { _isArrEmpty } from '@aglyn/shared-util-guards'
import {
  AppBar,
  Avatar,
  Button,
  Divider,
  IconButton,
  type IconButtonProps,
  Stack,
  type StackProps,
  Toolbar,
  Typography,
} from '@mui/material'
import { Fragment } from 'react'
import { DRAWER_WIDTH, TOP_BAR_HEIGHT } from '../../constants/shared'

// eslint-disable-next-line react/display-name
const buildNav = (type?: 'icon' | 'text') => (item, i) => {
  const { avatar, icon, children, id, key, items, MenuProps, ...rest } = item
  const isMenu = !_isArrEmpty(items)
  const itemKey = key || id || i
  const rendered =
    type === 'text' ? (
      <Button
        key={key}
        id={id}
        color="inherit"
        startIcon={!icon?.path ? icon : <MdiIcon {...icon} />}
        endIcon={
          !isMenu ? undefined : <MdiIcon path={ICON_VARIANT_MENU_DOWN.path} />
        }
        {...(!rest.href
          ? {}
          : { component: AppLink, componentVariant: 'button' })}
        {...rest}
        sx={mergeSxProps(
          {
            '& .MuiButton-endIcon': { marginLeft: 0 },
            '& .MuiButton-endIcon>*:nth-of-type(1)': { fontSize: `1.7em` },
          },
          rest?.sx,
        )}
      >
        {children}
      </Button>
    ) : (
      <IconButton key={itemKey} color="inherit" {...rest}>
        {!avatar ? (
          !icon?.path ? (
            icon
          ) : (
            <MdiIcon {...icon} />
          )
        ) : (
          <Avatar {...avatar} />
        )}
        {children}
      </IconButton>
    )

  return isMenu ? (
    <Menu
      key={itemKey}
      items={items}
      {...MenuProps}
      sx={mergeSxProps(
        {
          p: { padding: 0.5, xs: 0.25 },
          '&:last-child': {
            paddingLeft: 0.75,
          },
        },
        MenuProps?.sx,
      )}
    >
      {rendered}
    </Menu>
  ) : (
    <Fragment key={itemKey}>{rendered}</Fragment>
  )
}

export interface TopAppBarProps {
  appBarSuffix?: JSX.Node
  centerNavigationItems?: CenterNavMenuItem[]
  customCenter?: JSX.Node
  disableAppBarElevation?: boolean
  quickActions?: QuickActionsMenuItem[]
}

const TopAppBar = (props: TopAppBarProps) => {
  const {
    appBarSuffix,
    centerNavigationItems,
    customCenter,
    disableAppBarElevation,
    quickActions,
  } = props

  return (
    <ElevateOnScroll>
      {({ activeWithoutHysteresis }) => (
        <AppBar
          component="header"
          color="inherit"
          variant="elevation"
          elevation={!disableAppBarElevation && activeWithoutHysteresis ? 4 : 0}
          position={disableAppBarElevation ? 'relative' : 'sticky'}
          sx={{
            height: `${TOP_BAR_HEIGHT - 1}px`,
            borderBottomWidth: `1px`,
            borderBottomStyle: 'solid',
            borderBottomColor: 'divider',
            zIndex: (theme) => theme.zIndex.appBar + 5,
          }}
        >
          <Toolbar
            component={Stack}
            variant="dense"
            alignItems="center"
            justifyContent="flex-start"
            direction="row"
            sx={{ paddingLeft: { xs: 0, md: 0 } }}
            divider={
              <Divider orientation="vertical" variant="middle" flexItem light />
            }
          >
            <Stack
              alignItems="center"
              direction="row"
              justifyContent="flex-start"
              color="inherit"
              width={DRAWER_WIDTH}
              maxWidth={{ xs: '100%' }}
              sx={{ paddingLeft: { xs: 2, md: 3 } }}
            >
              <AppLink
                href="/"
                componentVariant="button-base"
                color="inherit"
                disableRipple
              >
                <Stack
                  component="span"
                  alignItems="center"
                  direction="row"
                  justifyContent="flex-start"
                  spacing={0.75}
                  sx={{
                    fontWeight: 'fontWeightRegular',
                    fontFamily: 'h6.fontFamily',
                    fontSize: (theme) => ({
                      fontSize: theme.typography.pxToRem(18),
                      md: theme.typography.pxToRem(20),
                    }),
                  }}
                >
                  <AglynSvgIcon
                    sx={{
                      ml: -0.15,
                      height: '32px',
                      width: '32px',
                    }}
                    bordered
                    rounded
                  />
                  <AglynSvgLogo
                    color="secondary"
                    sx={{
                      transform: 'translateY(0.0265em)',
                      height: 'auto',
                      fontSize: '2.765em',
                    }}
                  />
                  {appBarSuffix && (
                    <Typography
                      component="span"
                      fontWeight="inherit"
                      fontSize="inherit"
                      lineHeight="inherit"
                      color="textPrimary"
                      display="flex"
                      alignItems="center"
                    >
                      {appBarSuffix}
                    </Typography>
                  )}
                </Stack>
              </AppLink>
            </Stack>

            <Stack
              alignItems="center"
              justifyContent="flex-start"
              direction="row"
              flexGrow={1}
              sx={{ paddingLeft: 6 }}
            >
              {!customCenter && _isArrEmpty(centerNavigationItems) ? null : (
                <Stack
                  component="nav"
                  direction="row"
                  alignItems="center"
                  justifyContent="flex-start"
                  // flexBasis="72%"
                >
                  {customCenter || centerNavigationItems.map(buildNav('text'))}
                </Stack>
              )}
            </Stack>
            {_isArrEmpty(quickActions) ? null : (
              <Stack
                component="nav"
                direction="row"
                alignItems="center"
                justifyContent="flex-start"
                spacing={0.5}
              >
                {(quickActions ?? []).map(buildNav('icon'))}
              </Stack>
            )}
          </Toolbar>
        </AppBar>
      )}
    </ElevateOnScroll>
  )
}
TopAppBar.displayName = 'TopAppBar'

export interface QuickActionsMenuItem extends IconButtonProps {
  icon?: MdiIconProps
  avatar?: any
  dense?: boolean
  href?: any
  items?: MenuItemProps[]
  MenuProps?: Partial<MenuProps>
}

export interface CenterNavMenuItem
  extends Omit<AppLinkProps<'button'>, 'componentVariant'> {
  icon?: MdiIconProps
  avatar?: any
  dense?: boolean
  href?: any
  MenuProps?: Partial<MenuProps>
  items?: MenuItemProps[]
}

export interface MainLayoutProps
  extends Omit<StackProps, 'title'>,
    TopAppBarProps {
  children?: JSX.Children
  title?: string[] | string
}

function MainLayout(props: MainLayoutProps) {
  const {
    children,
    title,
    appBarSuffix,
    centerNavigationItems,
    customCenter,
    disableAppBarElevation,
    quickActions,
    ...rest
  } = props

  return (
    <Fragment>
      <NextPageTitle
        screen={title || APP_CONSOLE.TITLE}
        suffix={APP_CONSOLE.AFFIX}
        separator={` ${APP_CONSOLE.SEP} `}
      />
      <Stack
        alignItems="stretch"
        flexDirection="column"
        height="100vh"
        {...rest}
      >
        <TopAppBar
          centerNavigationItems={centerNavigationItems}
          customCenter={customCenter}
          appBarSuffix={appBarSuffix}
          quickActions={quickActions}
          disableAppBarElevation={disableAppBarElevation}
        />
        {children}
      </Stack>
    </Fragment>
  )
}

MainLayout.displayName = 'MainLayout'
MainLayout.aglyn = true
MainLayout.defaultProps = {}

export { MainLayout }
export default MainLayout
