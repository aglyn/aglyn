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

import {InteractionModeFlag, setBesignerFlag} from '@aglyn/core-data-besigner'
import {useAglynAppContext} from '@aglyn/core-feature-renderer'
import {
  ICON_VARIANT_MODIFY_MODE_REARRANGE,
  ICON_VARIANT_MODIFY_MODE_SELECT,
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


export interface InteractControlsProps extends StackProps {}

const InteractControlsComponent = forwardRef<any, InteractControlsProps>(
  function RefRenderFn(props, ref) {
    const {...rest} = props
    const {getApp} = useAglynAppContext()
    const interactMode = useAglynBesignerStoreState('flags', 'interactMode')
    const handleInteractModeClick = useCallback((event: MouseEvent<HTMLElement>, value: any) => {
      setBesignerFlag(getApp(), {
        flag: 'interactMode',
        value: InteractionModeFlag[InteractionModeFlag[value]],
      })
    }, [getApp])

    return (
      <MuiStack ref={ref} direction="row" spacing={1} {...rest}>
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
              <MdiIcon fontSize="inherit" path={ICON_VARIANT_MODIFY_MODE_SELECT.path} />
            </MuiToggleButton>
          </MuiTooltip>
          <MuiTooltip title={'Rearrange'}>
            <MuiToggleButton
              selected={interactMode === InteractionModeFlag.REARRANGE}
              value={InteractionModeFlag.REARRANGE}
            >
              <MdiIcon fontSize="inherit" path={ICON_VARIANT_MODIFY_MODE_REARRANGE.path} />
            </MuiToggleButton>
          </MuiTooltip>
        </MuiToggleButtonGroup>
      </MuiStack>
    )
  },
)
InteractControlsComponent.displayName = 'InteractControlsComponent'
InteractControlsComponent.aglyn = true

export {InteractControlsComponent}
export default InteractControlsComponent
