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

import {mergeSxProps} from '@aglyn/shared-feature-themes'

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
import {forwardRef, type ReactNode, type Ref, useState} from 'react'
import useCombinedRefs from '../hooks/use-combined-refs'
import ElevateOnScroll from './elevate-on-scroll'


/* eslint-disable-next-line */
export interface NavigationDrawerProps extends Partial<DrawerProps> {
  appBarLeft?: ReactNode
  appBarRight?: ReactNode
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
        sx={mergeSxProps(
          {
            '& .MuiDrawer-paper': {
              width: theme => theme.breakpoints.values.sm,
              maxWidth: '100%',
            },
          },
          sx,
        )}
        {...rest}
      >
        <ElevateOnScroll target={localContentRef}>
          {({activeWithoutHysteresis}) => (
            <AppBar
              color="default"
              position="relative"
              variant="elevation"
              elevation={activeWithoutHysteresis ? 4 : 0}
              {...AppBarProps}

              sx={mergeSxProps(
                {
                  borderBottomWidth: 1,
                  borderBottomStyle: 'solid',
                  borderBottomColor: 'divider',
                },
                AppBarProps?.sx,
              )}
            >
              <Toolbar {...ToolbarProps}>
                <Stack
                  direction="row"
                  justifyContent="space-between"
                  alignItems="center"
                  spacing={2}
                  width={1}
                >
                  <Stack {...AppBarLeftProps}>
                    {appBarLeft}
                  </Stack>
                  <Stack {...AppBarRightProps}>
                    {appBarRight}
                  </Stack>
                </Stack>
              </Toolbar>
            </AppBar>
          )}
        </ElevateOnScroll>
        <Box
          ref={useCombinedRefs(setLocalContentRef, contentRef)}
          {...ContentProps}
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

NavigationDrawerComponent.displayName = 'AglynNavigationDrawer'
NavigationDrawerComponent.defaultProps = {}

export {NavigationDrawerComponent}
export default NavigationDrawerComponent
