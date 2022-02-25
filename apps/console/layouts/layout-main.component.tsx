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
import {getFirebaseAuth} from '@aglyn/shared-feature-fbclient'
import {mergeSxProps, styled} from '@aglyn/shared-feature-themes'
import {
  AglynSvgIcon,
  AglynSvgLogo,
  AppLink,
  type AppLinkProps,
  ElevateOnScroll,
  Menu,
} from '@aglyn/shared-ui-jsx'
import {MdiIcon, type MdiIconProps} from '@aglyn/shared-ui-mdi-jsx'
import {_isArr, _isArrEmpty} from '@aglyn/shared-util-guards'
import {gravatarUrlFromEmail} from '@aglyn/shared-util-tools'
import {
  AppBar,
  Avatar,
  Box,
  Divider,
  IconButton,
  type IconButtonProps,
  Stack,
  Tab as MuiTab,
  type TabProps as MuiTabProps,
  Tabs as MuiTabs,
  Toolbar,
} from '@mui/material'
import {cyan} from '@mui/material/colors'
import Head from 'next/head'
import {useRouter} from 'next/router'
import {Fragment, type ReactNode, useMemo} from 'react'
import {useAuthState} from 'react-firebase-hooks/auth'


const firebaseAuth = getFirebaseAuth()
export const TAB_HEIGHT = 40

const TabItem = styled(MuiTab, {
  name: 'AglynTabItem',
})(({theme}) => ({
  flexDirection: 'row',
  minHeight: TAB_HEIGHT,
  '& > *:first-of-type': {
    marginBottom: 0,
    marginRight: 1,
  },
  '& .MuiTab-labelIcon': {
    minHeight: TAB_HEIGHT - 16,
    minWidth: 'auto',
    paddingLeft: 0,
    paddingRight: 0,
    marginLeft: 4,
    '&:first-of-type': {
      marginLeft: 0,
    },
  },
}))

function a11yProps(index) {
  return {
    id: `scrollable-auto-tab-${index}`,
    'aria-controls': `scrollable-auto-tabpanel-${index}`,
  }
}

export interface QuickActionsMenuItem extends IconButtonProps {
  icon?: MdiIconProps
  avatar?: any
  dense?: boolean
  href?: any
  items?: QuickActionsMenuItem[]
}

export type NavTabItem = Partial<AppLinkProps & MuiTabProps & {icon: MdiIconProps}>

export interface LayoutMainProps {
  children?: ReactNode | undefined
  title?: ReactNode[] | ReactNode
  tabBarTitle?: ReactNode
  centerNavigationItems?: Array<any>
  navTabItems?: NavTabItem[]
  quickActionMenus?: QuickActionsMenuItem[]
  productName?: string
  // aggregatedPageMeta: AggregatedPageMeta
  // currentUserContext: CurrentUserContextType
}

