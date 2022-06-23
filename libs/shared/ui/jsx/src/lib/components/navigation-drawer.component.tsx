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

import {
  generateComponentClassKeys,
  mergeSxProps,
} from '@aglyn/shared-ui-theme'

import {
  AppBar,
  type AppBarProps,
  Box,
  type BoxProps,
  Drawer,
  type DrawerProps,
  Stack,
  type StackProps,
  Toolbar,
  type ToolbarProps,
} from '@mui/material'
import clsx from 'clsx'
import { forwardRef, type Ref, useState } from 'react'
import { useForkedRefs } from '../hooks/use-ref-forked'
import ElevateOnScroll from './elevate-on-scroll'

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
}

const NavigationDrawerComponent = forwardRef<any, NavigationDrawerProps>(
  function RefRenderFn(props, ref) {
    const {
      children,
      className,
      contentRef,
      appBarLeft,
      appBarRight,
      sx,
      AppBarProps,
      ToolbarProps,
      ContentProps,
      AppBarLeftProps,
      AppBarRightProps,
      ...rest
    } = props

    // const localContentRef = useRef<any>()
    const [localContentRef, setLocalContentRef] = useState<any>()

    return (
      <Drawer
        ref={ref}
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
        <ElevateOnScroll target={localContentRef}>
          {({ activeWithoutHysteresis }) => (
            <AppBar
              color="inherit"
              position="relative"
              variant="elevation"
              elevation={activeWithoutHysteresis ? 4 : 0}
              enableColorOnDark
              {...AppBarProps}
              className={clsx(classKeys.appBar, AppBarProps?.className)}
              sx={mergeSxProps(
                {
                  borderBottomWidth: 1,
                  borderBottomStyle: 'solid',
                  borderBottomColor: 'divider',
                },
                AppBarProps?.sx,
              )}
            >
              <Toolbar
                {...ToolbarProps}
                className={clsx(classKeys.toolbar, ToolbarProps?.className)}
              >
                <Stack
                  alignItems="center"
                  justifyContent="space-between"
                  direction="row"
                  spacing={2}
                  width={1}
                >
                  <Stack
                    direction="row"
                    alignItems="center"
                    justifyContent="flex-start"
                    {...AppBarLeftProps}
                    className={clsx(
                      classKeys.appBarLeft,
                      AppBarLeftProps?.className,
                    )}
                  >
                    {appBarLeft}
                  </Stack>
                  <Stack
                    direction="row"
                    alignItems="center"
                    justifyContent="flex-start"
                    {...AppBarRightProps}
                    className={clsx(
                      classKeys.appBarRight,
                      AppBarRightProps?.className,
                    )}
                  >
                    {appBarRight}
                  </Stack>
                </Stack>
              </Toolbar>
            </AppBar>
          )}
        </ElevateOnScroll>
        <Box
          ref={useForkedRefs(setLocalContentRef, contentRef)}
          {...ContentProps}
          className={clsx(classKeys.content, ContentProps?.className)}
          sx={mergeSxProps(
            {
              height: '100%',
              width: '100%',
              overflow: 'auto',
            },
            ContentProps?.sx,
          )}
        >
          {children}
        </Box>
      </Drawer>
    )
  },
)

NavigationDrawerComponent.displayName = 'NavigationDrawerComponent'
NavigationDrawerComponent.aglyn = true
NavigationDrawerComponent.defaultProps = {}

export { NavigationDrawerComponent }
export default NavigationDrawerComponent
