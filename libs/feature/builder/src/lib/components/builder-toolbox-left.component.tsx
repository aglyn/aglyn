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

import { styled } from '@aglyn/shared-feature-themes'
import { SvgPathIcon } from '@aglyn/shared-ui-jsx'
import { _isEqualitySameType } from '@aglyn/shared-util-guards'
import TreeItem from '@mui/lab/TreeItem'
import TreeView from '@mui/lab/TreeView'
import Box from '@mui/material/Box'
import Drawer, { DrawerProps } from '@mui/material/Drawer'
import Toolbar from '@mui/material/Toolbar'
import { forwardRef, HTMLAttributes } from 'react'


type ExtraProps<P> = P & { drawerWidth?: string | number, open?: boolean }

const defaultDrawerWidth = 240

const BuilderToolboxContainer = styled('div', {
  name: 'BuilderToolboxContainer',
  shouldForwardProp(propName: any) {
    return !_isEqualitySameType(propName, 'open', 'drawerWidth')
  },
})<ExtraProps<HTMLAttributes<HTMLDivElement>>>(({theme, open, drawerWidth}) => ({
  transition: theme.transitions.create('margin', {
    easing: theme.transitions.easing.sharp,
    duration: theme.transitions.duration.leavingScreen,
  }),
  marginLeft: open ? 0 : -(drawerWidth ?? defaultDrawerWidth),
  ...(open && {
    transition: theme.transitions.create('margin', {
      easing: theme.transitions.easing.easeOut,
      duration: theme.transitions.duration.enteringScreen,
    }),
  }),
}))

const StyledDrawer = styled(Drawer, {
  name: 'StyledDrawer',
  shouldForwardProp(propName: any) {
    return !_isEqualitySameType(propName, 'drawerWidth')
  },
})<ExtraProps<DrawerProps>>(({theme, drawerWidth}) => ({
  width: drawerWidth ?? defaultDrawerWidth,
  flexShrink: 0,
  zIndex: theme.zIndex.appBar,
  [`& .MuiDrawer-paper`]: {
    width: drawerWidth ?? defaultDrawerWidth,
    boxSizing: 'border-box',
    position: 'unset',
  },
}))

export interface BuilderToolboxLeftComponentProps extends ExtraProps<HTMLAttributes<HTMLDivElement>> {
  DrawerProps?: DrawerProps
}

export const BuilderToolboxLeftComponent = forwardRef<any, BuilderToolboxLeftComponentProps>(
  function RefRenderFn(props, ref) {
    const {children, drawerWidth, DrawerProps, open, ...rest} = props

    return (
      <BuilderToolboxContainer
        ref={ref}
        drawerWidth={drawerWidth}
        open={open}
        {...rest}
      >
        <StyledDrawer
          drawerWidth={drawerWidth}
          variant="persistent"
          open={open}
          {...DrawerProps}
        >
          <Toolbar />

          <Box sx={{overflow: 'auto'}}>
            <TreeView
              aria-label="file system navigator"
              defaultCollapseIcon={
                <SvgPathIcon iconIds={'chevron-down'} />}
              defaultExpandIcon={<SvgPathIcon iconIds={'chevron-right'} />}
              sx={{height: 240, flexGrow: 1, maxWidth: 400, overflowY: 'auto'}}
            >
              <TreeItem nodeId="1" label="Applications">
                <TreeItem nodeId="2" label="Calendar" />
              </TreeItem>

              <TreeItem nodeId="5" label="Documents">
                <TreeItem nodeId="10" label="OSS" />
                <TreeItem nodeId="6" label="MUI">
                  <TreeItem nodeId="8" label="index.js" />
                </TreeItem>
              </TreeItem>
            </TreeView>
          </Box>

          {children}
        </StyledDrawer>
      </BuilderToolboxContainer>
    )
  },
)

BuilderToolboxLeftComponent.displayName = 'BuilderToolboxLeftComponent'
BuilderToolboxLeftComponent.defaultProps = {}

export default BuilderToolboxLeftComponent
