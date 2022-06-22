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
  ICON_VARIANT_DOCK_LEFT_TOGGLE,
  ICON_VARIANT_DOCK_RIGHT_TOGGLE,
} from '@aglyn/shared-data-enums'
import { MdiIcon } from '@aglyn/shared-ui-mdi-jsx'
import {
  Stack as MuiStack,
  type StackProps,
  ToggleButton as MuiToggleButton,
  ToggleButtonGroup as MuiToggleButtonGroup,
  Tooltip as MuiTooltip,
} from '@mui/material'
import { forwardRef } from 'react'
import useAglynBesignerPanel from '../hooks/use-aglyn-besigner-panel'

export interface PanelControlsProps extends StackProps {}

const PanelControlsComponent = forwardRef<any, PanelControlsProps>(
  (props, ref) => {
    const [panelLeft, setPanelLeft] = useAglynBesignerPanel('panelLeft')
    const [panelRight, setPanelRight] = useAglynBesignerPanel('panelRight')
    const openPanels = [panelLeft, panelRight]
      .filter((i) => Boolean(i?.toggled))
      .map((i) => i?.id)

    return (
      <MuiStack ref={ref} direction="row" spacing={1} {...props}>
        <MuiToggleButtonGroup size="small" value={openPanels}>
          <MuiTooltip title={'Left panel'}>
            <MuiToggleButton
              selected={Boolean(panelLeft?.toggled)}
              value={Boolean(panelLeft?.id) || false}
              onClick={() =>
                setPanelLeft((panel) => ({
                  ...panel,
                  toggled: !panel?.toggled,
                }))
              }
            >
              <MdiIcon
                fontSize="inherit"
                path={ICON_VARIANT_DOCK_LEFT_TOGGLE.path}
              />
            </MuiToggleButton>
          </MuiTooltip>
          {/*<MuiTooltip title={'Bottom panel'}>*/}
          {/*  <MuiToggleButton*/}
          {/*    selected={openPanels.some(i => i === BesignerPanelViewFlag.PANEL_BOTTOM)}*/}
          {/*    value={BesignerPanelViewFlag.PANEL_BOTTOM}*/}
          {/*  >*/}
          {/*    <MdiIcon fontSize="inherit" path={ICON_VARIANT_DOCK_BOTTOM_TOGGLE.path} />*/}
          {/*  </MuiToggleButton>*/}
          {/*</MuiTooltip>*/}
          <MuiTooltip title={'Right panel'}>
            <MuiToggleButton
              selected={Boolean(panelRight?.toggled)}
              value={Boolean(panelRight?.id) || false}
              onClick={() =>
                setPanelRight((panel) => ({
                  ...panel,
                  toggled: !panel?.toggled,
                }))
              }
            >
              <MdiIcon
                fontSize="inherit"
                path={ICON_VARIANT_DOCK_RIGHT_TOGGLE.path}
              />
            </MuiToggleButton>
          </MuiTooltip>
        </MuiToggleButtonGroup>
      </MuiStack>
    )
  },
)
PanelControlsComponent.displayName = 'PanelControlsComponent'
PanelControlsComponent.aglyn = true

export { PanelControlsComponent }
export default PanelControlsComponent
