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

import {BesignerPanelViewFlag, setBesignerPanels} from '@aglyn/core-data-besigner'
import {useAglynAppContext} from '@aglyn/core-feature-renderer'
import {
  ICON_VARIANT_DOCK_BOTTOM_TOGGLE,
  ICON_VARIANT_DOCK_LEFT_TOGGLE,
  ICON_VARIANT_DOCK_RIGHT_TOGGLE,
} from '@aglyn/shared-data-enums'
import {MdiIcon} from '@aglyn/shared-ui-mdi-jsx'
import {
  Stack as MuiStack,
  type StackProps,
  ToggleButton as MuiToggleButton,
  ToggleButtonGroup as MuiToggleButtonGroup,
  Tooltip as MuiTooltip,
} from '@mui/material'
import {forwardRef, MouseEvent, useCallback} from 'react'
import useAglynBesignerStoreState from '../hooks/use-aglyn-besigner-store-state'


export interface PanelControlsProps extends StackProps {}

const PanelControlsComponent = forwardRef<any, PanelControlsProps>(
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
              <MdiIcon fontSize="inherit" path={ICON_VARIANT_DOCK_LEFT_TOGGLE.path} />
            </MuiToggleButton>
          </MuiTooltip>
          <MuiTooltip title={'Bottom panel'}>
            <MuiToggleButton
              selected={openPanels.some(i => i === BesignerPanelViewFlag.PANEL_BOTTOM)}
              value={BesignerPanelViewFlag.PANEL_BOTTOM}
            >
              <MdiIcon fontSize="inherit" path={ICON_VARIANT_DOCK_BOTTOM_TOGGLE.path} />
            </MuiToggleButton>
          </MuiTooltip>
          <MuiTooltip title={'Right panel'}>
            <MuiToggleButton
              selected={openPanels.some(i => i === BesignerPanelViewFlag.PANEL_RIGHT)}
              value={BesignerPanelViewFlag.PANEL_RIGHT}
            >
              <MdiIcon fontSize="inherit" path={ICON_VARIANT_DOCK_RIGHT_TOGGLE.path} />
            </MuiToggleButton>
          </MuiTooltip>
        </MuiToggleButtonGroup>
      </MuiStack>
    )
  },
)
PanelControlsComponent.displayName = 'AglynPanelControlsComponent'

export {PanelControlsComponent}
export default PanelControlsComponent
