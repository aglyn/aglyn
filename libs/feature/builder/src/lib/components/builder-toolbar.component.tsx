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

import { createElementData, useElementsContext } from '@aglyn/feature-renderer'
import { styled } from '@aglyn/shared-feature-themes'
import { SvgPathIcon } from '@aglyn/shared-ui-jsx'
import TreeItem from '@mui/lab/TreeItem'
import TreeView from '@mui/lab/TreeView'
import AppBar, { AppBarProps } from '@mui/material/AppBar'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import ButtonGroup from '@mui/material/ButtonGroup'
import Divider from '@mui/material/Divider'
import Drawer from '@mui/material/Drawer'
import Fab from '@mui/material/Fab'
import IconButton from '@mui/material/IconButton'
import Stack from '@mui/material/Stack'
import ToggleButton from '@mui/material/ToggleButton'
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup'
import Toolbar from '@mui/material/Toolbar'
import Typography from '@mui/material/Typography'
import { forwardRef, useCallback } from 'react'
import { useElementDrawerContext } from '../contexts/element-drawer-context'


const StyledFab = styled(Fab, {
  name: 'FabButton',
})({
  position: 'absolute',
  zIndex: 1,
  bottom: -30,
  left: 0,
  right: 0,
  margin: '0 auto',
})

const StyledAppBar = styled(AppBar, {
  name: 'AppBar',
})({
  top: 0,
})

const drawerWidth = 240

export interface BuilderToolbarComponentProps extends Partial<AppBarProps> {}

export const BuilderToolbarComponent = forwardRef<any, BuilderToolbarComponentProps>(
  function RefRenderFn(props, ref) {
    const {className, children, ...rest} = props

    const {elementDrawer} = useElementDrawerContext()
    const {elements, updateElements} = useElementsContext()
    const handleFabClick = useCallback(async () => {
      const option = await elementDrawer({
        title: 'Add New Elements',
      })
      .then((res: any) => {
        if (res?.option?.type === 'selection') {
          return res?.option?.data
        }
      })
      .then((data: any) => {
        if (data) {
          const prevElements = Array.from(elements)
          const newElements = [...elements, createElementData(data)]
          console.log('prev newElement', newElements, prevElements)
          updateElements && updateElements(newElements, prevElements)
        }
      })
      .catch((error) => {
        throw error
      })

      console.warn('async choice', option)
    }, [elementDrawer, elements, updateElements])

    return (
      <Box sx={{display: 'flex', flexDirection: 'column', height: '100vh'}}>

        <StyledAppBar
          ref={ref}
          position="static"
          color="primary"
          elevation={0}
          sx={{zIndex: (theme) => theme.zIndex.drawer + 1}}
          {...rest}
        >
          <Toolbar>
            <Typography variant="h4">
              Besigner
            </Typography>
          </Toolbar>
          <Divider/>
        </StyledAppBar>

        <StyledAppBar
          ref={ref}
          position="static"
          color="default"
          elevation={0}
          sx={{zIndex: (theme) => theme.zIndex.drawer + 1}}
          {...rest}
        >
          <Toolbar variant="dense">

            <IconButton
              aria-haspopup="menu"
              aria-label="add"
              edge="start"
              onClick={handleFabClick}
            >
              <SvgPathIcon iconId={'add'}/>
            </IconButton>

            <Box sx={{mx: 0.25}}/>

            <Stack direction="row" spacing={0.25}>
              <IconButton
                aria-label="undo action"
              >
                <SvgPathIcon iconId={'undo'}/>
              </IconButton>
              <IconButton
                aria-label="redo action"
              >
                <SvgPathIcon iconId={'redo'}/>
              </IconButton>
              <IconButton
                aria-label="delete element"
              >
                <SvgPathIcon iconId={'delete'}/>
              </IconButton>
              <IconButton
                aria-label="paste element"
              >
                <SvgPathIcon iconId={'content-paste'}/>
              </IconButton>
              <IconButton
                aria-label="copy element"
              >
                <SvgPathIcon iconId={'content-copy'}/>
              </IconButton>
            </Stack>

            <Box sx={{flexGrow: 1}}/>

            <Stack direction="row" spacing={1}>
              <ToggleButtonGroup size="small" value="1" exclusive>
                <ToggleButton value="1">
                  <SvgPathIcon iconId={'cursor-default'}/>
                </ToggleButton>
                <ToggleButton value="2">
                  <SvgPathIcon iconId={'cursor-move'}/>
                </ToggleButton>
              </ToggleButtonGroup>
            </Stack>

            <Box sx={{mx: 1}}/>

            <Stack direction="row" spacing={1}>
              <ToggleButtonGroup size="small" value={['1']}>
                <ToggleButton value="1">
                  <SvgPathIcon iconId={'dock-left'}/>
                </ToggleButton>
                <ToggleButton value="2">
                  <SvgPathIcon iconId={'dock-bottom'}/>
                </ToggleButton>
                <ToggleButton value="3">
                  <SvgPathIcon iconId={'dock-right'}/>
                </ToggleButton>
              </ToggleButtonGroup>
            </Stack>

          </Toolbar>
          <Divider/>
        </StyledAppBar>

        <Box sx={{display: 'flex', boxSizing: 'border-box', flexGrow: 1}}>
          <Drawer
            open
            variant="persistent"
            sx={{
              width: drawerWidth,
              flexShrink: 0,
              [`& .MuiDrawer-paper`]: {
                width: drawerWidth,
                boxSizing: 'border-box',
                position: 'static',
              },
            }}
          >
            <Toolbar/>

            <Box sx={{overflow: 'auto'}}>
              <TreeView
                aria-label="file system navigator"
                defaultCollapseIcon={
                  <SvgPathIcon iconId={'chevron-down'}/>}
                defaultExpandIcon={<SvgPathIcon iconId={'chevron-right'}/>}
                sx={{height: 240, flexGrow: 1, maxWidth: 400, overflowY: 'auto'}}
              >
                <TreeItem nodeId="1" label="Applications">

                  <TreeItem nodeId="2" label="Calendar"/>
                </TreeItem>
                <TreeItem nodeId="5" label="Documents">
                  <TreeItem nodeId="10" label="OSS"/>
                  <TreeItem nodeId="6" label="MUI">
                    <TreeItem nodeId="8" label="index.js"/>
                  </TreeItem>
                </TreeItem>
              </TreeView>
            </Box>
          </Drawer>

          <Box sx={{flexGrow: 1, p: 3}}>
            {children}
          </Box>
        </Box>
      </Box>
    )
  },
)

BuilderToolbarComponent.displayName = 'BuilderToolbarComponent'
BuilderToolbarComponent.defaultProps = {}

export default BuilderToolbarComponent
