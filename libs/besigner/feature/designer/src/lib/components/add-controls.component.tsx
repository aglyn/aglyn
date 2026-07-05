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

import * as Besigner from '@aglyn/besigner'
import { ICON_VARIANT_MODIFY_ADD } from '@aglyn/shared-data-enums'
import { MdiIcon } from '@aglyn/shared-ui-jsx'
import {
  IconButton as MuiIconButton,
  Stack as MuiStack,
  type StackProps,
  Tooltip as MuiTooltip,
} from '@mui/material'
import { forwardRef } from 'react'
import useAddElementDrawerCallback from '../hooks/use-add-element-drawer-callback'

export interface AddControlsProps extends StackProps {}

const AddControlsComponent = forwardRef<any, AddControlsProps>((props, ref) => {
  const handleAddElementClick = useAddElementDrawerCallback()

  return (
    <MuiStack ref={ref} direction="row" spacing={1} {...props}>
      <MuiTooltip title={'Add element'}>
        <MuiIconButton
          aria-haspopup="menu"
          aria-label="add-element"
          onClick={() =>
            handleAddElementClick(Besigner.focus.getLastSelected())
          }
        >
          <MdiIcon fontSize="small" path={ICON_VARIANT_MODIFY_ADD.path} />
        </MuiIconButton>
      </MuiTooltip>
    </MuiStack>
  )
})
AddControlsComponent.displayName = 'AddControlsComponent'
AddControlsComponent.aglyn = true

export { AddControlsComponent }
export default AddControlsComponent
