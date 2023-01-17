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

import { AppLink, type AppLinkProps } from '@aglyn/shared-ui-jsx'
import { MdiIcon, type MdiIconProps } from '@aglyn/shared-ui-mdi-jsx'
import { mergeSxProps, styled } from '@aglyn/shared-ui-theme'
import {
  Tab as MuiTab,
  type TabProps as MuiTabProps,
  Tabs as MuiTabs,
  type TabsProps as MuiTabsProps,
} from '@mui/material'
import { useRouter } from 'next/router'
import { forwardRef, useMemo } from 'react'
import { TAB_HEIGHT } from '../constants/shared'

export interface TabItemProps
  extends MuiTabProps<any, any>,
    Omit<AppLinkProps<'naked'>, 'componentVariant'> {
  icon?: MdiIconProps
}

export const TabItem = styled(MuiTab, {
  name: 'AglynTabItem',
})<TabItemProps>({
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

export interface AppLinkTabsProps extends Partial<MuiTabsProps> {
  items?: TabItemProps[]
  activeTab?: string
}

const AppLinkTabsComponent = forwardRef<any, AppLinkTabsProps>((props, ref) => {
  const { children, items, activeTab, sx, ...rest } = props
  const router = useRouter()
  const tabValue = useMemo(() => {
    const asPath = router.asPath,
      active = activeTab,
      specific = typeof active !== 'undefined'
    return (
      items.find((i) => {
        const href = i?.href,
          as = i?.hrefAs,
          id = i?.id
        if (specific) return active === href || active === as || active === id
        return asPath === href || asPath === as || asPath === id
      })?.href || false
    )
  }, [router, items, activeTab])

  return (
    <MuiTabs
      ref={ref}
      aria-label="area navigation"
      indicatorColor="secondary"
      scrollButtons="auto"
      textColor="inherit"
      value={tabValue}
      variant="scrollable"
      sx={mergeSxProps(
        {
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
        },
        sx,
      )}
      {...rest}
    >
      {children}
      {items.map(({ icon, href, ...item }, key) => (
        <TabItem
          key={item.key ?? item.id ?? key}
          href={href ?? ''}
          value={href ?? item.key ?? item.id ?? key}
          icon={(icon?.path ? <MdiIcon {...icon} /> : undefined) as any}
          componentVariant="naked"
          component={AppLink}
          color="inherit"
          underline="none"
          wrapped
          {...a11yProps(key)}
          {...item}
        />
      ))}
    </MuiTabs>
  )
})
AppLinkTabsComponent.displayName = 'AppLinkTabsComponent'
AppLinkTabsComponent.aglyn = true
AppLinkTabsComponent.defaultProps = {
  items: [],
}

export { AppLinkTabsComponent }
export default AppLinkTabsComponent
