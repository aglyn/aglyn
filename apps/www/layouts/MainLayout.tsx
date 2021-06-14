/**
 * @license
 * Copyright (c) 2021 Aglyn LLC
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the root directory of this source tree.
 */

import {
  AglynIcon,
  GridButtons,
  GridButtonsProps,
  Menu,
  SvgPathIcon,
} from '@aglyn/shared/ui/react'
import { _isArr } from '@aglyn/shared/util/helpers'
import AppBar from '@material-ui/core/AppBar'
import Avatar from '@material-ui/core/Avatar'
import Box from '@material-ui/core/Box'
import Button from '@material-ui/core/Button'
import { cyan } from '@material-ui/core/colors'
import Container from '@material-ui/core/Container'
import IconButton, { IconButtonProps } from '@material-ui/core/IconButton'
import { createStyles, darken, Theme, WithStyles, withStyles } from '@material-ui/core/styles'
import Tab, { TabProps } from '@material-ui/core/Tab'
import Tabs from '@material-ui/core/Tabs'
import Toolbar from '@material-ui/core/Toolbar'
import Typography from '@material-ui/core/Typography'
import clsx from 'clsx'
import Head from 'next/head'
import { useRouter } from 'next/router'
import React, { Fragment, PropsWithChildren } from 'react'
import { Props as BreadcrumbsProps } from '../components/Breadcrumbs'
import Copyright from '../components/Copyright'
import Link, { LinkProps as LinkProps } from '../components/Link'
import { APP, tailNavigation } from '../const'
import { withCurrentUserCtx } from '../contexts/current-user-context'
import { withAggregatedPageMeta } from '../lib/app-pages'
import { getGravatarUrl } from '../lib/gravatar'


