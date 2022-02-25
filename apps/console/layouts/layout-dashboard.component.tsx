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

import {darken, mergeSxProps, styled} from '@aglyn/shared-feature-themes'
import {
  AppLink,
  type AppLinkProps,
  BackgroundImageComponent,
  ElevateOnScroll,
  GridItems,
  type GridItemsProps,
} from '@aglyn/shared-ui-jsx'
import {MdiIcon, type MdiIconProps, mdiShieldLock} from '@aglyn/shared-ui-mdi-jsx'
import {_isArr, _isArrEmpty} from '@aglyn/shared-util-guards'
import {
  AppBar,
  Container,
  Divider,
  Stack,
  Tab as MuiTab,
  type TabProps as MuiTabProps,
  Tabs as MuiTabs,
  Toolbar,
  Typography,
  type TypographyProps,
} from '@mui/material'
import {useRouter} from 'next/router'
import {type ReactNode, useMemo} from 'react'
import {isElement} from 'react-is'
import BreadcrumbsComponent, {type BreadcrumbsProps} from '../components/breadcrumbs.component'
import FooterComponent from '../components/footer.component'
import LayoutConsoleComponent from './layout-console.component'
import {TOP_BAR_HEIGHT} from './layout-main.component'


export const CONTENT_MAX_WIDTH = 'xl'
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

export type NavTabItem = Partial<AppLinkProps & MuiTabProps & {icon: MdiIconProps}>

export interface LayoutDashboardProps {
  children?: ReactNode
  ContentGridItemsProps?: GridItemsProps
  items?: GridItemsProps['items']
  breadcrumbItems?: BreadcrumbsProps['items']
  tabBarTitle?: ReactNode
  navTabItems?: NavTabItem[]
  header?: TypographyProps<any, any> & {
    icon?: MdiIconProps | ReactNode
  }
}

function LayoutDashboardComponent(props: LayoutDashboardProps) {
  const {
    children,
    header: headerProp,
    ContentGridItemsProps,
    breadcrumbItems,
    items,
    tabBarTitle: tabBarTitleProp,
    navTabItems: navTabItemsProp,
  } = props

  const {
    children: headerChildren,
    sx: headerSx,
    icon: headerIcon,
    ...header
  } = headerProp || {}

  const tabBarTitle = tabBarTitleProp ?? (
    <Stack
      direction="row"
      spacing={{sm: 0.15, md: 0.5}}
      alignItems="center"
      typography={'subtitle2'}
      lineHeight={'normal'}
      sx={{color: 'tertiary.light'}}
    >
      <span>{'Secure'}</span>
      <MdiIcon
        path={mdiShieldLock.path}
        fontSize={'small'}
        sx={{color: 'tertiary.light'}}
      />
    </Stack>
  )
  const navTabItems: NavTabItem[] = navTabItemsProp ?? [
    {
      id: 'dashboard',
      label: 'Dashboard',
      href: '/',
    },
    {
      id: 'besigner',
      label: 'Besigner',
      href: '/besigner',
    },
  ]
  const router = useRouter()
  const tabValue = useMemo(() => {
    return navTabItems.find((i) => {
      return (i?.hrefAs || i?.href || '') === router.asPath
    })?.href || false
  }, [router, navTabItems])

  return (
    <>

      <main /*className={classes.content}*/>
        {tabBarTitle || (_isArr(navTabItems) && !_isArrEmpty(navTabItems)) ? (
          <ElevateOnScroll
            renderProps={(elevated) => ({
              elevation: elevated ? 4 : 0,
            })}
            scrollTrigger={{
              disableHysteresis: true,
              threshold: TOP_BAR_HEIGHT,
            }}
          >
            <AppBar
              component="header"
              color="inherit"
              position="sticky"
              variant="elevation"
            >
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
                  <Typography
                    component={'div'}
                    variant={'h6'}
                    sx={{
                      lineHeight: 'normal',
                      letterSpacing: 2,
                      fontSize: `0.95em`,
                      fontWeight: 'fontWeightMedium',
                      textTransform: 'uppercase',
                      color: 'text.secondary',
                    }}
                  >
                    {tabBarTitle}
                  </Typography>
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
            </AppBar>
          </ElevateOnScroll>
        ) : null}

        <BackgroundImageComponent
          component="header"
          url="/_static/images/backgrounds/patterns/abstract-wave-lines.svg"
          bgPosition="50% 90%"
          sx={{
            pt: 10,
            bgcolor: 'background.secondary',
            color: 'text.primary',
            borderBottomWidth: `1px`,
            borderBottomStyle: 'solid',
            borderBottomColor: 'divider',
          }}
        >
          <Container maxWidth={CONTENT_MAX_WIDTH}>
            <Typography
              component="h1"
              variant="h4"
              sx={mergeSxProps({
                display: 'flex',
                flexDirection: 'row',
                alignItems: 'center',
              }, headerSx)}
              {...header}
            >
              {!headerIcon || isElement(headerIcon) ? headerIcon : (
                <MdiIcon
                  color="inherit"
                  {...headerIcon}
                  sx={mergeSxProps({
                    padding: 1,
                    mr: 1.75,
                    ml: -0.5,
                    fontSize: `1.5em`,
                    borderWidth: `1px`,
                    borderStyle: 'solid',
                    borderColor: 'tertiary.dark',
                    color: 'quaternary.contrastText',
                    bgcolor: 'quaternary.main',
                    borderRadius: (theme) => theme.shape.appIconBorderRadius,
                  }, headerIcon['sx'])}
                />
              )}
              {headerChildren}
            </Typography>
            <BreadcrumbsComponent
              items={breadcrumbItems || []}
              sx={{
                my: 2,
                marginTop: 1,
                color: (theme) => darken(
                  theme.palette.getContrastText(theme.palette.background.secondary),
                  0.12,
                ),
                ['& .AglynBreadcrumbs-item']: {
                  color: 'inherit',
                  ['&.AglynBreadcrumbs-last']: {
                    fontWeight: 'fontWeightMedium',
                    color: (theme) => theme.palette.getContrastText(theme.palette.background.secondary),
                  },
                },
              }}
            />
          </Container>
        </BackgroundImageComponent>

        <Container maxWidth={CONTENT_MAX_WIDTH}>
          {items || ContentGridItemsProps ? (
            <GridItems
              items={items}
              spacing={3}
              {...ContentGridItemsProps}
            />
          ) : null}
          {children}
        </Container>
      </main>

      <FooterComponent />
    </>
  )
}
LayoutDashboardComponent.displayName = 'LayoutDashboardComponent'
LayoutDashboardComponent.layoutComponent = LayoutConsoleComponent
LayoutDashboardComponent.layoutProps = {
  LayoutConsoleComponent: {
    disableAppBarElevation: true,
  },
}

export {LayoutDashboardComponent}
export default LayoutDashboardComponent
