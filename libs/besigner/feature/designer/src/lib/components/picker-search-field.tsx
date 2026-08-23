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

import { ICON_VARIANT_CLEAR, ICON_VARIANT_SEARCH } from '@aglyn/shared-data-enums'
import { MdiIcon } from '@aglyn/shared-ui-jsx'
import {
  IconButton,
  InputAdornment,
  InputBase,
  type InputBaseProps,
} from '@mui/material'

export interface PickerSearchFieldProps
  extends Omit<InputBaseProps, 'onChange' | 'value'> {
  value: string
  onChange: (e: { currentTarget?: { value?: string } }) => void
}

/**
 * The element picker's search input, shared by the Choose-element dialog and
 * the Elements panel (AGL-2486).
 *
 * Both surfaces get the same accessible name and the same clear affordance,
 * so a search that works in one works the same way in the other. The ranking
 * they share lives in `usePickerFilter`.
 */
export function PickerSearchField(props: PickerSearchFieldProps) {
  const { value, onChange, ...rest } = props

  return (
    <InputBase
      sx={{ flex: 1, color: 'inherit' }}
      placeholder="Search elements"
      inputProps={{ 'aria-label': 'search elements' }}
      value={value}
      onChange={onChange}
      startAdornment={
        <InputAdornment sx={{ color: 'inherit' }} position="start">
          <MdiIcon path={ICON_VARIANT_SEARCH.path} />
        </InputAdornment>
      }
      endAdornment={
        value ? (
          <InputAdornment sx={{ color: 'inherit' }} position="end">
            <IconButton
              type="button"
              color="inherit"
              sx={{ p: '10px' }}
              aria-label="clear filter"
              // An IconButton has no `currentTarget.value`, so the shared
              // handler reads the query as '' — the clear IS the change.
              onClick={onChange}
            >
              <MdiIcon path={ICON_VARIANT_CLEAR.path} />
            </IconButton>
          </InputAdornment>
        ) : null
      }
      {...rest}
    />
  )
}
PickerSearchField.displayName = 'PickerSearchField'

export default PickerSearchField
