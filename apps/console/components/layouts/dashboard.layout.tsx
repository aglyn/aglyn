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

import { ICON_VARIANT_HOME } from '@aglyn/shared-data-enums'
import { Box, Stack } from '@mui/material'
import { useMemo } from 'react'
import DashboardHeaderComponent, {
  type DashboardHeaderProps,
} from '../dashboard-header.component'
import FooterComponent from '../footer.component'
import QuotaWarningsBanner from '../quota-warnings-banner.component'
import { type SecondaryAppBarProps } from '../secondary-app-bar.component'

const defaultBreadcrumbs = [
  {
    id: 'home',
    // children: 'Home',
    href: '/',
    icon: { path: ICON_VARIANT_HOME.path },
  },
]

export interface DashboardLayoutProps {
  children?: JSX.Children
  breadcrumbItems?: DashboardHeaderProps['breadcrumbItems']
  disableBreadcrumbs?: DashboardHeaderProps['disableBreadcrumbs']
  disableDefaultBreadcrumb?: true
  header?: DashboardHeaderProps['header']
  headerRight?: DashboardHeaderProps['headerRight']
  help?: DashboardHeaderProps['help']
  /**
   * Accepted and ignored: the secondary app bar moved to the `(app)` layout
   * and derives its own strip from the route (AGL-755). Kept on the type so
   * the 41 existing call sites keep compiling until AGL-756 sweeps them.
   *
   * @deprecated
   */
  tabBarTitle?: SecondaryAppBarProps['tabBarTitle']
  /** @deprecated see {@link DashboardLayoutProps.tabBarTitle} */
  navTabItems?: SecondaryAppBarProps['navTabItems']
  /** @deprecated see {@link DashboardLayoutProps.tabBarTitle} */
  activeTab?: SecondaryAppBarProps['activeTab']
  aside?: JSX.Node
}

export function DashboardLayout(props: DashboardLayoutProps) {
  const {
    children,
    header,
    help,
    breadcrumbItems,
    disableBreadcrumbs,
    disableDefaultBreadcrumb = false,
    headerRight,
    aside,
  } = props

  const breadcrumbs = useMemo(() => {
    return [
      ...(disableDefaultBreadcrumb ? [] : defaultBreadcrumbs),
      ...(Array.isArray(breadcrumbItems) ? breadcrumbItems : []),
    ]
  }, [breadcrumbItems, disableDefaultBreadcrumb])

  return (
    <>
      <Stack component="main" direction="column" sx={{ flexGrow: 1 }}>
        {/* Site-wide usage-cap banner (AGL-136). */}
        <QuotaWarningsBanner />
        <DashboardHeaderComponent
          disableBreadcrumbs={disableBreadcrumbs}
          breadcrumbItems={breadcrumbs}
          headerRight={headerRight}
          header={header}
          help={help}
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
