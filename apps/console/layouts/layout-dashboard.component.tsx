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

import {ICON_VARIANT_HOME} from '@aglyn/shared-data-enums'
import {mergeSxProps, styled} from '@aglyn/shared-feature-themes'
import {
  AppLink,
  type AppLinkProps,
  BackgroundImageComponent,
  ElevateOnScroll,
} from '@aglyn/shared-ui-jsx'
import {MdiIcon, type MdiIconProps, mdiShieldLock} from '@aglyn/shared-ui-mdi-jsx'
import {
  AppBar,
  Box,
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
import {CONTENT_MAX_WIDTH, TAB_HEIGHT, TOP_BAR_HEIGHT} from '../constants/shared'
import LayoutConsoleComponent from './layout-console.component'


const TabItem = styled(MuiTab, {
  name: 'AglynTabItem',
})({
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
})

function a11yProps(index) {
  return {
    id: `scrollable-auto-tab-${index}`,
    'aria-controls': `scrollable-auto-tabpanel-${index}`,
  }
}

const defaultNavTabItems = [
  {
    id: 'nav-tab-dashboard',
    label: 'Dashboard',
    href: '/',
  },
  {
    id: 'nav-tab-screens',
    label: 'Screens',
    href: '/screens',
  },
]

const defaultBreadcrumbs = [
  {
    id: 'home',
    children: 'Home',
    href: '/',
    icon: {path: ICON_VARIANT_HOME.path},
  },
]

const defaultTabBarTitle = (
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
    />
  </Stack>
)

export type NavTabItem = Partial<AppLinkProps & MuiTabProps & {icon: MdiIconProps}>

export interface LayoutDashboardProps {
  children?: ReactNode
  breadcrumbItems?: BreadcrumbsProps['items']
  disableBreadcrumbs?: true
  disableDefaultBreadcrumb?: true

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
    breadcrumbItems,
    disableBreadcrumbs,
    disableDefaultBreadcrumb,
    tabBarTitle: tabBarTitleProp,
    navTabItems,
  } = props
  const router = useRouter()

  const {
    children: headerChildren,
    sx: headerSx,
    icon: headerIcon,
    ...header
  } = headerProp || {}

  const breadcrumbs = [
    ...(disableDefaultBreadcrumb ? [] : defaultBreadcrumbs),
    ...breadcrumbItems,
  ]

  const tabItems: NavTabItem[] = navTabItems ?? defaultNavTabItems

  const tabValue = useMemo(() => (
    tabItems
      .find((i) => (i?.hrefAs || i?.href || '') === router.asPath)
      ?.href
    || false
  ), [router, tabItems])

  return (
    <>
      <ElevateOnScroll threshold={TOP_BAR_HEIGHT}>
        {({activeWithoutHysteresis}) => (
          <AppBar
            component="aside"
            color="inherit"
            position="sticky"
            variant="elevation"
            elevation={activeWithoutHysteresis ? 4 : 0}
            enableColorOnDark
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
                {tabBarTitleProp ?? defaultTabBarTitle}
              </Typography>

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
                {tabItems.map(({icon, ...item}, index) => (
                  <TabItem
                    key={item.id ?? index}
                    href={item.href ?? ''}
                    value={item.href ?? index}
                    icon={!icon?.path ? icon : <MdiIcon {...icon} />}
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
        )}
      </ElevateOnScroll>

      <Box
        component="main"
        sx={{flexGrow: 1}}
      >
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
                    fontSize: `1.5em`,
                    borderWidth: `1px`,
                    borderStyle: 'solid',
                    borderColor: 'tertiary.dark',
                    color: 'quaternary.contrastText',
                    bgcolor: 'quaternary.main',
                    borderRadius: (theme) => `${theme.shape.appIconBorderRadius}`,
                  }, headerIcon['sx'])}
                />
              )}
              {headerChildren}
            </Typography>

            {disableBreadcrumbs ? null : (
              <BreadcrumbsComponent
                items={breadcrumbs}
                sx={{
                  my: 2,
                  marginTop: 1,
                  color: 'text.primary',
                  'a': {
                    textDecoration: 'none',
                    ':hover': {
                      color: 'secondary.main',
                    },
                  },
                }}
              />
            )}
          </Container>
        </BackgroundImageComponent>

        {children}
      </Box>

      <FooterComponent />
    </>
  )
}
LayoutDashboardComponent.displayName = 'LayoutDashboardComponent'
LayoutDashboardComponent.defaultProps = {
  navTabItems: undefined,
  breadcrumbItems: [],
  disableBreadcrumbs: false,
  disableDefaultBreadcrumb: false,
}
LayoutDashboardComponent.layoutComponent = LayoutConsoleComponent
LayoutDashboardComponent.layoutProps = {
  LayoutConsoleComponent: {
    disableAppBarElevation: true,
  },
}

export {LayoutDashboardComponent}
export default LayoutDashboardComponent
