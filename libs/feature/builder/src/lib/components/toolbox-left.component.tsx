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

import { useAglynAppContext, useAglynBuilderStore } from '@aglyn/feature-renderer'
import { styled } from '@aglyn/shared-feature-themes'
import { SvgPathIcon } from '@aglyn/shared-ui-jsx'
import { _isEqualitySameType } from '@aglyn/shared-util-guards'
import MuiTabContext from '@mui/lab/TabContext'
import MuiTabList from '@mui/lab/TabList'
import MuiTabPanel from '@mui/lab/TabPanel'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Drawer, { DrawerProps } from '@mui/material/Drawer'
import MuiTab from '@mui/material/Tab'
import { forwardRef, HTMLAttributes, useCallback, useState } from 'react'
import { DEFAULT_LEFT_DRAWER_WIDTH } from '../constants'
import { useAddElementCallback } from '../hooks/use-add-element-callback'
import { ElementsTreeViewComponent } from './elements-tree-view.component'


type ExtraProps<P> = P & { drawerWidth?: string | number, open?: boolean }

const ToolboxContainer = styled('div', {
  name: 'ToolboxContainer',
  shouldForwardProp(propName: any) {
    return !_isEqualitySameType(propName, 'open', 'drawerWidth')
  },
})<ExtraProps<HTMLAttributes<HTMLDivElement>>>(({theme, open, drawerWidth}) => ({
  transition: theme.transitions.create('margin', {
    easing: theme.transitions.easing.sharp,
    duration: theme.transitions.duration.leavingScreen,
  }),
  marginLeft: open ? 0 : -(drawerWidth ?? DEFAULT_LEFT_DRAWER_WIDTH),
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
  width: drawerWidth ?? DEFAULT_LEFT_DRAWER_WIDTH,
  flexShrink: 0,
  zIndex: theme.zIndex.appBar,
  [`& .MuiDrawer-paper`]: {
    width: drawerWidth ?? DEFAULT_LEFT_DRAWER_WIDTH,
    boxSizing: 'border-box',
    position: 'unset',
  },
}))

export interface ToolboxLeftComponentProps extends ExtraProps<HTMLAttributes<HTMLDivElement>> {
  DrawerProps?: DrawerProps
}

export const ToolboxLeftComponent = forwardRef<any, ToolboxLeftComponentProps>(
  function RefRenderFn(props, ref) {
    const {children, drawerWidth: drawerWidthProp, DrawerProps, ...rest} = props

    const {getApp} = useAglynAppContext()
    const handleAddElementClick = useAddElementCallback()
    const leftPanel = useAglynBuilderStore('panels', 'left')
    const {toggled, drawerWidth = drawerWidthProp} = leftPanel || {}
    const open = Boolean(toggled)

    const [activeView, setActiveView] = useState(() => 'elements-tree')
    const handleTabChange = useCallback((e, newValue) => {
      setActiveView(newValue)
    }, [])


    return (
      <ToolboxContainer
        ref={ref}
        drawerWidth={drawerWidth}
        open={open}
        {...rest}
      >
        <StyledDrawer
          drawerWidth={drawerWidth}
          variant="persistent"
          open={open}
          sx={{height: '100%'}}
          {...DrawerProps}
        >

          <MuiTabContext value={activeView}>
            <Box sx={{borderBottom: 1, borderColor: 'divider'}}>
              <MuiTabList
                onChange={handleTabChange}
                variant="fullWidth"
                indicatorColor="secondary"
                textColor="primary"
              >
                <MuiTab
                  value="elements-tree"
                  icon={<SvgPathIcon iconIds="file-tree" />}
                />
              </MuiTabList>
            </Box>

            <MuiTabPanel
              value="elements-tree"
              sx={{p: 0, overflow: 'auto'}}
            >
              <Box
                sx={{px: 0.5, pb: 1, pt: 1}}
              >
                <Button
                  color="secondary"
                  startIcon={<SvgPathIcon fontSize="inherit" iconIds="plus" />}
                  onClick={handleAddElementClick}
                >
                  Add Element
                </Button>
              </Box>
              <ElementsTreeViewComponent />
            </MuiTabPanel>
          </MuiTabContext>

        </StyledDrawer>
        {children}
      </ToolboxContainer>
    )
  },
)

ToolboxLeftComponent.displayName = 'ToolboxLeftComponent'
ToolboxLeftComponent.defaultProps = {}

export default ToolboxLeftComponent
