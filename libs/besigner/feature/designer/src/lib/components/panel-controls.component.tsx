/**
 * @license
 * Copyright 2026 Aglyn LLC
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
  ICON_VARIANT_ELEMENT_PROPERTIES,
  ICON_VARIANT_ELEMENT_TREE_VIEW,
} from '@aglyn/shared-data-enums'
import { MdiIcon } from '@aglyn/shared-ui-jsx'
import {
  Stack as MuiStack,
  type StackProps,
  ToggleButton as MuiToggleButton,
  ToggleButtonGroup as MuiToggleButtonGroup,
  Tooltip as MuiTooltip,
} from '@mui/material'
import { forwardRef } from 'react'
import useAglynBesignerPanel from '../hooks/use-aglyn-besigner-panel'

export interface PanelControlsProps extends StackProps {
  /**
   * Name the panels by what they hold — layers and properties — instead of
   * by the side they dock to. Where the panels overlay the canvas there is no
   * dock to point at, and these two buttons are the only way in.
   */
  compact?: boolean
}

const PanelControlsComponent = forwardRef<any, PanelControlsProps>(
  (props, ref) => {
    const { compact, ...rest } = props
    const [panelLeft, setPanelLeft] = useAglynBesignerPanel('panelLeft')
    const [panelRight, setPanelRight] = useAglynBesignerPanel('panelRight')
    const openPanels = [panelLeft, panelRight]
      .filter((i) => Boolean(i?.toggled))
      .map((i) => i?.id)

    return (
      <MuiStack ref={ref} direction="row" spacing={1} {...rest}>
        <MuiToggleButtonGroup size="small" value={openPanels}>
          <MuiTooltip title={compact ? 'Layers & elements' : 'Left panel'}>
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
                path={
                  compact
                    ? ICON_VARIANT_ELEMENT_TREE_VIEW.path
                    : ICON_VARIANT_DOCK_LEFT_TOGGLE.path
                }
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
          <MuiTooltip title={compact ? 'Properties & styles' : 'Right panel'}>
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
                path={
                  compact
                    ? ICON_VARIANT_ELEMENT_PROPERTIES.path
                    : ICON_VARIANT_DOCK_RIGHT_TOGGLE.path
                }
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
