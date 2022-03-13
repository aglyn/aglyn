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

import {APP_CONSOLE} from '@aglyn/shared-data-enums'
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
import {MdiIcon, type MdiIconProps} from '@aglyn/shared-ui-mdi-jsx'
import {_isArr, _isArrEmpty} from '@aglyn/shared-util-guards'
import {
  AppBar,
  Avatar,
  Button,
  IconButton,
  type IconButtonProps,
  Stack,
  Toolbar,
  Typography,
} from '@mui/material'
import Head from 'next/head'
import {Fragment, type ReactNode} from 'react'
import {TOP_BAR_HEIGHT} from '../constants/shared'


// eslint-disable-next-line react/display-name
const buildNav = (type?: 'icon' | 'text') => (item, i) => {
  const {
    avatar,
    icon,
    children,
    id,
    key,
    items,
    MenuProps,
    ...rest
  } = item
  const itemKey = key || id || i
  const rendered = type === 'text' ? (
    <Button
      key={key}
      id={id}
      color="inherit"
      startIcon={!icon?.path ? icon : (<MdiIcon {...icon} />)}
      {...(!rest.href ? {} : {component: AppLink, componentVariant: 'button'})}
      {...rest}
    >
      {children}
    </Button>
  ) : (
    <IconButton
      key={itemKey}
      color="inherit"
      {...rest}
    >
      {!avatar
        ? !icon?.path ? icon : (<MdiIcon {...icon} />)
        : (<Avatar {...avatar} />)
      }
      {children}
    </IconButton>
  )

  return !_isArrEmpty(items) ? (
    <Menu
      key={itemKey}
      items={items}
      sx={{
        p: {padding: 0.5, xs: 0.25},
        '&:last-child': {
          paddingLeft: 0.75,
        },
      }}
      {...MenuProps}
    >
      {rendered}
    </Menu>
  ) : (
    <Fragment key={itemKey}>
      {rendered}
    </Fragment>
  )
}

export interface QuickActionsMenuItem extends IconButtonProps {
  icon?: MdiIconProps
  avatar?: any
  dense?: boolean
  href?: any
  items?: MenuItemProps[]
  MenuProps?: Partial<MenuProps>
}

export interface CenterNavMenuItem extends Omit<AppLinkProps<'button'>, 'componentVariant'> {
  icon?: MdiIconProps
  avatar?: any
  dense?: boolean
  href?: any
  MenuProps?: Partial<MenuProps>
  items?: MenuItemProps[]
}

export interface LayoutMainProps {
  children?: ReactNode | undefined
  title?: ReactNode[] | ReactNode
  centerNavigationItems?: CenterNavMenuItem[]
  customCenter?: ReactNode
  quickActions?: QuickActionsMenuItem[]
  appBarSuffix?: ReactNode
  disableAppBarElevation?: boolean
}

function LayoutMainComponent(props: LayoutMainProps) {
  const {
    children,
    title,
    centerNavigationItems,
    customCenter,
    appBarSuffix,
    quickActions,
    disableAppBarElevation,
  } = props


  return (
    <Fragment>
      <Head>
        <title>
          {!title
            ? APP_CONSOLE.TITLE
            : [
              ..._isArr(title) ? title : [title],
              APP_CONSOLE.AFFIX,
            ].join(` ${APP_CONSOLE.SEP} `)
          }
        </title>
      </Head>
      <Stack
        alignItems="stretch"
        flexDirection="column"
        minHeight="100vh"
      >
        <ElevateOnScroll>
          {({activeWithoutHysteresis}) => (
            <AppBar
              component="header"
              color="inherit"
              variant="elevation"
              elevation={
                !disableAppBarElevation && activeWithoutHysteresis ? 4 : 0
              }
              position={disableAppBarElevation ? 'relative' : 'sticky'}
              sx={{
                height: `${TOP_BAR_HEIGHT}px`,
                borderBottomWidth: `1px`,
                borderBottomStyle: 'solid',
                borderBottomColor: 'divider',
                zIndex: theme => theme.zIndex.appBar + 5,
              }}
            >
              <Toolbar
                component={Stack}
                variant="dense"
                alignItems="center"
                justifyContent="flex-start"
                direction="row"
              >
                <Stack
                  flexGrow={1}
                  alignItems="center"
                  direction="row"
                  justifyContent="flex-start"
                  color="inherit"
                >
                  <AppLink
                    href="/"
                    componentVariant="button-base"
                    // anchorComponent="button"
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
                      <AglynSvgIcon rounded bordered sx={{fontSize: `1.75em`, ml: -0.5}} />
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

                {customCenter ?? (
                  _isArrEmpty(centerNavigationItems) || customCenter ? null : (
                    <Stack
                      component="nav"
                      direction="row"
                      alignItems="center"
                      justifyContent="flex-start"
                      flexBasis="72%"
                      flexGrow={1}
                    >
                      {(centerNavigationItems ?? []).map(buildNav('text'))}
                    </Stack>
                  )
                )}

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
        {children}
      </Stack>
    </Fragment>
  )
}

LayoutMainComponent.displayName = 'LayoutMainComponent'
LayoutMainComponent.defaultProps = {}

export {LayoutMainComponent}
export default LayoutMainComponent
