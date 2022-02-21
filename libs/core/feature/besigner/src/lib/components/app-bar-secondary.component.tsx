/**
 * @license
 * Copyright 2022 Aglyn LLC
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
  BesignerDeviceFlag,
  BesignerPanelViewFlag,
  InteractionModeFlag,
  setBesignerFlag,
  setBesignerPanels,
} from '@aglyn/core-data-besigner'
import {useAglynAppContext} from '@aglyn/core-feature-renderer'
import {
  ICON_VARIANT_FLUID_RESPONSIVE,
  ICON_VARIANT_LAPTOP,
  ICON_VARIANT_MENU_DOWN,
  ICON_VARIANT_MOBILE,
  ICON_VARIANT_MONITOR_LARGE,
  ICON_VARIANT_MONITOR_SMALL,
  ICON_VARIANT_TABLET,
} from '@aglyn/shared-data-enums'
import {styled} from '@aglyn/shared-feature-themes'
import {
  mdiCursorDefault,
  mdiCursorMove,
  mdiDockBottom,
  mdiDockLeft,
  mdiDockRight,
  MdiIcon,
  mdiRedo,
  mdiShapeSquareRoundedPlus,
  mdiUndo,
} from '@aglyn/shared-ui-mdi-jsx'
import MuiAppBar, {type AppBarProps as MuiAppBarProps} from '@mui/material/AppBar'
import Box from '@mui/material/Box'
import MuiButton from '@mui/material/Button'
import MuiButtonGroup from '@mui/material/ButtonGroup'
import MuiIconButton from '@mui/material/IconButton'
import MuiMenuItemIcon from '@mui/material/ListItemIcon'
import MuiListSubheader from '@mui/material/ListSubheader'
import MuiMenu from '@mui/material/Menu'
import MuiMenuItem from '@mui/material/MenuItem'
import MuiStack, {type StackProps} from '@mui/material/Stack'
import MuiToggleButton from '@mui/material/ToggleButton'
import MuiToggleButtonGroup from '@mui/material/ToggleButtonGroup'
import MuiToolbar from '@mui/material/Toolbar'
import MuiTooltip from '@mui/material/Tooltip'
import {forwardRef, type MouseEvent, useCallback, useMemo, useState} from 'react'
import {useAddElementCallback} from '../hooks/use-add-element-callback'
import {useAglynBesignerStoreState} from '../hooks/use-aglyn-besigner-store-state'
import useAglynCanvasHistoryControls from '../hooks/use-aglyn-elements-history'


const AppBarSecondary = styled(MuiAppBar, {
  name: 'AglynAppBarSecondary',
})<MuiAppBarProps>(({theme}) => ({
  top: 0,
  borderBottom: `1px solid ${theme.palette.divider}`,
  [`& .MuiToolbar-root`]: {
    minHeight: 40,
  },
}))

const AddControls = forwardRef<any, StackProps>(
  function RefRenderFn(props, ref) {

    const handleAddElementClick = useAddElementCallback()

    return (
      <MuiStack ref={ref} direction="row" spacing={1} {...props}>
        <MuiTooltip title={'Add element'}>
          <MuiIconButton
            aria-haspopup="menu"
            aria-label="add"
            edge="start"
            onClick={handleAddElementClick}
          >
            <MdiIcon fontSize="small" path={mdiShapeSquareRoundedPlus.path} />
          </MuiIconButton>
        </MuiTooltip>
      </MuiStack>
    )
  },
)

const HistoryControls = forwardRef<any, StackProps>(
  function RefRenderFn(props, ref) {
    const [undo, redo, canUndo, canRedo] = useAglynCanvasHistoryControls()

    const handleUndoClick = useCallback(() => {
      undo()
    }, [undo])
    const handleRedoClick = useCallback(() => {
      redo()
    }, [redo])

    return (
      <MuiStack ref={ref} direction="row" spacing={0.25} {...props}>
        <MuiTooltip title={'Undo (⌘Z)'}>
        <span>
          <MuiIconButton
            aria-label="undo action"
            onClick={handleUndoClick}
            disabled={!canUndo}
          >
            <MdiIcon fontSize="small" path={mdiUndo.path} />
          </MuiIconButton>
        </span>
        </MuiTooltip>
        <MuiTooltip title={'Redo (⌘Y)'}>
        <span>
          <MuiIconButton
            aria-label="redo action"
            onClick={handleRedoClick}
            disabled={!canRedo}
          >
            <MdiIcon fontSize="small" path={mdiRedo.path} />
          </MuiIconButton>
        </span>
        </MuiTooltip>
      </MuiStack>
    )
  },
)

const devicePreviewOptions = [
  {
    children: 'Fluid Responsive',
    value: BesignerDeviceFlag.RESPONSIVE,
    icon: {path: ICON_VARIANT_FLUID_RESPONSIVE.path},
  },
  {
    children: 'XS - Mobile',
    value: BesignerDeviceFlag.XS,
    icon: {path: ICON_VARIANT_MOBILE.path},
  },
  {
    children: 'SM - Tablet',
    value: BesignerDeviceFlag.SM,
    icon: {path: ICON_VARIANT_TABLET.path},
  },
  {
    children: 'MD - Laptop',
    value: BesignerDeviceFlag.MD,
    icon: {path: ICON_VARIANT_LAPTOP.path},
  },
  {
    children: 'LG - Desktop',
    value: BesignerDeviceFlag.LG,
    icon: {path: ICON_VARIANT_MONITOR_SMALL.path},
  },
  {
    children: 'XL - Widescreen',
    value: BesignerDeviceFlag.XL,
    icon: {path: ICON_VARIANT_MONITOR_LARGE.path},
  },
]

const PreviewControls = function PreviewControls() {
  const {getApp} = useAglynAppContext()

  const devicePreview = useAglynBesignerStoreState('flags', 'devicePreview')
  const [anchorEl, setAnchorEl] = useState<Element>(null)
  const [devicesMenuOpen, setDevicesMenuOpen] = useState(false)
  const activeDevice = useMemo(() => (
    devicePreviewOptions.find(i => i.value === devicePreview) || devicePreviewOptions[0]
  ), [devicePreview])

  const handleMenuClose = useCallback((event: MouseEvent<HTMLElement>) => {
    setDevicesMenuOpen(false)
  }, [])
  const handleOpenMenu = useCallback((event: MouseEvent<HTMLElement>) => {
    setDevicesMenuOpen(true)
  }, [])
  const handleMenuClick = (device: BesignerDeviceFlag) => (event: MouseEvent<HTMLElement>) => {
    setBesignerFlag(getApp(), {flag: 'devicePreview', value: device})
    setDevicesMenuOpen(false)
  }

  return (
    <MuiStack direction="row" spacing={1}>
      <MuiButtonGroup size="small" variant="outlined" color="inherit">
        <MuiTooltip title={'Device preview mode'}>

          <MuiButton
            aria-label="device preview mode"
            aria-haspopup="menu"
            aria-controls={devicesMenuOpen ? 'aglyn:device-preview' : undefined}
            aria-expanded={devicesMenuOpen ? 'true' : undefined}
            ref={setAnchorEl}
            onClick={handleOpenMenu}
            startIcon={<MdiIcon fontSize="inherit" {...activeDevice.icon} />}
            endIcon={<MdiIcon fontSize="inherit" path={ICON_VARIANT_MENU_DOWN.path} />}
            sx={{borderColor: 'divider', '& .MuiButton-endIcon': {ml: 0.15}, '& .MuiButton-startIcon': {mr: 0.85}}}
          >
            {activeDevice.children}
          </MuiButton>
        </MuiTooltip>
      </MuiButtonGroup>

      <MuiMenu
        id="aglyn:device-preview"
        anchorEl={anchorEl}
        open={devicesMenuOpen}
        onClose={handleMenuClose}
        onClick={handleMenuClose}
        PaperProps={{
          elevation: 0,
          sx: {
            overflow: 'visible',
            filter: 'drop-shadow(0px 2px 8px rgba(0,0,0,0.32))',
            bgcolor: 'background.secondary',
            mt: 1.5,
            '&:before': {
              content: '""',
              display: 'block',
              position: 'absolute',
              top: 0,
              right: 14,
              width: 10,
              height: 10,
              bgcolor: 'background.secondary',
              transform: 'translateY(-50%) rotate(45deg)',
              zIndex: 0,
            },
          },
        }}
        transformOrigin={{horizontal: 'right', vertical: 'top'}}
        anchorOrigin={{horizontal: 'right', vertical: 'bottom'}}
      >
        <MuiListSubheader sx={{lineHeight: theme => theme.typography.pxToRem(32)}}>Artboard preview mode</MuiListSubheader>
        {devicePreviewOptions.map((item) => (
          <MuiMenuItem
            key={item.value}
            selected={item.value === activeDevice.value}
            disabled={item.value === activeDevice.value}
            onClick={handleMenuClick(item.value)}
          >
            <MuiMenuItemIcon>
              <MdiIcon fontSize="small" {...item.icon} />
            </MuiMenuItemIcon>
            {item.children}
          </MuiMenuItem>
        ))}
      </MuiMenu>
    </MuiStack>
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
  }, [getApp])

  return (
    <MuiStack direction="row" spacing={1}>
      <MuiToggleButtonGroup
        size="small"
        value={interactMode}
        onChange={handleInteractModeClick}
        exclusive
      >
        <MuiTooltip title={'Direct selection'}>
          <MuiToggleButton
            selected={interactMode === InteractionModeFlag.SELECT}
            value={InteractionModeFlag.SELECT}
          >
            <MdiIcon fontSize="inherit" path={mdiCursorDefault.path} />
          </MuiToggleButton>
        </MuiTooltip>
        <MuiTooltip title={'Rearrange'}>
          <MuiToggleButton
            selected={interactMode === InteractionModeFlag.REARRANGE}
            value={InteractionModeFlag.REARRANGE}
          >
            <MdiIcon fontSize="inherit" path={mdiCursorMove.path} />
          </MuiToggleButton>
        </MuiTooltip>
      </MuiToggleButtonGroup>
    </MuiStack>
  )
}

const PanelControls = forwardRef<any, StackProps>(
  function RefRenderFn(props, ref) {
    const {getApp} = useAglynAppContext()
    const panels = useAglynBesignerStoreState('panels')
    const openPanels = Object.values(panels)
      .filter((i) => Boolean(i?.toggled))
      .map((i) => i?.id)

    const handlePanelToggle = useCallback(
      (event: MouseEvent<HTMLElement>, value: BesignerPanelViewFlag[]) => {
        setBesignerPanels(getApp(), {
          panels: (panels) => ({
            panelLeft: {
              ...panels.panelLeft,
              toggled: value.indexOf(BesignerPanelViewFlag.PANEL_LEFT) >= 0,
            },
            panelRight: {
              ...panels.panelRight,
              toggled: value.indexOf(BesignerPanelViewFlag.PANEL_RIGHT) >= 0,
            },
            panelBottom: {
              ...panels.panelBottom,
              toggled: value.indexOf(BesignerPanelViewFlag.PANEL_BOTTOM) >= 0,
            },
          }),
        })
      },
      [getApp],
    )

    return (
      <MuiStack ref={ref} direction="row" spacing={1} {...ref}>
        <MuiToggleButtonGroup
          size="small"
          value={openPanels}
          onChange={handlePanelToggle}
        >
          <MuiTooltip title={'Left panel'}>
            <MuiToggleButton
              selected={openPanels.some(i => i === BesignerPanelViewFlag.PANEL_LEFT)}
              value={BesignerPanelViewFlag.PANEL_LEFT}
            >
              <MdiIcon fontSize="inherit" path={mdiDockLeft.path} />
            </MuiToggleButton>
          </MuiTooltip>
          <MuiTooltip title={'Bottom panel'}>
            <MuiToggleButton
              selected={openPanels.some(i => i === BesignerPanelViewFlag.PANEL_BOTTOM)}
              value={BesignerPanelViewFlag.PANEL_BOTTOM}
            >
              <MdiIcon fontSize="inherit" path={mdiDockBottom.path} />
            </MuiToggleButton>
          </MuiTooltip>
          <MuiTooltip title={'Right panel'}>
            <MuiToggleButton
              selected={openPanels.some(i => i === BesignerPanelViewFlag.PANEL_RIGHT)}
              value={BesignerPanelViewFlag.PANEL_RIGHT}
            >
              <MdiIcon fontSize="inherit" path={mdiDockRight.path} />
            </MuiToggleButton>
          </MuiTooltip>
        </MuiToggleButtonGroup>
      </MuiStack>
    )
  },
)

export interface AppBarSecondaryComponentProps extends Partial<MuiAppBarProps> {}

export const AppBarSecondaryComponent = forwardRef<any, AppBarSecondaryComponentProps>(
  function RefRenderFn(props, ref) {
    const {children, ...rest} = props

    return (
      <AppBarSecondary
        ref={ref}
        id="aglyn:besigner-appbar-secondary"
        aria-label="secondary app toolbar"
        position="static"
        color="inherit"
        elevation={0}
        {...rest}
      >
        <MuiToolbar variant="dense">
          <AddControls />

          <Box sx={{mx: 0.25}} />

          <HistoryControls />

          <Box sx={{flexGrow: 1}} />

          <PreviewControls />

          <Box sx={{mx: 1}} />

          <InteractControls />

          <Box sx={{mx: 1}} />

          <PanelControls />

          {children}
        </MuiToolbar>
      </AppBarSecondary>
    )
  },
)

AppBarSecondaryComponent.displayName = 'AppBarSecondaryComponent'
AppBarSecondaryComponent.defaultProps = {}

export default AppBarSecondaryComponent