export const styles = (theme: Theme) => createStyles({
  navBar: {},
  navBarSpacer: {
    display: 'flex',
    width: '100%',
    height: 96,
  },
  appBar: {
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
    '& $menu': {
      padding: theme.spacing(0.5, 0.25),
      '&:last-child': { paddingLeft: theme.spacing(0.75) },
    },
  },
  left: {
    flexGrow: 1,
    display: 'flex',
  },
  center: {
    display: 'flex',
    flexGrow: 1,
    flexBasis: '72%',
  },
  right: { display: 'flex' },
  logoWrapper: {
    height: 36,
    flex: '0 0 auto',
    margin: theme.spacing(0.75, 0),
    display: 'flex',
    alignItems: 'center',
    '& a': {
      display: 'flex',
      alignItems: 'center',
      '& $logo': {
        display: 'flex',
        alignItems: 'center',
        '& $icon': {
          // color: '#36ca94', // Hulu
          color: theme.palette.secondary.light,
          lineHeight: '22px',
          fontSize: theme.typography.pxToRem(50),
          height: 'auto',
          [theme.breakpoints.up('md')]: { fontSize: theme.typography.pxToRem(60) },
        },
      },
      '& $product': {
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
      },
    },
  },
  logo: {},
  product: {},
  tabBar: {},
  tabBarTitle: {
    paddingRight: theme.spacing(2),
    fontWeight: theme.typography.fontWeightLight,
  },
  tabs: {
    '& $flexContainer': { alignItems: 'center' },
    '& $tabIndicator': {
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
  },
  tabIndicator: {},
  tab: {
    '& $wrapper': {
      flexDirection: 'row',
      '& > *:first-child': {
        marginBottom: 0,
        marginRight: theme.spacing(1),
      },
    },
    '& $icon': {},
    '&$labelIcon': {
      minHeight: 46,
      minWidth: 'auto',
      paddingLeft: 0,
      paddingRight: 0,
      marginLeft: theme.spacing(4),
      '&:first-child': { marginLeft: theme.spacing(0) },
    },
  },
  avatarButton: {
    padding: theme.spacing(0.5),
    '& $avatar': { backgroundColor: cyan[600] },
  },
  avatar: {},
  header: {
    paddingTop: theme.spacing(8),
    paddingBottom: theme.spacing(10),
    background: theme.palette.brand.purple['600'],
    color: theme.palette.getContrastText(theme.palette.brand.purple['600']),
  },
  heading: {
    letterSpacing: '-0.04em',
    fontWeight: theme.typography.fontWeightRegular,
    display: 'inline-flex',
    alignItems: 'center',
    '& $icon': {
      marginRight: theme.spacing(1),
      color: theme.palette.secondary.main,
    },
  },
  breadcrumbs: {
    marginTop: theme.spacing(1),
    color: darken(theme.palette.getContrastText(theme.palette.brand.purple['600']), 0.12),
    '& $item': {
      color: 'inherit',
      '&$last': {
        color: theme.palette.getContrastText(theme.palette.brand.purple['600']),
        fontWeight: theme.typography.fontWeightMedium,
      },
    },
  },
  content: { marginTop: theme.spacing(-6) },
  footer: {},
  main: {},

  // NESTED PROPERTIES TO KEEP EMPTY
  menu: {}, // Keep Empty
  icon: {}, // Keep Empty
  iconBtn: {}, // Keep Empty
  button: {}, // Keep Empty
  wrapper: {}, // Keep Empty
  labelIcon: {}, // Keep Empty
  item: {}, // Keep Empty
  last: {}, // Keep Empty
  flexContainer: {}, // Keep Empty
})

function a11yProps(index) {
  return {
    id: `scrollable-auto-tab-${index}`,
    'aria-controls': `scrollable-auto-tabpanel-${index}`,
  }
}

export const NAVIGATION_MAX_WIDTH = 'lg'
export const FOOTER_MAX_WIDTH = 'lg'

export interface Props extends PropsWithChildren<{}> {
  title?: string
  tabBarTitle?: string
  centerNavigationItems?: Array<any>
  breadcrumbItems?: BreadcrumbsProps['items']
  navTabItems?: (TabProps & LinkProps & { iconId: string })[]
  quickActionMenus?: (IconButtonProps & { iconId: string })[]
  productName?: string
  footerNavItems?: GridButtonsProps['items']
}

const MainLayout = withCurrentUserCtx<Props & WithStyles<typeof styles>>(
  withAggregatedPageMeta(
    function RefRenderFn(props) {
      const router = useRouter()
      const {
        classes,
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

      const buildIconButton = ({ avatar, iconId, children, ...item }, i) => (
        <IconButton
          key={item.id ?? item.href ?? i}
          className={clsx(classes.iconBtn, { [classes.avatarButton]: Boolean(avatar) })}
          color="inherit"
          {...item}
        >
          {avatar
            ? (<Avatar {...avatar} className={classes.avatar} />)
            : iconId && (<SvgPathIcon className={classes.icon} iconId={iconId} />)
          }
          {children}
        </IconButton>
      )

      const buildTextButton = (item, key) => (
        <Button
          key={key}
          color="inherit"
          {...item}
          className={
            clsx(classes.button, {
              [classes.avatarButton]: Boolean(item.avatar),
            }, item.className)
          }
        />
      )

      const buildNav = (actionBuilder) => (item, key) => (
        _isArr(item.items) ? (
          <Menu key={key} className={classes.menu} items={item.items}>
            {actionBuilder(item, key)}
          </Menu>
        ) : (
          <Fragment key={key}>
            {actionBuilder(item, key)}
          </Fragment>
        )
      )

      return (
        <React.Fragment>
          <Head>
            <title children={title ?? 'Web App'} />
          </Head>
          <AppBar
            // component="header"
            className={classes.navBar}
            color="transparent"
            elevation={3}
            position="fixed"
          >
            <AppBar className={classes.appBar} color="primary" elevation={0} position="relative">
              <Container maxWidth={NAVIGATION_MAX_WIDTH} disableGutters>
                <Toolbar>
                  <div className={classes.left}>
                    <div className={classes.logoWrapper}>
                      <Link as="/" color="inherit" href="/" underline="none">
                        <span className={classes.logo}>
                          <AglynIcon
                            className={classes.icon}
                            color="inherit"
                          />
                        </span>
                        {productName && (
                          <span
                            className={classes.product}
                            children={` ${productName}`}
                          />
                        )}
                      </Link>
                    </div>
                  </div>
                  <div className={classes.center}>
                    {(centerNavigationItems ?? []).map(buildNav(buildTextButton))}
                  </div>
                  <div className={classes.right}>
                    {(quickActions ?? []).map(buildNav(buildIconButton))}
                  </div>
                </Toolbar>
              </Container>
            </AppBar>
            {(tabBarTitle || _isArr(navTabItems)) && (
              <AppBar className={classes.tabBar} color="primary" elevation={0} position="static">
                <Container maxWidth={NAVIGATION_MAX_WIDTH}>
                  <Tabs
                    aria-label="area navigation"
                    className={classes.tabs}
                    classes={{
                      flexContainer: classes.flexContainer,
                      indicator: classes.tabIndicator,
                    }}
                    indicatorColor="secondary"
                    scrollButtons="auto"
                    textColor="inherit"
                    value={tabValue}
                    variant="scrollable"
                  >
                    {tabBarTitle && (
                      <Typography
                        children={tabBarTitle}
                        className={classes.tabBarTitle}
                        component="div"
                        variant="h6"
                      />
                    )}
                    {navTabItems && navTabItems.map(({ iconId, ...item }, i) => (
                      <Tab
                        key={item.id ?? item.href ?? i}
                        classes={{
                          root: classes.tab,
                          wrapper: classes.wrapper,
                          labelIcon: classes.labelIcon,
                        }}
                        // disableRipple
                        color="inherit"
                        component={Link}
                        href={item.href ?? ''}
                        icon={<SvgPathIcon className={classes.icon} iconId={iconId} />}
                        label={item.label}
                        underline="none"
                        value={item.href ?? i}
                        wrapped
                        {...a11yProps(i)}
                        {...item}
                      />
                    ))}
                  </Tabs>
                </Container>
              </AppBar>
            )}
          </AppBar>
          <main className={classes.main}>
            {children}
          </main>
          <footer className={classes.footer}>
            <Container maxWidth={FOOTER_MAX_WIDTH}>
              <Box
                alignItems="center"
                borderColor="divider"
                borderTop={1}
                display="flex"
                flexWrap="wrap"
                mt={6}
                pb={1}
                pt={2}
              >
                <div className={classes.left}>
                  <Copyright />
                </div>
                <div className={classes.right}>
                  <GridButtons
                    items={footerNavItems.map(i=>({size: 'small', ...i}))}
                    spacing={1}
                  />
                </div>

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
                    <span children={`Version ${APP.VERSION}`} />
                    {' '}
                    <span children={`(${APP.BUILD_ID})`} />
                  </Typography>
                </Box>
              </Box>
            </Container>
          </footer>
        </React.Fragment>
      )
    }, 'aggregatedPageMeta',
  ),
)

MainLayout.displayName = 'Layout:MainLayout'
MainLayout.defaultProps = {
  footerNavItems: tailNavigation,
}

export default withStyles(styles, { name: 'Layout:MainLayout' })(MainLayout)
