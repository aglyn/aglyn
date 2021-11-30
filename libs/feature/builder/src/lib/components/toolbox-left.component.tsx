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

import { useAglynBuilderStore } from '@aglyn/feature-renderer'
import { SvgPathIcon } from '@aglyn/shared-ui-jsx'
import MuiTabContext from '@mui/lab/TabContext'
import MuiTabList from '@mui/lab/TabList'
import MuiTabPanel from '@mui/lab/TabPanel'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import MuiTab from '@mui/material/Tab'
import { forwardRef, useCallback, useState } from 'react'
import { useAddElementCallback } from '../hooks/use-add-element-callback'
import { ElementsTreeViewComponent } from './elements-tree-view.component'
import ToolboxDrawerComponent, { ToolboxDrawerComponentProps } from './toolbox-drawer.component'


export interface ToolboxLeftComponentProps extends ToolboxDrawerComponentProps {
}

export const ToolboxLeftComponent = forwardRef<any, ToolboxLeftComponentProps>(
  function RefRenderFn(props, ref) {
    const {
      children,
      drawerWidth: drawerWidthProp,
      ...rest
    } = props

    const handleAddElementClick = useAddElementCallback()
    const panel = useAglynBuilderStore('panels', 'left')
    const {toggled, drawerWidth = drawerWidthProp} = panel || {}
    const open = Boolean(toggled)

    const [activeView, setActiveView] = useState(() => 'elements-tree')
    const handleTabChange = useCallback((e, newValue) => {
      setActiveView(newValue)
    }, [])


    return (
      <ToolboxDrawerComponent
        ref={ref}
        drawerWidth={drawerWidth}
        open={open}
        anchor="left"
        {...rest}
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

        {children}
      </ToolboxDrawerComponent>
    )
  },
)

ToolboxLeftComponent.displayName = 'ToolboxLeftComponent'
ToolboxLeftComponent.defaultProps = {}

export default ToolboxLeftComponent
