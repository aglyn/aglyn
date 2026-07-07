/**
 * @license
 * Copyright 2026 Aglyn LLC
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
  APP_CONSOLE,
  ICON_VARIANT_LEFT,
  ICON_VARIANT_MENU_DOWN,
  ICON_VARIANT_SIGN_OUT,
  ICON_VARIANT_THEME_DARK,
  ICON_VARIANT_THEME_LIGHT,
  ICON_VARIANT_THEME_SYSTEM,
  ICON_VARIANT_USER_SETTINGS,
} from '@aglyn/shared-data-enums'
import {
  AglynConsoleLogoFull,
  AppLink,
  type AppLinkProps,
  MdiIcon,
  type MdiIconProps,
  Menu,
  type MenuItemProps,
  type MenuProps,
  ScrollReaction,
  SrOnly,
} from '@aglyn/shared-ui-jsx'
import { NextPageTitle } from '@aglyn/shared-ui-next'
import { getThemeModeDisplayName, mergeSxProps } from '@aglyn/shared-ui-theme'
import { _isArr, _isArrEmpty } from '@aglyn/shared-util-tools'
import { useUserPhoto } from '@aglyn/tenant-feature-instance'
import {
  AppBar,
  Avatar,
  type AvatarProps,
  Box,
  Button,
  type ButtonProps,
  Divider,
  IconButton,
  type IconButtonProps,
  Stack,
  type StackProps,
  Toolbar,
  Typography,
} from '@mui/material'
import { useColorScheme } from '@mui/material/styles'
import { Fragment, useMemo } from 'react'
import { Route } from '../../constants/route-links'
import { TOP_BAR_HEIGHT } from '../../constants/shared'
import HostSwitcherNavComponent from '../host-switcher-nav.component'

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
          : { component: AppLink, componentVariant: 'button', nativeButton: false })}
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
      dense
      key={itemKey}
      items={items}
      {...MenuProps}
      sx={mergeSxProps(
        {
          p: { padding: 0.5, xs: 0.25 },
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
  /** Rendered before the center nav items (e.g. the version dropdown). */
  centerPrefix?: JSX.Node
  /** Rendered on the right, before the quick actions / user menu (AGL-57). */
  actionsPrefix?: JSX.Node
  customCenter?: JSX.Node
  enableAppBarElevation?: boolean
  quickActions?: QuickActionsMenuItem[]
  besigner?: boolean
  backButton?: Partial<ButtonProps>
}

const TopAppBar = (props: TopAppBarProps) => {
  const {
    appBarSuffix,
    centerNavigationItems,
    centerPrefix,
    actionsPrefix,
    customCenter,
    enableAppBarElevation,
    quickActions,
    besigner,
    backButton,
  } = props

  return (
    <ScrollReaction>
      {({ activeWithoutHysteresis }) => (
        <AppBar
          component="header"
          color="surface"
          variant="elevation"
          elevation={enableAppBarElevation && activeWithoutHysteresis ? 4 : 0}
          position={!enableAppBarElevation ? 'relative' : 'sticky'}
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
            direction="row"
            sx={{
              alignItems: "center",
              justifyContent: "flex-start",
              paddingLeft: { sx: 1, sm: 2 },
            }}
            divider={
              <Divider orientation="vertical" variant="middle" flexItem sx={{ opacity: 0.5 }} />
            }
          >
            {backButton && (
              <Button
                {...backButton}
                sx={{
                  minWidth: 'unset',
                  // position: 'absolute',
                  marginLeft: { xs: -2, sm: -2 },
                  paddingRight: { xs: 1, sm: 0.75 },
                  paddingLeft: { xs: 0.5, sm: 0.25 },
                  py: { xs: 0, sm: 0 },
                  left: 0,
                  height: 1,
                  borderRadius: 0,
                  // borderRight: ({ palette }) => `1px solid ${palette.divider}`,
                }}
              >
                <MdiIcon
                  sx={{ fontSize: '1.2em' }}
                  path={ICON_VARIANT_LEFT.path}
                />
                <SrOnly>{'back'}</SrOnly>
              </Button>
            )}

            <Stack
              direction="row"
              sx={{
                alignItems: "center",
                justifyContent: "flex-start",
                color: "inherit",
                maxWidth: { xs: '100%' },
                paddingLeft: backButton ? 0.5 : undefined,

                // width: DRAWER_WIDTH - 26,
                paddingRight: 3
              }}>
              <AppLink
                href="/"
                componentVariant="button-base"
                color="inherit"
                disableRipple
              >
                <Stack
                  component="span"
                  direction="row"
                  spacing={0.25}
                  sx={{
                    alignItems: "center",
                    justifyContent: "flex-start",
                    fontWeight: 'fontWeightRegular',
                    fontFamily: 'h6.fontFamily',

                    fontSize: (theme) => ({
                      fontSize: theme.typography.pxToRem(18),
                      md: theme.typography.pxToRem(20),
                    })
                  }}>
                  <AglynConsoleLogoFull sx={{ height: 24, width: 'auto' }} />
                  {appBarSuffix && (
                    <Typography
                      component="span"
                      color="textPrimary"
                      sx={{
                        fontWeight: "inherit",
                        fontSize: "inherit",
                        lineHeight: "inherit",
                        display: "flex",
                        alignItems: "center"
                      }}>
                      {appBarSuffix}
                    </Typography>
                  )}
                </Stack>
              </AppLink>
            </Stack>

            <Stack
              direction="row"
              sx={{
                alignItems: "center",
                justifyContent: "flex-start",
                flexGrow: 1,
                paddingLeft: 1.5
              }}>
              {!customCenter &&
              !centerPrefix &&
              _isArrEmpty(centerNavigationItems) ? null : (
                <Stack
                  component="nav"
                  direction="row"
                  sx={{
                    alignItems: "center",
                    justifyContent: "flex-start"
                  }}>
                  {centerPrefix}
                  {customCenter || centerNavigationItems.map(buildNav('text'))}
                </Stack>
              )}
            </Stack>
            {actionsPrefix ? (
              <Stack
                component="nav"
                direction="row"
                sx={{
                  alignItems: "center",
                  justifyContent: "flex-end"
                }}>
                {actionsPrefix}
              </Stack>
            ) : null}
            {_isArrEmpty(quickActions) ? null : (
              <Stack
                component="nav"
                direction="row"
                spacing={0.5}
                sx={{
                  alignItems: "center",
                  justifyContent: "flex-start"
                }}>
                {(quickActions ?? []).map(buildNav('icon'))}
              </Stack>
            )}
          </Toolbar>
        </AppBar>
      )}
    </ScrollReaction>
  );
}
TopAppBar.displayName = 'TopAppBar'