function LayoutMainComponent(props: LayoutMainProps) {
  const {
    children,
    title,
    centerNavigationItems,
    tabBarTitle,
    navTabItems,
    productName,
    quickActionMenus: quickActions,
  } = props
  const [user] = useAuthState(firebaseAuth)
  const router = useRouter()
  const tabValue = useMemo(() => {
    return navTabItems.find((i) => {
      return (i?.hrefAs || i?.href || '') === router.asPath
    })?.href || false
  }, [router, navTabItems])

  const buildIconButton = ({avatar, icon, children, ...rest}, i) => (
    <IconButton key={rest.id ?? rest['href'] ?? i} color="inherit" {...rest}>
      {avatar
        ? (
          <Avatar
            {...avatar}
            sx={mergeSxProps({
              backgroundColor: cyan[600],
            }, avatar.sx)}
          />
        )
        : icon ? (<MdiIcon {...icon} />) : null
      }
      {children}
    </IconButton>
  )

  const buildTextButton = (item, key) => (
    <AppLink
      key={key}
      componentVariant="button"
      color="inherit"
      sx={{p: item?.avatar ? 0.5 : undefined}}
      {...item}
    />
  )

  // eslint-disable-next-line react/display-name
  const buildNav = (id, actionBuilder) => (item, key) =>
    _isArr(item.items) ? (
      <Menu
        key={id + key}
        items={item.items}
        sx={{
          p: {padding: 0.5, xs: 0.25},
          '&:last-child': {
            paddingLeft: 0.75,
          },
        }}
      >
        {actionBuilder(item, key)}
      </Menu>
    ) : (
      <Fragment key={id + key}>{actionBuilder(item, key)}</Fragment>
    )

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
        <ElevateOnScroll
          renderProps={(elevated) => ({elevation: elevated ? 4 : 0})}
        >
          <AppBar
            component="header"
            color="inherit"
            position="sticky"
            variant="elevation"
          >
            <Toolbar
              variant="dense"
              component={'div'}
              color="inherit"
              sx={{
                borderBottomWidth: `1px`,
                borderBottomStyle: 'solid',
                borderBottomColor: 'divider',
              }}
            >
              <Box
                component={'div'}
                sx={{
                  flexGrow: 1,
                  display: 'flex',
                  alignItems: 'center',
                }}
              >
                <Box
                  sx={{
                    height: '36px',
                    flex: '0 0 auto',
                    my: 0.75,
                    display: 'flex',
                    alignItems: 'center',
                    '& a': {
                      display: 'flex',
                      alignItems: 'center',
                    },
                  }}
                >
                  <AppLink
                    color="inherit"
                    href="/"
                    componentVariant="button-base"
                    anchorComponent={'button'}
                    disableRipple
                    sx={{
                      display: 'flex',
                      alignItems: 'center',
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
                        fontSize: `1.75em`,
                        borderRadius: theme => theme.shape.appIconBorderRadius,
                        // boxShadow: theme.shadows[1],
                        ml: -0.5, mr: 0.75,
                      }}
                    />
                    <AglynSvgLogo
                      color="secondary"
                      sx={{
                        // color: '#36ca94', // Hulu
                        transform: 'translateY(0.0265em)',
                        height: 'auto',
                        fontSize: '2.765em',
                        // color: (theme) => theme.palette.mode === 'dark'
                        //   ? 'secondary.main'
                        //   : 'secondary.light',
                      }}
                    />
                    {productName && (
                      <Box
                        component={'span'}
                        color="textPrimary"
                        sx={{
                          // color: 'text.primary',
                          ml: 0.5,
                          display: 'flex',
                          alignItems: 'center',
                        }}
                      >
                        {` ${productName}`}
                      </Box>
                    )}
                  </AppLink>
                </Box>
              </Box>
              <Box
                component={'div'}
                sx={{
                  display: 'flex',
                  flexGrow: 1,
                  flexBasis: '72%',
                  alignItems: 'center',
                }}
              >
                {(centerNavigationItems ?? []).map(buildNav('cni', buildTextButton))}
              </Box>
              <Box
                component={'div'}
                sx={{display: 'flex', alignItems: 'center'}}
              >
                {(quickActions ?? []).map(buildNav('qa', buildIconButton))}
                <Menu
                  title={'User account'}
                  items={[
                    {
                      dense: true,
                      children: 'Account Settings',
                      href: '/settings/account',
                    },
                  ]}
                  sx={{
                    p: {padding: 0.5, xs: 0.25},
                    '&:last-child': {
                      paddingLeft: 0.75,
                    },
                  }}
                >
                  <IconButton color="inherit">
                    <Avatar
                      alt={user?.displayName}
                      src={gravatarUrlFromEmail(user?.email)}
                      sx={{
                        backgroundColor: cyan[600],
                      }}
                    />
                  </IconButton>
                </Menu>
              </Box>
            </Toolbar>
            {tabBarTitle || (_isArr(navTabItems) && !_isArrEmpty(navTabItems)) ? (
              <Toolbar
                variant="dense"
                component="div"
                color="inherit"
                sx={{
                  minHeight: TAB_HEIGHT,
                  borderBottomWidth: `1px`,
                  borderBottomStyle: 'solid',
                  borderBottomColor: 'divider',
                }}
              >
                {tabBarTitle && (
                  <Box
                    component={'div'}
                    sx={{
                      // typography: 'h6',
                      lineHeight: 'normal',
                      letterSpacing: 2,
                      fontFamily: 'h6.fontFamily',
                      fontSize: `0.95em`,
                      fontWeight: 'fontWeightMedium',
                      textTransform: 'uppercase',
                      color: 'text.secondary',
                    }}
                  >
                    {tabBarTitle}
                  </Box>
                )}
                <Divider
                  orientation="vertical"
                  sx={{ml: 1.25, mr: 1}}
                  flexItem
                  light
                />

                <MuiTabs
                  aria-label="area navigation"
                  indicatorColor="secondary"
                  scrollButtons="auto"
                  textColor="inherit"
                  value={tabValue || false}
                  variant="scrollable"
                  sx={{
                    minHeight: TAB_HEIGHT,
                    alignItems: 'center',
                    '& .MuiTabs-flexContainer': {
                      alignItems: 'center',
                    },
                    '& .MuiTabs-indicator': {
                      height: '3px',
                      backgroundColor: 'unset',
                      '&:after': {
                        borderRadius: '3px 3px 0 0',
                        content: '" "',
                        display: 'block',
                        position: 'absolute',
                        left: 0,
                        top: 0,
                        right: 0,
                        mx: 'auto',
                        width: 0.8,
                        height: 1,
                        backgroundColor: 'secondary.light',
                      },
                    },
                  }}
                >
                  {navTabItems && navTabItems.map(({icon, ...item}, index) => (
                    <TabItem
                      key={item.id ?? index}
                      href={item.href ?? ''}
                      value={item.href ?? index}
                      icon={icon?.path && <MdiIcon {...icon} /> || icon}
                      componentVariant="button-base"
                      anchorComponent="button"
                      color="inherit"
                      underline="none"
                      // disableRipple
                      wrapped
                      {...a11yProps(index)}
                      {...{component: AppLink} as any}
                      {...item}
                    />
                  ))}
                </MuiTabs>
              </Toolbar>
            ) : null}
          </AppBar>
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
