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

import {ElevateOnScroll} from '@aglyn/shared-ui-jsx'
import {_isArrEmpty} from '@aglyn/shared-util-guards'
import {AppBar, type AppBarProps, Divider, Toolbar, Typography} from '@mui/material'
import {Fragment, type ReactNode} from 'react'
import {TAB_HEIGHT, TOP_BAR_HEIGHT} from '../constants/shared'
import AppLinkTabsComponent, {type AppLinkTabsProps} from './app-link-tabs.component'


export interface SecondaryAppBarProps extends Partial<AppBarProps> {
  tabBarTitle?: ReactNode
  navTabItems?: AppLinkTabsProps['items']
  activeTab?: AppLinkTabsProps['activeTab']
}

function SecondaryAppBarComponent(props: SecondaryAppBarProps) {
  const {
    children,
    tabBarTitle,
    navTabItems,
    activeTab,
    ...rest
  } = props

  return (
    <ElevateOnScroll threshold={TOP_BAR_HEIGHT}>
      {({activeWithoutHysteresis}) => (
        <AppBar
          component="aside"
          color="inherit"
          position="sticky"
          variant="elevation"
          elevation={activeWithoutHysteresis ? 4 : 0}
          enableColorOnDark
          {...rest}
        >
          <Toolbar
            variant="dense"
            component="div"
            color="inherit"
            sx={{
              minHeight: TAB_HEIGHT,
              borderBottomWidth: `1px`,
              borderBottomStyle: 'solid',
              borderBottomColor: 'divider',
            }}
          >
            {tabBarTitle && (
              <Fragment>
                <Typography
                  component={'div'}
                  variant={'h6'}
                  sx={{
                    lineHeight: 'normal',
                    letterSpacing: 2,
                    fontSize: `0.95em`,
                    fontWeight: 'fontWeightMedium',
                    textTransform: 'uppercase',
                    color: 'text.secondary',
                  }}
                >
                  {tabBarTitle}
                </Typography>

                <Divider
                  orientation="vertical"
                  sx={{ml: 1.25, mr: 1}}
                  flexItem
                  light
                />
              </Fragment>
            )}

            {children}

            {!_isArrEmpty(navTabItems) && (
              <AppLinkTabsComponent
                items={navTabItems}
                activeTab={activeTab}
              />
            )}
          </Toolbar>
        </AppBar>
      )}
    </ElevateOnScroll>
  )
}
SecondaryAppBarComponent.displayName = 'SecondaryAppBarComponent'
SecondaryAppBarComponent.aglyn = true
SecondaryAppBarComponent.defaultProps = {
  navTabItems: undefined,
}

export {SecondaryAppBarComponent}
export default SecondaryAppBarComponent
