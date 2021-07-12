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

import React, { forwardRef, ReactNode, useRef } from 'react'

import MuiAppBar, { AppBarProps as MuiAppBarProps } from '@material-ui/core/AppBar'
import MuiDrawer, { DrawerProps as MuiDrawerProps } from '@material-ui/core/Drawer'
import Toolbar, { ToolbarProps as MuiToolbarProps } from '@material-ui/core/Toolbar'
import { createStyles, WithStyles, withStyles } from '@material-ui/core/styles'

import clsx from 'clsx'
import ElevationScroll from '../elevation-scroll/elevation-scroll'

const styles = (theme) =>
  createStyles({
    root: {},
    menu: {},
    appBar: { borderBottom: `1px solid ${theme.palette.divider}` },
    paper: {
      width: 620,
      maxWidth: '100%',
    },
    left: {
      flexGrow: 1,
      display: 'flex',
      alignItems: 'center',
      position: 'relative',
    },
    right: {
      display: 'flex',
      alignItems: 'center',
      position: 'relative',
    },
    content: {
      height: '100%',
      width: '100%',
      overflow: 'auto',
    },
  })

/* eslint-disable-next-line */
export interface NavbarDrawerProps extends MuiDrawerProps {
  appBarLeft?: ReactNode
  appBarRight?: ReactNode
  AppBarProps?: Partial<MuiAppBarProps>
  ToolbarProps?: Partial<MuiToolbarProps>
}

export const NavbarDrawer = withStyles(styles, { name: 'NavbarDrawer' })(
  forwardRef<any, NavbarDrawerProps & WithStyles<typeof styles>>(function RefRenderFn(props, ref) {
    const { classes, children, appBarLeft, appBarRight, className, AppBarProps, ToolbarProps, ...rest } = props

    const contentRef = useRef()

    return (
      <MuiDrawer
        ref={ref}
        anchor="right"
        className={clsx(classes.root, className)}
        classes={{ paper: classes.paper }}
        {...rest}
      >
        <ElevationScroll target={contentRef.current}>
          <MuiAppBar
            className={classes.appBar}
            color="default"
            position="relative"
            variant="elevation"
            {...AppBarProps}
          >
            <Toolbar {...ToolbarProps}>
              <div className={classes.left}>{appBarLeft}</div>
              <div className={classes.right}>{appBarRight}</div>
            </Toolbar>
          </MuiAppBar>
        </ElevationScroll>
        <div ref={contentRef} className={classes.content}>
          {children}
        </div>
      </MuiDrawer>
    )
  })
)

NavbarDrawer.displayName = 'NavbarDrawer'

export default NavbarDrawer
