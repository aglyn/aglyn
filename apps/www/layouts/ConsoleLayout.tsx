/**
 * @license
 * Copyright (c) 2021 Aglyn LLC
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the root directory of this source tree.
 */

import { GridItems, GridItemsProps, SvgPathIcon, SvgPathIconProps } from '@aglyn/shared/ui/react'
import { _isStr, copy, s } from '@aglyn/shared/util/helpers'
import Container from '@material-ui/core/Container'
import { createStyles, Theme, WithStyles, withStyles } from '@material-ui/core/styles'
import Typography from '@material-ui/core/Typography'
import clsx from 'clsx'
import React from 'react'
import Breadcrumbs from '../components/Breadcrumbs'
import { withCurrentUserCtx } from '../contexts/current-user-context'
import { withAggregatedPageMeta } from '../lib/app-pages'
import { getGravatarUrl } from '../lib/gravatar'
import { tabItems } from '../lib/navigation-menus'
import MainLayout, { Props as MainLayoutProps, styles as mainStyles } from './MainLayout'


const getHeader = (first, second) => (<span><b>{first}:</b> {second}</span>)

const styles = (theme: Theme) => createStyles({
  ...mainStyles(theme),
})

export const CONTENT_MAX_WIDTH = 'lg'

export interface Props extends MainLayoutProps {
  ContentGridItemsProps?: GridItemsProps
  items?: GridItemsProps['items']
  header?: {
    icon?: SvgPathIconProps['iconId'] | SvgPathIconProps
    children?: React.ReactNode
  }
}

const ConsoleLayout = withCurrentUserCtx<Props & WithStyles<typeof styles>>(
  withAggregatedPageMeta(
    function RenderFn(props) {
      const {
        classes,
        header: headerProp,
        aggregatedPageMeta,
        title: titleProp,
        items,
        breadcrumbItems: breadcrumbItemsProp,
        ContentGridItemsProps,
        children,
        currentUserContext,
        ...rest
      } = props
      const {
        pageMeta,
        overrideMeta,
        pageAncestors,
      } = aggregatedPageMeta
      const title = titleProp ?? (overrideMeta ?? pageMeta)?.title
      const [rootArea, mainArea, subArea] = pageAncestors
      const header = {
        icon: mainArea?.icon,
        children: getHeader(
          mainArea ? mainArea.name.default : rootArea?.name.default,
          subArea ? subArea.name.plural : (overrideMeta ?? pageMeta)?.name.default,
        ),
        ...headerProp,
      }
      const breadcrumbItems = (breadcrumbItemsProp ?? copy(pageAncestors))
      .concat(overrideMeta ?? pageMeta)
      .map((item: any) => ({
        href: s(item?.id),
        children: item?.name.plural,
      }))
      const quickActionMenus = [
        {
          iconId: 'cog-outline',
          alt: '',
          items: [
            {
              dense: true,
              children: 'Change Theme',
            },
          ],
        },
        {
          title: 'User Account',
          avatar: {
            alt: currentUserContext.currentUser?.displayName,
            src: getGravatarUrl(currentUserContext.currentUser?.email),
          },
          items: [
            {
              dense: true,
              children: 'Account Settings',
              href: '/settings/account',
            },
          ],
        },
      ]

      return (
        <MainLayout
          navTabItems={tabItems}
          title={title}
          productName={'console'}
          quickActionMenus={quickActionMenus}
          {...rest}
        >
          <header className={classes.header}>
            <div className={classes.navBarSpacer} />
            <Container maxWidth={CONTENT_MAX_WIDTH}>
              <Typography
                className={classes.heading}
                component="h1"
                variant="h4"
              >
                {header?.icon ? (
                  <SvgPathIcon
                    color="secondary"
                    fontSize="inherit"
                    {...(_isStr(header.icon) ? { iconId: header.icon } : header.icon)}
                    className={clsx(classes.icon, _isStr(header.icon) ? null : header.icon.className)}
                  />
                ) : null}
                {header?.children ?? title}
              </Typography>
              <Breadcrumbs
                classes={{
                  root: classes.breadcrumbs,
                  item: classes.item,
                  last: classes.last,
                }}
                items={breadcrumbItems}
              />
            </Container>
          </header>
          <main className={classes.content}>
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
        </MainLayout>
      )
    }, 'aggregatedPageMeta',
  ),
)

ConsoleLayout.displayName = 'Layout:ConsoleLayout'
ConsoleLayout.defaultProps = {}

export default withStyles(styles, { name: 'Layout:MainLayout' })(ConsoleLayout)
