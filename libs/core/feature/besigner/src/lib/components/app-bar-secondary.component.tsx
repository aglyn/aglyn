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
  BesignerPanelViewFlag,
  InteractionModeFlag,
  setBesignerFlag,
  setBesignerPanels,
} from '@aglyn/core-data-framework'
import { useAglynAppContext, useAglynElementHistory } from '@aglyn/core-feature-renderer'
import { styled } from '@aglyn/shared-feature-themes'
import { SvgPathIcon } from '@aglyn/shared-ui-jsx'
import MuiAppBar, { AppBarProps as MuiAppBarProps } from '@mui/material/AppBar'
import Box from '@mui/material/Box'
import IconButton from '@mui/material/IconButton'
import Stack from '@mui/material/Stack'
import ToggleButton from '@mui/material/ToggleButton'
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup'
import Toolbar from '@mui/material/Toolbar'
import Tooltip from '@mui/material/Tooltip'
import { forwardRef, memo, MouseEvent, useCallback } from 'react'
import { useAddElementCallback } from '../hooks/use-add-element-callback'
import { useAglynBesignerStoreState } from '../hooks/use-aglyn-besigner-store-state'


const AppBarSecondary = styled(MuiAppBar, {
  name: 'AglynAppBarSecondary',
})<MuiAppBarProps>(({theme})=>({
  top: 0,
  borderBottom: `1px solid ${theme.palette.divider}`,
  [`& .MuiToolbar-root`]: {
    minHeight: 40,
  },
}))

const AddControls = memo(function AddControls() {

  const handleAddElementClick = useAddElementCallback()

  return (
    <Stack direction="row" spacing={1}>
      <Tooltip title={'Add element'}>
        <IconButton
          aria-haspopup="menu"
          aria-label="add"
          edge="start"
          onClick={handleAddElementClick}
        >
          <SvgPathIcon
            fontSize="small"
            iconIds={'shape-square-rounded-plus'}
          />
        </IconButton>
      </Tooltip>
    </Stack>
  )
})

const HistoryControls = memo(function HistoryControls() {
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

const InteractControls = memo(function InteractControls() {
  const {getApp} = useAglynAppContext()
  const interactMode = useAglynBesignerStoreState('flags', 'interactMode')
  const handleInteractModeClick = useCallback((event: MouseEvent<HTMLElement>, value: any) => {
    setBesignerFlag(getApp(), {
      flag: 'interactMode',
      value: InteractionModeFlag[InteractionModeFlag[value]],
    })
  }, [])

  return (
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
  )
})

const PanelControls = memo(function PanelControls() {
  const {getApp} = useAglynAppContext()
  const panels = useAglynBesignerStoreState('panels')
  const openPanels = Object.values(panels)
  .filter((i) => Boolean(i?.toggled))
  .map((i) => {
    console.log('openPanels ~~~~i', i)
    return i?.id
  })

  console.log('opens panels', panels, openPanels)

  const handlePanelToggle = useCallback(
    (event: MouseEvent<HTMLElement>, value: BesignerPanelViewFlag[]) => {
      setBesignerPanels(getApp(), {
        panelLeft: {toggled: value.indexOf(BesignerPanelViewFlag.PANEL_LEFT) >= 0},
        panelRight: {toggled: value.indexOf(BesignerPanelViewFlag.PANEL_RIGHT) >= 0},
        panelBottom: {toggled: value.indexOf(BesignerPanelViewFlag.PANEL_BOTTOM) >= 0},
      })
    },
    [],
  )

  return (
    <Stack direction="row" spacing={1}>
      <ToggleButtonGroup
        size="small"
        value={openPanels}
        onChange={handlePanelToggle}
      >
        <ToggleButton value={BesignerPanelViewFlag.PANEL_LEFT}>
          <Tooltip title={'Left panel'}>
            <SvgPathIcon fontSize="inherit" iconIds={'dock-left'} />
          </Tooltip>
        </ToggleButton>
        <ToggleButton value={BesignerPanelViewFlag.PANEL_BOTTOM}>
          <Tooltip title={'Bottom panel'}>
            <SvgPathIcon fontSize="inherit" iconIds={'dock-bottom'} />
          </Tooltip>
        </ToggleButton>
        <ToggleButton value={BesignerPanelViewFlag.PANEL_RIGHT}>
          <Tooltip title={'Right panel'}>
            <SvgPathIcon fontSize="inherit" iconIds={'dock-right'} />
          </Tooltip>
        </ToggleButton>
      </ToggleButtonGroup>
    </Stack>
  )
})

export interface AppBarSecondaryComponentProps extends Partial<MuiAppBarProps> {}

export const AppBarSecondaryComponent = forwardRef<any, AppBarSecondaryComponentProps>(
  function RefRenderFn(props, ref) {
    const {children, ...rest} = props

    return (
      <AppBarSecondary
        ref={ref}
        position="static"
        color="inherit"
        elevation={0}
        {...rest}
      >
        <Toolbar variant="dense">
          <AddControls/>

          <Box sx={{mx: 0.25}} />

          <HistoryControls />

          <Box sx={{flexGrow: 1}} />

          <InteractControls/>

          <Box sx={{mx: 1}} />

          <PanelControls/>

          {children}
        </Toolbar>
      </AppBarSecondary>
    )
  },
)

AppBarSecondaryComponent.displayName = 'AppBarSecondaryComponent'
AppBarSecondaryComponent.defaultProps = {}

export default AppBarSecondaryComponent
