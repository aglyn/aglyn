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

import {
  AglynSvgLogo,
  GridButtons,
  GridButtonsProps,
  Menu,
  SvgPathIcon,
} from '@aglyn/shared/ui/react'
import { darken, styled } from '@aglyn/shared/ui/themes'
import { _isArr } from '@aglyn/shared/util/helpers'
import AppBar from '@material-ui/core/AppBar'
import Avatar from '@material-ui/core/Avatar'
import Box from '@material-ui/core/Box'
import { cyan, purple } from '@material-ui/core/colors'
import Container from '@material-ui/core/Container'
import IconButton, { IconButtonProps } from '@material-ui/core/IconButton'
import Tab, { TabProps } from '@material-ui/core/Tab'
import Tabs from '@material-ui/core/Tabs'
import Toolbar from '@material-ui/core/Toolbar'
import Typography from '@material-ui/core/Typography'
import Head from 'next/head'
import { useRouter } from 'next/router'
import { Fragment, ReactNode } from 'react'
import { Props as BreadcrumbsProps } from '../components/Breadcrumbs'
import Copyright from '../components/Copyright'
import Link, { LinkProps as LinkProps } from '../components/Link'
import { APP, tailNavigation } from '../const'
import { CurrentUserContext, withCurrentUserCtx } from '../contexts/current-user-context'
import { AggregatedPageMeta, withAggregatedPageMeta } from '../lib/app-pages'


const StyledLogo = styled(AglynSvgLogo, {
  name: 'AglynSvgLogo'
})(({theme}) => ({
  // color: '#36ca94', // Hulu
  color: theme.palette.secondary.light,
  lineHeight: '22px',
  fontSize: theme.typography.pxToRem(50),
  height: 'auto',
  [theme.breakpoints.up('md')]: {fontSize: theme.typography.pxToRem(60)},
}))

const StyledAppBar = styled(AppBar, {
  name: 'AppBar'
})(({theme}) => ({
  '&:after': {
    content: '" "',
    left: 0,
    right: 0,
    bottom: 0,
    height: 1,
    width: '100%',
    position: 'absolute',
    backgroundColor: theme.palette.divider,
  },
}))

const StyledNavBarSpacer = styled('div', {
  name: 'NavBarSpacer'
})({
  display: 'flex',
  width: '100%',
  height: 96,
})

const StyledLeft = styled('div', {
  name: 'Left'
})({
  flexGrow: 1,
  display: 'flex',
})

const StyledCenter = styled('div', {
  name: 'Center'
})({
  display: 'flex',
  flexGrow: 1,
  flexBasis: '72%',
})

const StyledRight = styled('div', {
  name: 'Right'
})({
  display: 'flex',
})

const StyledLogoWrapper = styled('div', {
  name: 'StyledLogoWrapper'
})(({theme}) => ({
  height: 36,
  flex: '0 0 auto',
  margin: theme.spacing(0.75, 0),
  display: 'flex',
  alignItems: 'center',
  '& a': {
    display: 'flex',
    alignItems: 'center',
  },
}))

const StyledLogoInner = styled('span', {
  name: 'LogoInner'
})({
  display: 'flex',
  alignItems: 'center',
})

const StyledProductName = styled('span', {
  name: 'ProductName'
})(({theme}) => ({
  color: theme.palette.common.white,
  paddingLeft: theme.spacing(0.75),
  fontWeight: theme.typography.fontWeightLight,
  paddingBottom: 2,
  display: 'flex',
  alignItems: 'center',
  lineHeight: '22px',
  fontSize: theme.typography.pxToRem(20),
  [theme.breakpoints.up('md')]: {
    lineHeight: '24px',
    fontSize: theme.typography.pxToRem(22),
  },
}))

const StyledTabs = styled(Tabs, {
  name: 'Tabs'
})(({theme}) => ({
  '& .Mui-flexContainer': {
    alignItems: 'center',
  },
  '& .Mui-indicator': {
    height: 3,
    backgroundColor: 'unset',
    '&:after': {
      borderRadius: '3px 3px 0 0',
      content: '" "',
      display: 'block',
      position: 'absolute',
      left: 0, top: 0, right: 0,
      margin: '0 auto',
      width: '80%',
      height: '100%',
      backgroundColor: theme.palette.secondary.light,
    },
  },
}))

