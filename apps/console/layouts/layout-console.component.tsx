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

import {mergeSxProps} from '@aglyn/shared-feature-themes'
import {BackgroundImageComponent, GridItems, type GridItemsProps} from '@aglyn/shared-ui-jsx'
import {mdiCogOutline, MdiIcon, type MdiIconProps} from '@aglyn/shared-ui-mdi-jsx'
import {_isArr} from '@aglyn/shared-util-guards'
import {Container, Typography} from '@mui/material'
import type {ReactNode} from 'react'
import {isElement} from 'react-is'
// import {type CurrentUserContextType} from '../contexts/current-user-context'
// import {type AggregatedPageMeta} from '../lib/app-pages'
// import {tabItems} from '../lib/navigation-menus'
import BreadcrumbsComponent from '../components/breadcrumbs.component'
import LayoutMainComponent, {type MainLayoutProps as MainLayoutProps} from './layout-main.component'


export const CONTENT_MAX_WIDTH = 'xl'
const getHeader = (first, second) => (
  <span>
    <b>{first}:</b> {second}
  </span>
)

export interface ConsoleLayoutProps extends MainLayoutProps {
  ContentGridItemsProps?: GridItemsProps
  items?: GridItemsProps['items']
  header?: {
    icon?: MdiIconProps | ReactNode
    children?: ReactNode
  }
  aggregatedPageMeta?: any//AggregatedPageMeta
  currentUserContext?: any//CurrentUserContextType
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
  const {pageMeta, overrideMeta, pageAncestors} = aggregatedPageMeta || {}
  const title = titleProp ?? (overrideMeta ?? pageMeta)?.title
  const [rootArea, mainArea, subArea] = pageAncestors || []
  const header = {
    icon: {path: mainArea?.icon},
    children: getHeader(
      mainArea ? mainArea?.name?.default : rootArea?.name?.default,
      subArea ? subArea?.name?.plural : (overrideMeta ?? pageMeta)?.name?.default,
    ),
    ...headerProp,
  }
  const breadcrumbItems = breadcrumbItemsProp || [] /*?? (copy(pageAncestors || []) as any[]))*/
  // .concat((overrideMeta ?? pageMeta) || [])
  // .map((item: any) => ({
  //   href: _s(item?.id),
  //   children: item?.name.plural,
  // }))
  const quickActionMenus: MainLayoutProps['quickActionMenus'] = [
    {
      icon: {path: mdiCogOutline.path},
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
    <LayoutMainComponent
      navTabItems={[]/*tabItems as any*/}
      title={title ? [..._isArr(title) ? title : [title], 'Secure'] : 'Secure'}
      productName={'Console'}
      quickActionMenus={quickActionMenus}
      {...rest}
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
            })}
          >
            {!header?.icon || isElement(header.icon) ? header.icon : (
              <MdiIcon
                color="inherit"
                {...header.icon}
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
                }, header.icon?.['sx'])}
              />
            )}
            {header?.children ?? title}
          </Typography>
          <BreadcrumbsComponent
            items={breadcrumbItems as any}
            sx={{my: 2}}
          />
        </Container>
      </BackgroundImageComponent>
      <main /*className={classes.content}*/>
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
    </LayoutMainComponent>
  )
}

ConsoleLayoutRaw.displayName = 'LayoutConsoleComponent'
ConsoleLayoutRaw.defaultProps = {}

export const LayoutConsoleComponent = /*withCurrentUserContext(withAggregatedPageMeta(*/ConsoleLayoutRaw/*))*/
export default LayoutConsoleComponent
