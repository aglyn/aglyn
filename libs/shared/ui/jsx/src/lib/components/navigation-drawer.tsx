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

import { generateComponentClassKeys, styled } from '@aglyn/shared-feature-themes'

import MuiAppBar, { AppBarProps as MuiAppBarProps } from '@mui/material/AppBar'
import MuiDrawer, { DrawerProps as MuiDrawerProps } from '@mui/material/Drawer'
import Toolbar, { ToolbarProps as MuiToolbarProps } from '@mui/material/Toolbar'
import clsx from 'clsx'
import { forwardRef, HTMLAttributes, ReactNode, Ref, useRef } from 'react'
import useCombinedRefs from '../hooks/use-combined-refs'
import ElevationScroll from './elevation-scroll'


const classKeys = generateComponentClassKeys('AglynNavigationDrawer', [
  'root',
  'appBar',
  'toolbar',
  'left',
  'right',
  'content',
])

const Drawer = styled(MuiDrawer, {
  name: 'NavigationDrawer',
})(({theme}) => ({
  '& .MuiDrawer-paper': {
    width: theme.breakpoints.values.sm,
    maxWidth: '100%',
  },
}))

const AppBar = styled(MuiAppBar, {
  name: 'AppBar',
})(({theme}) => ({
  borderBottom: `1px solid ${theme.palette.divider}`,
}))

const Left = styled('div', {
  name: 'AppbarLeft',
})({
  flexGrow: 1,
  display: 'flex',
  alignItems: 'center',
  position: 'relative',
})

const Right = styled('div', {
  name: 'AppbarRight',
})({
  display: 'flex',
  alignItems: 'center',
  position: 'relative',
})

const Content = styled('div', {
  name: 'AppbarContent',
})({
  height: '100%',
  width: '100%',
  overflow: 'auto',
})

/* eslint-disable-next-line */
export interface NavigationDrawerProps extends Partial<MuiDrawerProps> {
  appBarLeft?: ReactNode
  appBarRight?: ReactNode
  contentRef?: Ref<HTMLDivElement>
  AppBarProps?: Partial<MuiAppBarProps>
  ToolbarProps?: Partial<MuiToolbarProps>
  ContentProps?: HTMLAttributes<HTMLDivElement>
  AppBarLeftProps?: HTMLAttributes<HTMLDivElement>
  AppBarRightProps?: HTMLAttributes<HTMLDivElement>
}

export const NavigationDrawer = forwardRef<any, NavigationDrawerProps>(
  function RefRenderFn(props, ref) {
    const {
      children,
      className: classNameProp,
      contentRef,
      appBarLeft,
      appBarRight,
      AppBarProps,
      ToolbarProps,
      ContentProps,
      AppBarLeftProps,
      AppBarRightProps,
      ...rest
    } = props

    const localContentRef = useRef<HTMLDivElement>()
    const className = clsx(classKeys.root, classNameProp)
    const appBarClassName = clsx(classKeys.appBar, AppBarProps?.className)
    const toolbarClassName = clsx(classKeys.toolbar, ToolbarProps?.className)
    const contentClassName = clsx(classKeys.content, ContentProps?.className)
    const appBarLeftClassName = clsx(classKeys.left, AppBarLeftProps?.className)
    const appBarRightClassName = clsx(classKeys.right, AppBarRightProps?.className)

    return (
      <Drawer ref={ref} anchor="right" className={className} {...rest}>
        <ElevationScroll target={localContentRef.current}>
          <AppBar
            color="default"
            position="relative"
            variant="elevation"
            {...AppBarProps}
            className={appBarClassName}
          >
            <Toolbar {...ToolbarProps} className={toolbarClassName}>
              <Left
                {...AppBarLeftProps}
                className={appBarLeftClassName}
              >
                {appBarLeft}
              </Left>
              <Right
                {...AppBarRightProps}
                className={appBarRightClassName}
              >
                {appBarRight}
              </Right>
            </Toolbar>
          </AppBar>
        </ElevationScroll>
        <Content
          ref={useCombinedRefs(localContentRef, contentRef)}
          {...ContentProps}
          className={contentClassName}
        >
          {children}
        </Content>
      </Drawer>
    )
  },
)

NavigationDrawer.displayName = 'NavigationDrawer'
NavigationDrawer.defaultProps = {}

export default NavigationDrawer