const StyledTab = styled(Tab, {
  name: 'Tab'
})(({theme}) => ({
  flexDirection: 'row',
  '& > *:first-child': {
    marginBottom: 0,
    marginRight: theme.spacing(1),
  },
  '& .Mui-labelIcon': {
    minHeight: 46,
    minWidth: 'auto',
    paddingLeft: 0,
    paddingRight: 0,
    marginLeft: theme.spacing(4),
    '&:first-child': {
      marginLeft: theme.spacing(0),
    },
  },
}))

const StyledAvatar = styled(Avatar, {
  name: 'Avatar'
})({
  backgroundColor: cyan[600],
})

const StyledContent = styled('main', {
  name: 'Content'
})(({theme}) => ({
  // marginTop: theme.spacing(-6),
}))

const StyledMenu = styled(Menu, {
  name: 'Menu'
})(({theme}) => ({
  padding: theme.spacing(0.5, 0.25),
  '&:last-child': {paddingLeft: theme.spacing(0.75)},
}))

const StyledBreadcrumbs = styled('div', {
  name: 'Breadcrumbs'
})(({theme}) => ({
  marginTop: theme.spacing(1),
  color: darken(theme.palette.getContrastText(purple['600']), 0.12),

  // TODO: Item class name
  // color: 'inherit',

  // TODO: Last item class name
  // color: theme.palette.getContrastText(purple['600']),
  // fontWeight: theme.typography.fontWeightMedium,
}))

function a11yProps(index) {
  return {
    id: `scrollable-auto-tab-${index}`,
    'aria-controls': `scrollable-auto-tabpanel-${index}`,
  }
}

export const NAVIGATION_MAX_WIDTH = 'lg'
export const FOOTER_MAX_WIDTH = 'lg'

export interface MainLayoutProps {
  children?: ReactNode | undefined
  title?: string
  tabBarTitle?: string
  centerNavigationItems?: Array<any>
  breadcrumbItems?: BreadcrumbsProps['items']
  navTabItems?: (TabProps & LinkProps & { iconId: string })[]
  quickActionMenus?: (IconButtonProps & { iconId: string })[]
  productName?: string
  footerNavItems: GridButtonsProps['items']
  aggregatedPageMeta: AggregatedPageMeta
  currentUserContext: CurrentUserContext
}

