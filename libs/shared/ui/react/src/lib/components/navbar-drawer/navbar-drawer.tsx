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

import { generateUtilityClasses, styled } from '@aglyn/shared/ui/themes'

import MuiAppBar, { AppBarProps as MuiAppBarProps } from '@mui/material/AppBar'
import MuiDrawer, { DrawerProps as MuiDrawerProps } from '@mui/material/Drawer'
import Toolbar, { ToolbarProps as MuiToolbarProps } from '@mui/material/Toolbar'
import clsx from 'clsx'
import { forwardRef, ReactNode, Ref, useRef } from 'react'
import useCombinedRefs from '../../hooks/use-combined-refs'
import ElevationScroll from '../elevation-scroll/elevation-scroll'


const classKeys = generateUtilityClasses('AglynNavbarDrawer', [
  'appBar',
  'toolbar',
  'left',
  'right',
  'content',
  'paper',
])

const StyledDrawer = styled(MuiDrawer, {
  name: 'NavbarDrawer',
})(({theme}) => ({
  '& .MuiDrawer-paper': {
    width: theme.breakpoints.values.sm,
    maxWidth: '100%',
  },
}))

const StyledAppBar = styled(MuiAppBar, {
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
export interface NavbarDrawerProps extends Partial<MuiDrawerProps> {
  appBarLeft?: ReactNode
  appBarRight?: ReactNode
  innerContentRef?: Ref<HTMLDivElement>
  AppBarProps?: Partial<MuiAppBarProps>
  ToolbarProps?: Partial<MuiToolbarProps>
}

export const NavbarDrawer = forwardRef<any, NavbarDrawerProps>(
  function RefRenderFn(props, ref) {
    const {
      children,
      innerContentRef,
      appBarLeft,
      appBarRight,
      AppBarProps,
      ToolbarProps,
      classes,
      ...rest
    } = props

    const localContentRef = useRef<HTMLDivElement>()
    const contentRef = useCombinedRefs(localContentRef, innerContentRef)
    const toolbarClassName = clsx(classKeys.toolbar, ToolbarProps?.className)
    const elemClasses = {
      ...classes,
      paper: clsx(classes?.paper, classKeys.paper),
    }

    return (
      <StyledDrawer
        ref={ref}
        anchor="right"
        classes={elemClasses}
        {...rest}
      >
        <ElevationScroll target={localContentRef.current}>
          <StyledAppBar
            color="default"
            position="relative"
            variant="elevation"
            className={classKeys.appBar}
            {...AppBarProps}
          >
            <Toolbar {...ToolbarProps} className={toolbarClassName}>
              <Left className={classKeys.left}>{appBarLeft}</Left>
              <Right className={classKeys.right}>{appBarRight}</Right>
            </Toolbar>
          </StyledAppBar>
        </ElevationScroll>
        <Content ref={contentRef} className={classKeys.content}>
          {children}
        </Content>
      </StyledDrawer>
    )
  },
)

NavbarDrawer.displayName = 'NavbarDrawer'

export default NavbarDrawer
