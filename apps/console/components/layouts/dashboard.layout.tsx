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

import { PageHeaderActionsContext } from '@aglyn/aglyn'
import { ICON_VARIANT_HOME } from '@aglyn/shared-data-enums'
import { Box, Stack } from '@mui/material'
import { useMemo, useState } from 'react'
import DashboardHeaderComponent, {
  type DashboardHeaderProps,
} from '../dashboard-header.component'
import FooterComponent from '../footer.component'
import QuotaWarningsBanner from '../quota-warnings-banner.component'
import SearchDiscouragedBanner from '../search-discouraged-banner.component'

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
  /**
   * Controls for the right of the page header.
   *
   * A route that sets this owns its header outright and anything the page
   * body publishes through `PageHeaderActions` is ignored — one header, one
   * author. Leave it unset on a route that renders a surface it does not
   * write, which is what the shell's generic plugin route does.
   */
  headerRight?: DashboardHeaderProps['headerRight']
  help?: DashboardHeaderProps['help']
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

  /*
   * The page header's slot for a surface that does not own this layout.
   *
   * The shell's generic plugin route renders every plugin surface as a child
   * of one `DashboardLayout`, so a plugin's create button and quota readout
   * cannot arrive as `headerRight` — a child cannot set its parent's prop.
   * They arrive here instead, published by whichever descendant owns them
   * through `PageHeaderActions`, and cleared when that descendant unmounts.
   *
   * Publishing re-renders this layout and NOT the page body: `children` is
   * one element object built by the caller, so React reconciles it by
   * identity and skips the subtree, and the context value below is built once
   * so consumers are never re-rendered by a publish. Without both, a surface
   * that publishes on every render would re-render itself into a loop.
   */
  const [publishedHeaderActions, setHeaderActions] =
    useState<DashboardHeaderProps['headerRight']>(null)
  const headerActions = useMemo(() => ({ setHeaderActions }), [])

  const breadcrumbs = useMemo(() => {
    return [
      ...(disableDefaultBreadcrumb ? [] : defaultBreadcrumbs),
      ...(Array.isArray(breadcrumbItems) ? breadcrumbItems : []),
    ]
  }, [breadcrumbItems, disableDefaultBreadcrumb])

  return (
    <PageHeaderActionsContext.Provider value={headerActions}>
      <Stack component="main" direction="column" sx={{ flexGrow: 1 }}>
        {/* Site-wide usage-cap banner (AGL-136). */}
        <QuotaWarningsBanner />
        {/* "Hidden from search" indicator (AGL-1263) — persistent on purpose;
            a switch left on is invisible everywhere else. */}
        <SearchDiscouragedBanner />
        <DashboardHeaderComponent
          disableBreadcrumbs={disableBreadcrumbs}
          breadcrumbItems={breadcrumbs}
          headerRight={headerRight ?? publishedHeaderActions}
          header={header}
          help={help}
        />

        <Box component="section" sx={{ flexGrow: 1 }}>
          {children}
        </Box>

        <FooterComponent />
      </Stack>

      {aside}
    </PageHeaderActionsContext.Provider>
  )
}
DashboardLayout.displayName = 'DashboardLayout'
DashboardLayout.aglyn = true

export default DashboardLayout