const MainLayout = function RefRenderFn(props: MainLayoutProps) {
  const router = useRouter()
  const {
    children,
    title,
    centerNavigationItems,
    currentUserContext,
    tabBarTitle,
    aggregatedPageMeta,
    navTabItems,
    productName,
    footerNavItems,
    quickActionMenus: quickActions,
  } = props
  const {
    pageMeta,
    overrideMeta,
    pageAncestors,
  } = aggregatedPageMeta
  const tabValue = !navTabItems ? '' : navTabItems
  .filter(i => router.asPath.includes(i.href))
  .reduce((prev, current) =>
    current.href.length > prev.href.length ? current : prev,
  ).href ?? ''

  const buildIconButton = ({avatar, iconId, children, ...item}, i) => (
    <IconButton
      key={item.id ?? item.href ?? i}
      color="inherit"
      sx={{p: avatar ? 0.5 : undefined}}
      {...item}
    >
      {avatar
        ? (<StyledAvatar {...avatar}/>)
        : iconId && (<SvgPathIcon iconId={iconId}/>)
      }
      {children}
    </IconButton>
  )

  const buildTextButton = (item, key) => (
    <Link
      key={key}
      button
      color="inherit"
      sx={{p: item?.avatar ? 0.5 : undefined}}
      {...item}
    />
  )

  // eslint-disable-next-line react/display-name
  const buildNav = (id, actionBuilder) => (item, key) => (
    _isArr(item.items) ? (
      <StyledMenu key={id + key} items={item.items}>
        {actionBuilder(item, key)}
      </StyledMenu>
    ) : (
      <Fragment key={id + key}>
        {actionBuilder(item, key)}
      </Fragment>
    )
  )

  return (
    <Fragment>
      <Head>
        <title>{`${title ?? 'Web App'}`}</title>
      </Head>
      <AppBar
        // component="header"
        color="transparent"
        elevation={3}
        position="fixed"
      >
        <StyledAppBar color="primary" elevation={0} position="relative">
          <Container maxWidth={NAVIGATION_MAX_WIDTH} disableGutters>
            <Toolbar>
              <StyledLeft>
                <StyledLogoWrapper>
                  <Link hrefAs="/" color="inherit" href="/" underline="none">
                    <StyledLogoInner>
                      <StyledLogo color="inherit"/>
                    </StyledLogoInner>
                    {productName ? (<StyledProductName children={` ${productName}`}/>) : null}
                  </Link>
                </StyledLogoWrapper>
              </StyledLeft>
              <StyledCenter>
                {(centerNavigationItems ?? []).map(buildNav('cni', buildTextButton))}
              </StyledCenter>
              <StyledRight>
                {(quickActions ?? []).map(buildNav('qa', buildIconButton))}
              </StyledRight>
            </Toolbar>
          </Container>
        </StyledAppBar>
        {(tabBarTitle || _isArr(navTabItems)) ? (
          <AppBar color="primary" elevation={0} position="static">
            <Container maxWidth={NAVIGATION_MAX_WIDTH}>
              <StyledTabs
                aria-label="area navigation"
                indicatorColor="secondary"
                scrollButtons="auto"
                textColor="inherit"
                value={tabValue}
                variant="scrollable"
              >
                {tabBarTitle && (
                  <Typography
                    children={tabBarTitle}
                    component="div"
                    variant="h6"
                    sx={{
                      pr: 2,
                      fontWeight: 'fontWeightLight',
                    }}
                  />
                )}
                {navTabItems && navTabItems.map(({iconId, ...item}, i) => (
                  <StyledTab
                    key={item.id ?? item.href ?? i}
                    // disableRipple
                    color="inherit"
                    component={Link}
                    href={item.href ?? ''}
                    icon={<SvgPathIcon iconId={iconId}/>}
                    label={item.label}
                    underline="none"
                    value={item.href ?? i}
                    wrapped
                    {...a11yProps(i)}
                    {...item}
                  />
                ))}
              </StyledTabs>
            </Container>
          </AppBar>
        ) : null}
      </AppBar>
      <StyledContent>
        {children}
      </StyledContent>
      <footer>
        <Container maxWidth={FOOTER_MAX_WIDTH}>
          <Box
            component={'div'}
            sx={{
              mt:6,
              pb:1,
              pt:2,
              borderTop: 1,
              display: 'flex',
              flexWrap:'wrap',
              borderColor:'divider',
              alignItems: 'center',
            }}
          >
            <StyledLeft>
              <Copyright/>
            </StyledLeft>
            <StyledRight>
              <GridButtons
                items={footerNavItems.map(i => ({
                  size: 'small', component: Link, button: true, ...i,
                }))}
                spacing={1}
              />
            </StyledRight>

            <Box
              alignItems="space-around"
              display="flex"
              flex="1 1 auto"
              flexBasis="100%"
              justifyContent="center"
            >
              <Typography
                align="center"
                color="textSecondary"
                variant="overline"
              >
                <span>{`Version ${APP.VERSION}`}</span>
                {' '}
                <span>{`(${APP.BUILD_ID})`}</span>
              </Typography>
            </Box>
          </Box>
        </Container>
      </footer>
    </Fragment>
  )
}

MainLayout.displayName = 'MainLayout'
MainLayout.defaultProps = {
  footerNavItems: tailNavigation as any,
  aggregatedPageMeta: {} as any,
  currentUserContext: {} as any,
}

export default withCurrentUserCtx(withAggregatedPageMeta(
  MainLayout,
))
