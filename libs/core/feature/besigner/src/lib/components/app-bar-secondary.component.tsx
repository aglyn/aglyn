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
import {useAglynAppContext, useAglynElementHistory} from '@aglyn/core-feature-renderer'
import {styled} from '@aglyn/shared-feature-themes'
import {
  mdiCursorDefault,
  mdiCursorMove,
  mdiDockBottom,
  mdiDockLeft,
  mdiDockRight,
  mdiRedo,
  mdiShapeSquareRoundedPlus,
  mdiUndo,
} from '@aglyn/shared-ui-mdi-jsx'
import MuiAppBar, {AppBarProps as MuiAppBarProps} from '@mui/material/AppBar'
import Box from '@mui/material/Box'
import IconButton from '@mui/material/IconButton'
import Stack from '@mui/material/Stack'
import ToggleButton from '@mui/material/ToggleButton'
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup'
import Toolbar from '@mui/material/Toolbar'
import Tooltip from '@mui/material/Tooltip'
import React, {forwardRef, MouseEvent, useCallback} from 'react'
import MdiIcon from '../../../../../../shared/ui/mdi-jsx/src/lib/components/mdi-icon'
import {useAddElementCallback} from '../hooks/use-add-element-callback'
import {useAglynBesignerStoreState} from '../hooks/use-aglyn-besigner-store-state'


const AppBarSecondary = styled(MuiAppBar, {
  name: 'AglynAppBarSecondary',
})<MuiAppBarProps>(({theme}) => ({
  top: 0,
  borderBottom: `1px solid ${theme.palette.divider}`,
  [`& .MuiToolbar-root`]: {
    minHeight: 40,
  },
}))

const AddControls = function AddControls() {

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
          <MdiIcon fontSize="small" path={mdiShapeSquareRoundedPlus.path} />
        </IconButton>
      </Tooltip>
    </Stack>
  )
}

const HistoryControls = function HistoryControls() {
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
            <MdiIcon fontSize="small" path={mdiUndo.path} />
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
            <MdiIcon fontSize="small" path={mdiRedo.path} />
          </IconButton>
        </span>
      </Tooltip>
    </Stack>
  )
}

const InteractControls = function InteractControls() {
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
        <Tooltip title={'Direct selection'}>
          <ToggleButton
            selected={interactMode === InteractionModeFlag.SELECT}
            value={InteractionModeFlag.SELECT}
          >
            <MdiIcon fontSize="inherit" path={mdiCursorDefault.path} />
          </ToggleButton>
        </Tooltip>
        <Tooltip title={'Rearrange'}>
          <ToggleButton
            selected={interactMode === InteractionModeFlag.REARRANGE}
            value={InteractionModeFlag.REARRANGE}
          >
            <MdiIcon fontSize="inherit" path={mdiCursorMove.path} />
          </ToggleButton>
        </Tooltip>
      </ToggleButtonGroup>
    </Stack>
  )
}

const PanelControls = function PanelControls() {
  const {getApp} = useAglynAppContext()
  const panels = useAglynBesignerStoreState('panels')
  const openPanels = Object.values(panels)
    .filter((i) => Boolean(i?.toggled))
    .map((i) => i?.id)

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
        <Tooltip title={'Left panel'}>
          <ToggleButton
            selected={openPanels.some(i => i === BesignerPanelViewFlag.PANEL_LEFT)}
            value={BesignerPanelViewFlag.PANEL_LEFT}
          >
            <MdiIcon fontSize="inherit" path={mdiDockLeft.path} />
          </ToggleButton>
        </Tooltip>
        <Tooltip title={'Bottom panel'}>
          <ToggleButton
            selected={openPanels.some(i => i === BesignerPanelViewFlag.PANEL_BOTTOM)}
            value={BesignerPanelViewFlag.PANEL_BOTTOM}
          >
            <MdiIcon fontSize="inherit" path={mdiDockBottom.path} />
          </ToggleButton>
        </Tooltip>
        <Tooltip title={'Right panel'}>
          <ToggleButton
            selected={openPanels.some(i => i === BesignerPanelViewFlag.PANEL_RIGHT)}
            value={BesignerPanelViewFlag.PANEL_RIGHT}
          >
            <MdiIcon fontSize="inherit" path={mdiDockRight.path} />
          </ToggleButton>
        </Tooltip>
      </ToggleButtonGroup>
    </Stack>
  )
}

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
          <AddControls />

          <Box sx={{mx: 0.25}} />

          <HistoryControls />

          <Box sx={{flexGrow: 1}} />

          <InteractControls />

          <Box sx={{mx: 1}} />

          <InteractControls />

          <Box sx={{mx: 1}} />

          <PanelControls />

          {children}
        </Toolbar>
      </AppBarSecondary>
    )
  },
)

AppBarSecondaryComponent.displayName = 'AppBarSecondaryComponent'
AppBarSecondaryComponent.defaultProps = {}

export default AppBarSecondaryComponent
