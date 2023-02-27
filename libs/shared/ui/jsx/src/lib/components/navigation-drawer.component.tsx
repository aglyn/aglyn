/**
 * @license
 * Copyright 2023 Aglyn LLC
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

import NavigationView from '@aglyn/shared-ui-jsx/components/navigation-view/navigation-view'
import {
  generateComponentClassKeys,
  mergeSxProps,
} from '@aglyn/shared-ui-theme'

import {
  type AppBarProps,
  type BoxProps,
  Drawer,
  type DrawerProps,
  type StackProps,
  type ToolbarProps,
} from '@mui/material'
import clsx from 'clsx'
import { forwardRef, type Ref } from 'react'

const classKeys = generateComponentClassKeys('AglynNavigationDrawer', [
  'root',
  'appBar',
  'toolbar',
  'appBarLeft',
  'appBarRight',
  'content',
])

/* eslint-disable-next-line */
export interface NavigationDrawerProps extends Partial<DrawerProps> {
  appBarLeft?: JSX.Node
  appBarRight?: JSX.Node
  contentRef?: Ref<any>
  AppBarProps?: Partial<AppBarProps>
  ToolbarProps?: Partial<ToolbarProps>
  ContentProps?: BoxProps
  AppBarLeftProps?: StackProps
  AppBarRightProps?: StackProps
  childrenAfterToolbar?: JSX.Node
}

export const NavigationDrawerComponent = forwardRef<any, NavigationDrawerProps>(
  function RefRenderFn(props, forwardRef) {
    const {
      sx,
      children,
      className,
      contentRef,
      appBarLeft,
      appBarRight,
      AppBarProps,
      ToolbarProps,
      ContentProps,
      AppBarLeftProps,
      AppBarRightProps,
      childrenAfterToolbar,
      ...rest
    } = props

    return (
      <Drawer
        ref={forwardRef}
        className={clsx(classKeys.root, className)}
        sx={mergeSxProps(
          {
            width: (theme) => `${theme.breakpoints.values.sm}px`,
            flexShrink: 0,
            maxWidth: '100%',
            '& .MuiDrawer-paper': {
              width: (theme) => `${theme.breakpoints.values.sm}px`,
              maxWidth: '100%',
            },
          },
          sx,
        )}
        {...rest}
      >
        <NavigationView
          AppBarProps={AppBarProps}
          appBarLeft={appBarLeft}
          appBarRight={appBarRight}
          AppBarLeftProps={AppBarLeftProps}
          AppBarRightProps={AppBarRightProps}
          childrenAfterToolbar={childrenAfterToolbar}
        >
          {children}
        </NavigationView>
      </Drawer>
    )
  },
)

NavigationDrawerComponent.displayName = 'NavigationDrawerComponent'
NavigationDrawerComponent.aglyn = true

export default NavigationDrawerComponent
