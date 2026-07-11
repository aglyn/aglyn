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

import { CardDisplay, GridItems } from '@aglyn/shared-ui-jsx'
import { TabContext, TabList, TabPanel } from '@mui/lab'
import { Tab, useMediaQuery, useTheme } from '@mui/material'
import { useRouter } from 'next/router'
import { useSearchParams } from 'next/navigation'
import { type ReactNode, type SyntheticEvent, useCallback, useState } from 'react'

export interface HubTab {
  id: string
  label: string
  content: ReactNode
}

export interface HubTabsProps {
  tabs: HubTab[]
  /** Left nav card header (defaults to "Navigation"). */
  navHeader?: string
}

/**
 * Hub tab strip (AGL-354/382): the host-setup two-column pattern as a
 * shared component — a left "Navigation" CardDisplay with a vertical
 * TabList, content on the right. Collapses to horizontal tabs on small
 * screens. The active tab mirrors into the `?tab=` query param (shallow
 * replace) so hub views deep-link and survive back/forward; panels are
 * kept mounted so content and its data subscriptions are always present.
 */
export function HubTabs(props: HubTabsProps) {
  const { tabs, navHeader = 'Navigation' } = props
  const router = useRouter()
  const searchParams = useSearchParams()
  const theme = useTheme()
  const stacked = useMediaQuery(theme.breakpoints.down('sm'))
  const requestedTab = searchParams?.get('tab')
  const [tab, setTab] = useState(
    tabs.some((item) => item.id === requestedTab)
      ? (requestedTab as string)
      : (tabs[0]?.id ?? ''),
  )

  const handleChange = useCallback(
    (event: SyntheticEvent, value: string) => {
      setTab(value)
      void router.replace(
        { pathname: router.pathname, query: { ...router.query, tab: value } },
        undefined,
        { shallow: true },
      )
    },
    [router],
  )

  return (
    <TabContext value={tab}>
      <GridItems
        spacing={3}
        items={[
          {
            size: { xs: 12, sm: 3 },
            children: (
              <CardDisplay header={navHeader}>
                <TabList
                  orientation={stacked ? 'horizontal' : 'vertical'}
                  variant={stacked ? 'scrollable' : 'standard'}
                  allowScrollButtonsMobile
                  textColor="secondary"
                  indicatorColor="secondary"
                  onChange={handleChange}
                  sx={{
                    ['.MuiTab-root']: {
                      alignItems: stacked ? 'center' : 'start',
                      maxWidth: 'unset',
                      textTransform: 'none',
                    },
                  }}
                >
                  {tabs.map((item) => (
                    <Tab key={item.id} value={item.id} label={item.label} />
                  ))}
                </TabList>
              </CardDisplay>
            ),
          },
          {
            size: { xs: 12, sm: 9 },
            children: (
              <>
                {tabs.map((item) => (
                  <TabPanel
                    key={item.id}
                    value={item.id}
                    keepMounted
                    sx={{ padding: 'unset' }}
                  >
                    {item.content}
                  </TabPanel>
                ))}
              </>
            ),
          },
        ]}
      />
    </TabContext>
  )
}
HubTabs.displayName = 'HubTabs'

export default HubTabs
