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

import { createComponentElementData } from '@aglyn/core-data-framework'
import { useAglynElementsStoreWithApi } from '@aglyn/feature-renderer'
import { styled } from '@aglyn/shared-feature-themes'
import { SvgPathIcon } from '@aglyn/shared-ui-jsx'
import AppBar, { AppBarProps } from '@mui/material/AppBar'
import Box from '@mui/material/Box'
import Divider from '@mui/material/Divider'
import IconButton from '@mui/material/IconButton'
import Stack from '@mui/material/Stack'
import ToggleButton from '@mui/material/ToggleButton'
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup'
import Toolbar from '@mui/material/Toolbar'
import Tooltip from '@mui/material/Tooltip'
import { forwardRef, useCallback } from 'react'
import { useElementDrawerContext } from '../contexts/element-drawer-context'
import { useSelectionContext } from '../contexts/selection-context'


const StyledModifyAppBar = styled(AppBar, {name: 'StyledModifyAppBar'})({
  top: 0,
})

export interface BuilderToolbarComponentProps extends Partial<AppBarProps> {}

export const BuilderAppbarModifyComponent = forwardRef<any, BuilderToolbarComponentProps>(
  function RefRenderFn(props, ref) {
    const {children, ...rest} = props

    const {elementDrawer} = useElementDrawerContext()
    const {elements, api: {addElement}} = useAglynElementsStoreWithApi()
    const {$id: selectedId}: any = useSelectionContext() || {}
    const handleFabClick = useCallback(async () => {
      const option = await elementDrawer({
        title: 'Add New Element',
      })
      .then((res: any) => {
        if (res?.option?.type === 'selection') {
          return res?.option?.data
        }
      })
      .then((data: any) => {
        if (data) {
          console.log('then newElement', data)
          addElement?.({
            position: 0,
            parentId: selectedId || '__root__',

            element: createComponentElementData(data),
          })
        }
      })
      .catch((error) => {
        throw error
      })

      console.warn('async choice', option)
    }, [selectedId, elementDrawer, elements, addElement])

    return (
      <StyledModifyAppBar
        ref={ref}
        position="static"
        color="default"
        elevation={0}
        {...rest}
      >
        <Toolbar variant="dense">

          <Tooltip title={'Add element'}>
            <IconButton
              aria-haspopup="menu"
              aria-label="add"
              edge="start"
              onClick={handleFabClick}
            >
              <SvgPathIcon fontSize="small" iconIds={'add'} />
            </IconButton>
          </Tooltip>

          <Box sx={{mx: 0.25}} />

          <Stack direction="row" spacing={0.25}>
            <Tooltip title={'Undo (⌘Z)'}>
              <span>
                <IconButton
                  aria-label="undo action"
                >
                  <SvgPathIcon fontSize="small" iconIds={'undo'} />
                </IconButton>
              </span>
            </Tooltip>
            <Tooltip title={'Redo (⌘Y)'}>
              <span>
                <IconButton
                  aria-label="redo action"
                  disabled
                >
                  <SvgPathIcon fontSize="small" iconIds={'redo'} />
                </IconButton>
              </span>
            </Tooltip>
          </Stack>

          <Box sx={{flexGrow: 1}} />

          <Stack direction="row" spacing={1}>
            <ToggleButtonGroup size="small" value={['1']} exclusive>
              <ToggleButton value="1">
                <Tooltip title={'Direct selection'}>
                  <SvgPathIcon fontSize="inherit" iconIds={'cursor-default'} />
                </Tooltip>
              </ToggleButton>
              <ToggleButton value="2">
                <Tooltip title={'Rearrange'}>
                  <SvgPathIcon fontSize="inherit" iconIds={'cursor-move'} />
                </Tooltip>
              </ToggleButton>
            </ToggleButtonGroup>
          </Stack>

          <Box sx={{mx: 1}} />

          <Stack direction="row" spacing={1}>
            <ToggleButtonGroup size="small" value={['1']}>
              <Tooltip title={'Left panel'}>
                <ToggleButton value="1">
                  <SvgPathIcon fontSize="inherit" iconIds={'dock-left'} />
                </ToggleButton>
              </Tooltip>
              <Tooltip title={'Bottom panel'}>
                <ToggleButton value="2">
                  <SvgPathIcon fontSize="inherit" iconIds={'dock-bottom'} />
                </ToggleButton>
              </Tooltip>
              <Tooltip title={'Right panel'}>
                <ToggleButton value="3">
                  <SvgPathIcon fontSize="inherit" iconIds={'dock-right'} />
                </ToggleButton>
              </Tooltip>
            </ToggleButtonGroup>
          </Stack>

          {children}
        </Toolbar>
        <Divider />
      </StyledModifyAppBar>
    )
  },
)

BuilderAppbarModifyComponent.displayName = 'BuilderAppbarModifyComponent'
BuilderAppbarModifyComponent.defaultProps = {}

export default BuilderAppbarModifyComponent
