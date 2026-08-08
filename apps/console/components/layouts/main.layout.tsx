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
  ICON_VARIANT_LEFT,
  ICON_VARIANT_MENU_DOWN,
} from '@aglyn/shared-data-enums'
import { AglynBesignerLogoFull, AglynConsoleLogoFull, AppLink, type AppLinkProps, MdiIcon, type MdiIconProps, Menu, type MenuItemProps, type MenuProps, SrOnly } from '@aglyn/shared-ui-jsx'
import { ScrollReaction } from '@aglyn/shared-ui-jsx/components/scroll-reaction'
import { mergeSxProps } from '@aglyn/shared-ui-theme'
import { _isArrEmpty } from '@aglyn/shared-util-tools'
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
import { Fragment } from 'react'
import { buildRoute, Route } from '../../constants/route-links'
import useBranding from '../../hooks/use-branding'
import { useOrgSlug } from '../../hooks/use-org-scope'
import { useUrlNamesOrg } from '../../hooks/use-secondary-nav'
import { TOP_BAR_HEIGHT } from '../../constants/shared'
import NotificationPrompt from '../notification-prompt.component'
import NotificationsMenu from '../notifications-menu.component'
import OrgSwitcherNav from '../org-switcher-nav.component'
import UserMenu from '../user-menu.component'

// eslint-disable-next-line react/display-name
const buildNav = (type?: 'icon' | 'text') => (item, i) => {
  // Escape hatch for a fully custom action (AGL-858: the redesigned UserMenu),
  // rendered in place instead of squeezed through the icon/menu item shape.
  if (typeof item?.render === 'function') {
    return item.render(item.key ?? item.id ?? i)
  }
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
      <IconButton
        key={itemKey}
        color="inherit"
        // AGL-752: an `href` or a custom `component` resolves this to an <a>,
        // same as the text branch above.
        {...(rest.href || rest.component ? { nativeButton: false } : {})}
        {...rest}
      >
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
  // The logo returns to the active org's home (AGL-631); the jump page when no
  // org has resolved yet — or when the URL names no workspace at all
  // (AGL-1130), where "the active org" is only whichever one the scope fell
  // back to. From the staff console or Manage Account, home is the picker.
  const resolvedOrgSlug = useOrgSlug()
  const orgSlug = useUrlNamesOrg() ? resolvedOrgSlug : ''
  const orgHome = orgSlug ? buildRoute(Route.ORG_HOME, { orgSlug }) : '/'
  // White-label chrome (White-Label Phase 2): swap the Aglyn wordmark for the
  // current org's brand when it is white-label entitled.
  const { branding, whiteLabel } = useBranding()

  return (
    <ScrollReaction>
      {({ activeWithoutHysteresis }) => (
        <AppBar
          component="header"
          color="surface"
          variant="elevation"
          elevation={enableAppBarElevation && activeWithoutHysteresis ? 4 : 0}
          // Always scrolls away (user request 2026-07-07): the secondary
          // nav-tabs bar is the sticky one; pages that passed
          // enableAppBarElevation used to pin this bar too, so which bar
          // stuck varied page to page.
          position="relative"
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
                // AGL-752: every caller passes `component: AppLink`, which
                // resolves to an <a>; declare it so MUI v7's button-root check
                // stays quiet. Overridable by the caller via the spread below.
                {...(backButton.component ? { nativeButton: false } : {})}
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
                href={orgHome}
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
                  {/* White-label console chrome (White-Label Phase 2): a
                      white-label-entitled org shows its own logo (or product
                      name when it set a name but no logo) in place of the
                      Aglyn wordmark, resolved through the one shared
                      `resolveBrandingProfile` (via useBranding). Non-white-label
                      orgs — and every surface until the org doc is confirmed —
                      keep the Aglyn console/besigner logos exactly as before. */}
                  {whiteLabel && branding.logoUrl ? (
                    <Box
                      component="img"
                      src={branding.logoUrl}
                      alt={branding.productName}
                      sx={{ height: 24, width: 'auto', display: 'block' }}
                    />
                  ) : whiteLabel ? (
                    <Typography
                      component="span"
                      color="textPrimary"
                      sx={{
                        fontWeight: 'inherit',
                        fontSize: 'inherit',
                        lineHeight: 'inherit',
                        display: 'flex',
                        alignItems: 'center',
                      }}
                    >
                      {branding.productName}
                    </Typography>
                  ) : besigner ? (
                    <AglynBesignerLogoFull sx={{ height: 24, width: 'auto' }} />
                  ) : (
                    <AglynConsoleLogoFull sx={{ height: 24, width: 'auto' }} />
                  )}
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
  /** Render a fully custom action in place (AGL-858: the UserMenu popover). */
  render?: (key: string | number) => JSX.Element
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

// `title` stays omitted from StackProps so no stray HTML title attribute
// reaches the Stack. MainLayout took a `title` prop of its own until AGL-1059
// moved document titles to App Router `metadata`; nothing set the visible
// chrome from it, so the prop went with the title mechanism.
export interface MainLayoutProps
  extends Omit<StackProps, 'title'>,
    TopAppBarProps {
  children?: JSX.Children
}

export function MainLayout(props: MainLayoutProps) {
  const {
    children,
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
  // The account menu, theme control, and org-scoped chrome links moved into
  // the self-contained UserMenu component (AGL-858), which reads its own
  // user/org/theme — so MainLayout no longer needs them here.
  return (
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
        besigner={besigner}
        backButton={backButton}
        centerPrefix={centerPrefix}
        centerNavigationItems={centerNavigationItems || []}
        customCenter={
          // Default center nav is the ORG switcher (AGL-236 — swapped
          // with the host switcher, which now lives in the secondary
          // bar); pages passing their own nav items or center keep them.
          customCenter ??
          (centerNavigationItems ? undefined : <OrgSwitcherNav />)
        }
        actionsPrefix={
          // Notifications bell (AGL-260) rides beside any page-provided
          // prefix actions.
          <>
            {actionsPrefix}
            <NotificationsMenu />
            {/* Pre-permission ask (AGL-663): the browser allows exactly one
                native prompt per origin, so we offer in-app first where a
                decline is reversible. Renders nothing unless it applies. */}
            <NotificationPrompt />
          </>
        }
        appBarSuffix={appBarSuffix}
        quickActions={[
          ...(quickActions || []),
          // The redesigned account menu (AGL-858) owns its own avatar trigger
          // + popover, and the theme control now lives inside it — so it
          // renders as a custom node rather than an icon/menu item.
          { render: (key: string | number) => <UserMenu key={key} /> },
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
  );
}

MainLayout.displayName = 'MainLayout'
MainLayout.aglyn = true

export default MainLayout
