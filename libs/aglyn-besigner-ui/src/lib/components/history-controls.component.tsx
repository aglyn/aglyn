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

import * as Aglyn from '@aglyn/aglyn'
import {
  ICON_VARIANT_MODIFY_REDO,
  ICON_VARIANT_MODIFY_UNDO,
} from '@aglyn/shared-data-enums'
import { MdiIcon } from '@aglyn/shared-ui-jsx'
import {
  IconButton as MuiIconButton,
  Stack as MuiStack,
  type StackProps,
  Tooltip as MuiTooltip,
} from '@mui/material'
import { observer } from 'mobx-react-lite'
import { forwardRef, type MutableRefObject } from 'react'

export interface HistoryControlsProps extends StackProps {}

function HistoryControls(
  props: HistoryControlsProps,
  ref: MutableRefObject<any>,
) {
  return (
    <MuiStack ref={ref} direction="row" spacing={0.25} {...props}>
      <MuiTooltip title={'Undo (⌘Z)'}>
        <span>
          <MuiIconButton
            aria-label="undo action"
            onClick={() => Aglyn.canvas.undo()}
            disabled={!Aglyn.canvas.canUndo}
          >
            <MdiIcon fontSize="small" path={ICON_VARIANT_MODIFY_UNDO.path} />
          </MuiIconButton>
        </span>
      </MuiTooltip>
      <MuiTooltip title={'Redo (⌘Y)'}>
        <span>
          <MuiIconButton
            aria-label="redo action"
            onClick={() => Aglyn.canvas.redo()}
            disabled={!Aglyn.canvas.canRedo}
          >
            <MdiIcon fontSize="small" path={ICON_VARIANT_MODIFY_REDO.path} />
          </MuiIconButton>
        </span>
      </MuiTooltip>
    </MuiStack>
  )
}
HistoryControls.displayName = 'HistoryControlsComponent'
HistoryControls.aglyn = true

export const HistoryControlsComponent = observer(
  forwardRef<any, HistoryControlsProps>(HistoryControls),
)
export default HistoryControlsComponent
