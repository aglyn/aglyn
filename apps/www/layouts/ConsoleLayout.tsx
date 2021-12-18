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

import {styled} from '@aglyn/shared-feature-themes'
import {GridItems, GridItemsProps} from '@aglyn/shared-ui-jsx'
import {mdiCogOutline, MdiIcon, MdiIconProps} from '@aglyn/shared-ui-mdi-jsx'
import {_isStrT} from '@aglyn/shared-util-guards'
import {_s, copy} from '@aglyn/shared-util-tools'
import Container from '@mui/material/Container'
import Typography from '@mui/material/Typography'
import {ReactNode} from 'react'
import Breadcrumbs from '../components/Breadcrumbs'
import {CurrentUserContextType, withCurrentUserContext} from '../contexts/current-user-context'
import {AggregatedPageMeta, withAggregatedPageMeta} from '../lib/app-pages'
import {tabItems} from '../lib/navigation-menus'
import MainLayout, {MainLayoutProps as MainLayoutProps} from './MainLayout'


export const CONTENT_MAX_WIDTH = 'lg'
const getHeader = (first, second) => (
  <span>
    <b>{first}:</b> {second}
  </span>
)

const StyledNavBarSpacer = styled('div', {
  name: 'NavBarSpacer',
})({
  display: 'flex',
  width: '100%',
  height: 96,
})

export interface ConsoleLayoutProps extends MainLayoutProps {
  ContentGridItemsProps?: GridItemsProps
  items?: GridItemsProps['items']
  header?: {
    icon?: MdiIconProps['path'] | ReactNode
    children?: ReactNode
  }
  aggregatedPageMeta: AggregatedPageMeta
  currentUserContext: CurrentUserContextType
}

function ConsoleLayoutRaw(props: ConsoleLayoutProps) {
  const {
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
  const {pageMeta, overrideMeta, pageAncestors} = aggregatedPageMeta
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
  const breadcrumbItems = (breadcrumbItemsProp ?? (copy(pageAncestors) as any[]))
    .concat(overrideMeta ?? pageMeta)
    .map((item: any) => ({
      href: _s(item?.id),
      children: item?.name.plural,
    }))
  const quickActionMenus: MainLayoutProps['quickActionMenus'] = [
    {
      iconPath: mdiCogOutline.path,
      // alt: '',
      items: [
        {
          dense: true,
          children: 'Change Theme',
        },
      ],
    },
    {
      title: 'User Account',
      // avatar: {
      //   alt: currentUserContext.currentUser?.displayName,
      //   src: gravatarUrlFromEmail(currentUserContext.currentUser?.email),
      // },
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
      <header>
        <StyledNavBarSpacer />
        <Container maxWidth={CONTENT_MAX_WIDTH}>
          <Typography component="h1" variant="h4">
            {_isStrT(header?.icon) ? (
              <MdiIcon
                color="secondary"
                fontSize="inherit"
                path={header.icon}
              />
            ) : header?.icon}
            {header?.children ?? title}
          </Typography>
          <Breadcrumbs items={breadcrumbItems} />
        </Container>
      </header>
      <main /*className={classes.content}*/>
        <Container maxWidth={CONTENT_MAX_WIDTH}>
          {items || ContentGridItemsProps ? (
            <GridItems items={items} spacing={3} {...ContentGridItemsProps} />
          ) : null}
          {children}
        </Container>
      </main>
    </MainLayout>
  )
}

ConsoleLayoutRaw.displayName = 'ConsoleLayout'
ConsoleLayoutRaw.defaultProps = {}

export const ConsoleLayout = withCurrentUserContext(withAggregatedPageMeta(ConsoleLayoutRaw))
export default ConsoleLayout
