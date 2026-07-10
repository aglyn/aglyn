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
'use client'

import { RELEASE_FLAGS } from '@aglyn/aglyn'
import {
  ICON_VARIANT_HOME,
  ICON_VARIANT_SYMBOL_FLAG,
  ICON_VARIANT_SYMBOL_SECURE,
} from '@aglyn/shared-data-enums'
import { MdiIcon } from '@aglyn/shared-ui-jsx'
import { Box, Stack } from '@mui/material'
import { useParams } from 'next/navigation'
import { useMemo } from 'react'
import { buildRoute, Route } from '../../constants/route-links'
import { useReleaseFlags } from '../../hooks/use-release-flags'
import DashboardHeaderComponent, {
  type DashboardHeaderProps,
} from '../dashboard-header.component'
import FooterComponent from '../footer.component'
import HostSwitcherNavComponent from '../host-switcher-nav.component'
import QuotaWarningsBanner from '../quota-warnings-banner.component'
import SecondaryAppBarComponent, {
  type SecondaryAppBarProps,
} from '../secondary-app-bar.component'

const defaultTabBarTitle = (
  <Stack
    direction="row"
    spacing={{ sm: 0.15, md: 0.5 }}
    sx={{
      alignItems: 'center',
      typography: 'subtitle2',
      lineHeight: 'normal',
      color: 'tertiary.main',
    }}
  >
    <MdiIcon path={ICON_VARIANT_SYMBOL_SECURE.path} fontSize={'small'} />
    <HostSwitcherNavComponent />
    {/*<span>{'Secure'}</span>*/}
  </Stack>
)

const defaultBreadcrumbs = [
  {
    id: 'home',
    // children: 'Home',
    href: '/',
    icon: { path: ICON_VARIANT_HOME.path },
  },
]

// Nav tabs governed by a release flag (AGL-229), keyed by tab id.
const NAV_TAB_RELEASE_FLAGS = new Map(
  RELEASE_FLAGS.filter((definition) => definition.navTabId).map(
    (definition) => [definition.navTabId, definition],
  ),
)

export interface DashboardLayoutProps {
  children?: JSX.Children
  breadcrumbItems?: DashboardHeaderProps['breadcrumbItems']
  disableBreadcrumbs?: DashboardHeaderProps['disableBreadcrumbs']
  disableDefaultBreadcrumb?: true
  header?: DashboardHeaderProps['header']
  headerRight?: DashboardHeaderProps['headerRight']
  tabBarTitle?: SecondaryAppBarProps['tabBarTitle']
  navTabItems?: SecondaryAppBarProps['navTabItems']
  activeTab?: SecondaryAppBarProps['activeTab']
  aside?: JSX.Node
}

export function DashboardLayout(props: DashboardLayoutProps) {
  const {
    children,
    header,
    breadcrumbItems,
    disableBreadcrumbs,
    disableDefaultBreadcrumb = false,
    tabBarTitle,
    navTabItems,
    headerRight,
    aside,
    activeTab,
  } = props
  const params = useParams<{ hostId: string }>()
  const hostId = params?.hostId
  const { flags, isStaff } = useReleaseFlags()

  const breadcrumbs = useMemo(() => {
    return [
      ...(disableDefaultBreadcrumb ? [] : defaultBreadcrumbs),
      ...(Array.isArray(breadcrumbItems) ? breadcrumbItems : []),
    ]
  }, [breadcrumbItems, disableDefaultBreadcrumb])

  // Release-flag gating (AGL-229): flagged-off tabs disappear for
  // customers; staff keep them with a flag badge so unreleased surfaces
  // are recognizably unlaunched.
  const gatedNavTabItems = useMemo(() => {
    const source = navTabItems ?? [
      {
        id: 'nav-tab-dashboard',
        label: 'Dashboard',
        href: buildRoute(Route.HOST_DASHBOARD, {
          hostId,
        }),
      },
      {
        id: 'nav-tab-screens',
        label: 'Screens',
        href: buildRoute(Route.SCREEN_LIST, {
          hostId,
        }),
      },
    ]
    return source.flatMap((item) => {
      const definition = item.id
        ? NAV_TAB_RELEASE_FLAGS.get(item.id)
        : undefined
      if (!definition || flags[definition.key].released) return [item]
      if (!isStaff) return []
      return [
        {
          ...item,
          icon: { path: ICON_VARIANT_SYMBOL_FLAG.path },
          title: `${definition.label} is hidden from customers by release flag ${definition.key}`,
        },
      ]
    })
  }, [navTabItems, hostId, flags, isStaff])

  return (
    <>
      <SecondaryAppBarComponent
        tabBarTitle={tabBarTitle ?? defaultTabBarTitle}
        activeTab={activeTab}
        navTabItems={gatedNavTabItems}
      />

      <Stack component="main" direction="column" sx={{ flexGrow: 1 }}>
        {/* Site-wide usage-cap banner (AGL-136). */}
        <QuotaWarningsBanner />
        <DashboardHeaderComponent
          disableBreadcrumbs={disableBreadcrumbs}
          breadcrumbItems={breadcrumbs}
          headerRight={headerRight}
          header={header}
        />

        <Box component="section" sx={{ flexGrow: 1 }}>
          {children}
        </Box>

        <FooterComponent />
      </Stack>

      {aside}
    </>
  )
}
DashboardLayout.displayName = 'DashboardLayout'
DashboardLayout.aglyn = true

export default DashboardLayout