export interface QuickActionsMenuItem extends IconButtonProps {
  icon?: MdiIconProps
  avatar?: AvatarProps
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

export function MainLayout(props: MainLayoutProps) {
  const {
    children,
    title,
    appBarSuffix,
    centerNavigationItems,
    centerPrefix,
    actionsPrefix,
    customCenter,
    enableAppBarElevation,
    quickActions,
    besigner,
    backButton,
    ...rest
  } = props
  const userPhotoUrl = useUserPhoto({ gravatar: { size: '64' } })
  const { mode, setMode } = useColorScheme()
  const themeModeDisplayName = getThemeModeDisplayName(mode)
  const layoutTitle = useMemo(() => {
    return title ? [...(_isArr(title) ? title : [title]), 'Secure'] : 'Secure'
  }, [title])

  return (
    <Fragment>
      <NextPageTitle
        screen={layoutTitle || APP_CONSOLE.TITLE}
        suffix={APP_CONSOLE.AFFIX}
        separator={` ${APP_CONSOLE.SEP} `}
      />
      <Stack
        {...rest}
        sx={[{
          alignItems: "stretch",
          flexDirection: "column",
          // minHeight, not height: a fixed 100vh box is the containing block
          // for the sticky secondary toolbar, which stopped sticking after
          // one viewport of scroll on longer pages (AGL-37).
          minHeight: "100vh",
          // Besigner is a fixed editor shell (AGL-58/63): exactly the window
          // height, never page-scrollable — overflow lives inside the editor
          // regions (canvas pan, panel scroll).
          ...(besigner && {
            height: "100vh",
            overflow: "hidden",
            '@supports (height: 100dvh)': {
              minHeight: "100dvh",
              height: "100dvh",
            },
          }),
        }, ...(Array.isArray(rest.sx) ? rest.sx : [rest.sx])]}>
        <TopAppBar
          enableAppBarElevation={enableAppBarElevation}
          backButton={backButton}
          centerPrefix={centerPrefix}
          actionsPrefix={actionsPrefix}
          centerNavigationItems={centerNavigationItems || []}
          customCenter={
            // Default center nav is the host-switcher dropdown (AGL-36);
            // pages that pass their own nav items or custom center keep them.
            customCenter ??
            (centerNavigationItems ? undefined : <HostSwitcherNavComponent />)
          }
          appBarSuffix={appBarSuffix}
          quickActions={[
            ...(quickActions || []),
            {
              title: 'Manage account',
              MenuProps: { dense: true, horizontalOrigin: 'right' },
              sx: { p: 0.5 },
              edge: 'end',
              avatar: {
                src: userPhotoUrl,
                slotProps: {
                  img: {
                    // user.photoURL https://stackoverflow.com/a/61042200/16134372
                    referrerPolicy: 'no-referrer',
                  },
                },
              },
              items: [
                {
                  onClick: () => {
                    // cycle: system/undefined → light → dark → system
                    setMode(
                      mode === 'dark'
                        ? 'system'
                        : mode === 'light'
                          ? 'dark'
                          : 'light',
                    )
                  },
                  // component: 'button',
                  children: `Theme mode: ${themeModeDisplayName}`,
                  icon: {
                    path:
                      mode === 'dark'
                        ? ICON_VARIANT_THEME_DARK.path
                        : mode === 'light'
                          ? ICON_VARIANT_THEME_LIGHT.path
                          : ICON_VARIANT_THEME_SYSTEM.path,
                  },
                  'aria-label': 'switch theme mode',
                },
                {
                  children: 'Settings',
                  component: AppLink,
                  href: Route.MANAGE_USER_SETTINGS,
                  icon: { path: ICON_VARIANT_USER_SETTINGS.path },
                },
                {
                  children: 'Staff console',
                  component: AppLink,
                  href: Route.ADMIN_TENANTS,
                  icon: { path: ICON_VARIANT_USER_SETTINGS.path },
                },
                {
                  type: 'divider',
                },
                {
                  children: 'Sign out',
                  component: AppLink,
                  href: Route.AUTH_SIGN_OUT,
                  icon: { path: ICON_VARIANT_SIGN_OUT.path },
                },
              ],
            },
          ]}
        />
        {besigner ? (
          <Box
            sx={{
              flexGrow: 1,
              minHeight: 0,
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden',
            }}
          >
            {children}
          </Box>
        ) : (
          children
        )}
      </Stack>
    </Fragment>
  );
}

MainLayout.displayName = 'MainLayout'
MainLayout.aglyn = true

export default MainLayout
