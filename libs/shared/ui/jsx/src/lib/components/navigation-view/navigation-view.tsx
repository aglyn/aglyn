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

import { generateComponentClassKeys } from '@aglyn/shared-ui-theme'
import { mergeSxProps } from '@aglyn/shared-ui-theme'
import {
  AppBar,
  type AppBarProps,
  Stack,
  type StackProps,
  styled,
  Toolbar,
} from '@mui/material'
import { motion } from 'framer-motion'
import { forwardRef, useState } from 'react'
import ScrollReaction from '../scroll-reaction'

const classKeys = generateComponentClassKeys('AglynNavigationDrawer', [
  'root',
  'appBar',
  'toolbar',
  'appBarLeft',
  'appBarRight',
  'content',
  'bottomAppBar',
])

const StyledAppBar = styled<any>(AppBar)<AppBarProps>(({ theme }) => {
  const tv = (theme as any).vars || theme
  return {
    borderBottomWidth: 1,
    borderBottomStyle: 'solid',
    borderBottomColor: tv.palette.divider,
    zIndex: theme.zIndex.appBar,
    transition: theme.transitions.create(['background-image', 'box-shadow'], {
      easing: theme.transitions.easing.sharp,
      duration: theme.transitions.duration.standard,
    }),
  }
})

export interface NavigationAppBarProps extends AppBarProps {
  scrollView?: Node | Window
  disableHideOnScroll?: boolean
  disableElevateOnScroll?: boolean
}

export const NavigationAppBar = forwardRef<any, NavigationAppBarProps>(
  (props, forwardRef) => {
    const {
      disableHideOnScroll,
      disableElevateOnScroll,
      scrollView,
      children,
      ...rest
    } = props

    return (
      <ScrollReaction threshold={50} target={scrollView}>
        {({ activeWithoutHysteresis, activeWithHysteresis }) => (
          <StyledAppBar
            ref={forwardRef}
            color="default"
            position="relative"
            variant="elevation"
            elevation={
              activeWithoutHysteresis && !disableElevateOnScroll ? 4 : 0
            }
            enableColorOnDark
            component={disableHideOnScroll ? 'header' : motion.header}
            animate={
              disableHideOnScroll
                ? undefined
                : {
                    height: !activeWithHysteresis ? null : 0,
                    overflow: 'hidden',
                  }
            }
            {...rest}
          >
            {children}
          </StyledAppBar>
        )}
      </ScrollReaction>
    )
  },
)

export interface NavigationViewProps extends StackProps {
  appBarLeft?: JSX.Children
  appBarRight?: JSX.Children
  childrenAfterToolbar?: JSX.Children
  bottomAppBar?: JSX.Children
  AppBarProps?: Partial<NavigationAppBarProps>
  AppBarLeftProps?: Partial<StackProps>
  AppBarRightProps?: Partial<StackProps>
  ContentProps?: Partial<StackProps>
}

export const NavigationView = forwardRef<any, NavigationViewProps>(
  (props, forwardRef) => {
    const {
      sx,
      children,
      appBarLeft,
      appBarRight,
      childrenAfterToolbar,
      bottomAppBar,
      AppBarProps,
      AppBarLeftProps,
      AppBarRightProps,
      ContentProps,
      ...rest
    } = props

    const [scrollView, setScrollView] = useState<Node | Window>(null)

    return (
      <Stack
        ref={forwardRef}
        direction="column"
        spacing={0}
        {...rest}
        sx={mergeSxProps(
          {
            alignItems: 'stretch',
            justifyContent: 'flex-start',
            flexGrow: 1,
            height: 1,
            width: 1,
            overflow: 'hidden',
          },
          sx,
        )}
      >
        <NavigationAppBar
          scrollView={scrollView}
          className={classKeys.appBar}
          {...AppBarProps}
        >
          <Toolbar className={classKeys.toolbar}>
            <Stack
              direction="row"
              spacing={2}
              sx={{
                alignItems: 'center',
                justifyContent: 'space-between',
                width: 1,
              }}
            >
              <Stack
                direction="row"
                className={classKeys.appBarLeft}
                {...AppBarLeftProps}
                sx={mergeSxProps(
                  { alignItems: 'center', justifyContent: 'flex-start' },
                  AppBarLeftProps?.sx,
                )}
              >
                {appBarLeft}
              </Stack>
              <Stack
                direction="row"
                className={classKeys.appBarRight}
                {...AppBarRightProps}
                sx={mergeSxProps(
                  { alignItems: 'center', justifyContent: 'flex-start' },
                  AppBarRightProps?.sx,
                )}
              >
                {appBarRight}
              </Stack>
            </Stack>
          </Toolbar>
          {childrenAfterToolbar}
        </NavigationAppBar>
        <Stack
          ref={setScrollView}
          component="main"
          direction="column"
          className={classKeys.content}
          {...ContentProps}
          sx={mergeSxProps(
            {
              overflow: 'auto',
              flexGrow: 1,
              height: 1,
              width: 1,
              bgcolor: 'background.default',
              zIndex: 1,
            },
            ContentProps?.sx,
          )}
        >
          {children}
        </Stack>
        <Stack
          component="footer"
          direction="column"
          className={classKeys.bottomAppBar}
        >
          {bottomAppBar}
        </Stack>
      </Stack>
    )
  },
)
NavigationView.displayName = 'NavigationView'

export default NavigationView
