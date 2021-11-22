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

import {
  createComponentElementData,
  getBuilderStore,
  InteractionModeFlag,
  setBuilderFlag,
  setBuilderPanels,
} from '@aglyn/core-data-framework'
import {
  useAglynAppContext,
  useAglynElementParentPosition,
  useAglynElementsStoreWithApi,
} from '@aglyn/feature-renderer'
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
import { useStoreMap } from 'effector-react'
import { forwardRef, memo, MouseEvent, useCallback } from 'react'
import { useAglynBuilderStore } from '../../../../renderer/src/lib/hooks/use-aglyn-builder-store'
import useAglynElementHistory from '../../../../renderer/src/lib/hooks/use-aglyn-elements-history'
import { useElementDrawerContext } from '../contexts/element-drawer-context'


const StyledModifyAppBar = styled(AppBar, {name: 'StyledModifyAppBar'})({
  top: 0,
})

const HistoryControls = memo(() => {
  const {undo, redo, past, future} = useAglynElementHistory()

  const handleUndoClick = useCallback(() => {
    undo()
  }, [undo])
  const handleRedoClick = useCallback(() => {
    redo()
  }, [redo])

  return (
    <Stack direction="row" spacing={0.25}>
      <Tooltip title={'Undo (⌘Z)'}>
        <span>
          <IconButton
            aria-label="undo action"
            onClick={handleUndoClick}
            disabled={past <= 0}
          >
            <SvgPathIcon fontSize="small" iconIds={'undo'} />
          </IconButton>
        </span>
      </Tooltip>
      <Tooltip title={'Redo (⌘Y)'}>
        <span>
          <IconButton
            aria-label="redo action"
            onClick={handleRedoClick}
            disabled={future <= 0}
          >
            <SvgPathIcon fontSize="small" iconIds={'redo'} />
          </IconButton>
        </span>
      </Tooltip>
    </Stack>
  )
})

export interface AppBarModifyComponentProps extends Partial<AppBarProps> {}

export const AppBarModifyComponent = forwardRef<any, AppBarModifyComponentProps>(
  function RefRenderFn(props, ref) {
    const {children, ...rest} = props

    const {getApp} = useAglynAppContext()
    const {elementDrawer} = useElementDrawerContext()
    const {elements, api: {addElement}} = useAglynElementsStoreWithApi()
    const {$id: selectedId} = useAglynBuilderStore('canvas', 'selected') || {}
    const {
      parentId: selectedParentId,
      index: selectedIndex,
      parentElements: selectedParentElements,
    } = useAglynElementParentPosition(selectedId) || {}

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
          const pos = (selectedIndex === -1 ? selectedParentElements.length : selectedIndex + 1)
          console.log('then newElement', selectedIndex, pos, selectedParentElements)
          addElement({
            position: pos,
            parentId: selectedParentId || '__root__',

            element: createComponentElementData(data),
          })
        }
      })
      .catch((error) => {
        throw error
      })

      console.warn('async choice', option)
    }, [selectedId, elementDrawer, elements, addElement, selectedParentElements, selectedParentId, selectedIndex])

    const interactMode = useStoreMap(
      getBuilderStore(getApp(), {store: 'flags'}),
      (flags) => flags.interactMode,
    )
    const handleInteractModeClick = useCallback((event: MouseEvent<HTMLElement>, value: any) => {
      setBuilderFlag(getApp(), {
        flag: 'interactMode',
        value: InteractionModeFlag[InteractionModeFlag[value]],
      })
    }, [])

    const {openPanels} = useStoreMap(
      getBuilderStore(getApp(), {store: 'panels'}),
      (panels) => {
        const openPanels = []
        ;(['left', 'bottom', 'right']).map((panel) => {
          if (panels[panel]?.toggled) {
            openPanels.push(panel)
          }
        })
        console.log('panels', panels)
        return {
          ...panels,
          openPanels,
        }
      },
    )
    const handlePanelToggle = useCallback((event: MouseEvent<HTMLElement>, value: ('left' | 'bottom' | 'right')[]) => {
      const openPanels = [...value]
      setBuilderPanels(getApp(), {
        left: {toggled: openPanels.some((i) => i === 'left')},
        bottom: {toggled: openPanels.some((i) => i === 'bottom')},
        right: {toggled: openPanels.some((i) => i === 'right')},
      })
    }, [])

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
              <SvgPathIcon fontSize="small" iconIds={'shape-square-rounded-plus'} />
            </IconButton>
          </Tooltip>

          <Box sx={{mx: 0.25}} />

          <HistoryControls />

          <Box sx={{flexGrow: 1}} />

          <Stack direction="row" spacing={1}>
            <ToggleButtonGroup
              size="small"
              value={interactMode}
              onChange={handleInteractModeClick}
              exclusive
            >
              <ToggleButton value={InteractionModeFlag.SELECT}>
                <Tooltip title={'Direct selection'}>
                  <SvgPathIcon fontSize="inherit" iconIds={'cursor-default'} />
                </Tooltip>
              </ToggleButton>
              <ToggleButton value={InteractionModeFlag.REARRANGE}>
                <Tooltip title={'Rearrange'}>
                  <SvgPathIcon fontSize="inherit" iconIds={'cursor-move'} />
                </Tooltip>
              </ToggleButton>
            </ToggleButtonGroup>
          </Stack>

          <Box sx={{mx: 1}} />

          <Stack direction="row" spacing={1}>
            <ToggleButtonGroup
              size="small"
              value={openPanels}
              onChange={handlePanelToggle}
            >
              <ToggleButton value="left">
                <Tooltip title={'Left panel'}>
                  <SvgPathIcon fontSize="inherit" iconIds={'dock-left'} />
                </Tooltip>
              </ToggleButton>
              <ToggleButton value="bottom">
                <Tooltip title={'Bottom panel'}>
                  <SvgPathIcon fontSize="inherit" iconIds={'dock-bottom'} />
                </Tooltip>
              </ToggleButton>
              <ToggleButton value="right">
                <Tooltip title={'Right panel'}>
                  <SvgPathIcon fontSize="inherit" iconIds={'dock-right'} />
                </Tooltip>
              </ToggleButton>
            </ToggleButtonGroup>
          </Stack>

          {children}
        </Toolbar>
        <Divider />
      </StyledModifyAppBar>
    )
  },
)

AppBarModifyComponent.displayName = 'AppBarModifyComponent'
AppBarModifyComponent.defaultProps = {}

export default AppBarModifyComponent
