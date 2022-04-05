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

import {ICON_VARIANT_MODIFY_REDO, ICON_VARIANT_MODIFY_UNDO} from '@aglyn/shared-data-enums'
import {MdiIcon} from '@aglyn/shared-ui-mdi-jsx'
import {
  IconButton as MuiIconButton,
  Stack as MuiStack,
  type StackProps,
  Tooltip as MuiTooltip,
} from '@mui/material'
import {forwardRef, useCallback} from 'react'
import useAglynCanvasHistoryControls from '../hooks/use-aglyn-elements-history'


export interface HistoryControlsProps extends StackProps {}

const HistoryControlsComponent = forwardRef<any, HistoryControlsProps>(
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
            <MdiIcon fontSize="small" path={ICON_VARIANT_MODIFY_UNDO.path} />
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
            <MdiIcon fontSize="small" path={ICON_VARIANT_MODIFY_REDO.path} />
          </MuiIconButton>
        </span>
        </MuiTooltip>
      </MuiStack>
    )
  },
)
HistoryControlsComponent.displayName = 'HistoryControlsComponent'
HistoryControlsComponent.aglyn = true

export {HistoryControlsComponent}
export default HistoryControlsComponent
