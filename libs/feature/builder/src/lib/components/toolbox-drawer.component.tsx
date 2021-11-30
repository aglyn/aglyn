import { DEFAULT_LEFT_DRAWER_WIDTH } from '@aglyn/feature-builder'
import { styled } from '@aglyn/shared-feature-themes'
import { _isEqualitySameType } from '@aglyn/shared-util-guards'
import MuiDrawer from '@mui/material/Drawer'
import { DrawerProps as MuiDrawerProps } from '@mui/material/Drawer/Drawer'
import { forwardRef, HTMLAttributes } from 'react'


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

export interface ToolboxContainerProps extends HTMLAttributes<HTMLDivElement> {
  drawerWidth?: string | number
  open?: boolean
  anchor?: MuiDrawerProps['anchor']
}

const AglynToolboxContainer = styled('div', {
  name: 'AglynToolboxContainer',
  shouldForwardProp(propName: any) {
    return !_isEqualitySameType(propName, 'open', 'drawerWidth', 'anchor')
  },
})<ToolboxContainerProps>(({theme, open, drawerWidth, anchor}) => ({
  zIndex: theme.zIndex.appBar,
  transition: theme.transitions.create('margin', {
    easing: theme.transitions.easing.sharp,
    duration: theme.transitions.duration.leavingScreen,
  }),
  ...(anchor === 'top' ? {
    marginTop: open ? 0 : -(drawerWidth ?? DEFAULT_LEFT_DRAWER_WIDTH),
  } : anchor === 'right' ? {
    marginRight: open ? 0 : -(drawerWidth ?? DEFAULT_LEFT_DRAWER_WIDTH),
  } : anchor === 'bottom' ? {
    marginBottom: open ? 0 : -(drawerWidth ?? DEFAULT_LEFT_DRAWER_WIDTH),
  } : {
    marginLeft: open ? 0 : -(drawerWidth ?? DEFAULT_LEFT_DRAWER_WIDTH),
  }),
  ...(open && {
    transition: theme.transitions.create('margin', {
      easing: theme.transitions.easing.easeOut,
      duration: theme.transitions.duration.enteringScreen,
    }),
  }),
}))

export interface AglynDrawerProps extends MuiDrawerProps {
  drawerWidth?: string | number
}

const AglynDrawer = styled(MuiDrawer, {
  name: 'AglynDrawer',
  shouldForwardProp(propName: any) {
    return !_isEqualitySameType(propName, 'drawerWidth')
  },
})<AglynDrawerProps>(({drawerWidth, anchor}) => ({
  width: drawerWidth ?? DEFAULT_LEFT_DRAWER_WIDTH,
  flexShrink: 0,
  [`& .MuiDrawer-paper`]: {
    width: drawerWidth ?? DEFAULT_LEFT_DRAWER_WIDTH,
    boxSizing: 'border-box',
    position: 'unset',
  },
  ...(anchor === 'top' || anchor === 'bottom' ? {
    width: '100%',
  } : {
    height: '100%',
  }),
}))

export interface ToolboxDrawerComponentProps extends ToolboxContainerProps {
  DrawerProps?: AglynDrawerProps
}

export const ToolboxDrawerComponent = forwardRef<any, ToolboxDrawerComponentProps>(
  function RefRenderFn(props, ref) {
    const {
      children,
      drawerWidth,
      DrawerProps,
      open,
      anchor,
      ...rest
    } = props


    return (
      <AglynToolboxContainer
        ref={ref}
        drawerWidth={drawerWidth}
        open={open}
        anchor={anchor}
        {...rest}
      >
        <AglynDrawer
          drawerWidth={drawerWidth}
          variant="persistent"
          sx={{height: '100%'}}
          open={open}
          anchor={anchor}
          {...DrawerProps}
        >

          {children}

        </AglynDrawer>
      </AglynToolboxContainer>
    )
  },
)

ToolboxDrawerComponent.displayName = 'ToolboxDrawerComponent'
ToolboxDrawerComponent.defaultProps = {}

export default ToolboxDrawerComponent
