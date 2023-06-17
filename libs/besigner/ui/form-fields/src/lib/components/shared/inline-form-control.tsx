/**
 * @license
 * Copyright 2023 Aglyn LLC
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
  Box,
  FormControl,
  type FormControlProps,
  FormHelperText,
  FormLabel,
  type ToggleButtonGroupProps,
} from '@mui/material'
import { forwardRef } from 'react'

export interface InlineFormControlProps
  extends Omit<FormControlProps, 'onChange'> {
  onChange?: ToggleButtonGroupProps['onChange']
  value?: ToggleButtonGroupProps['value']
  label?: JSX.Children
  helperText?: JSX.Children
}

export const InlineFormControl = forwardRef<any, InlineFormControlProps>(
  (props, forwardRef) => {
    const { helperText, label, onChange, children, ...rest } = props

    return (
      <FormControl ref={forwardRef} margin="normal" fullWidth {...rest}>
        <Box
          sx={{
            display: 'inline-flex',
            alignItems: 'center',
            flexDirection: 'row',
            gap: 1,
            flexWrap: 'wrap',
          }}
        >
          <FormLabel
            component="label"
            sx={{
              flexBasis: `30%`,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              flexShrink: 0,
            }}
          >
            {label}
          </FormLabel>
          <Box
            sx={{
              // overflow: 'scroll',
              flexGrow: 1,
            }}
          >
            {children}
          </Box>
        </Box>

        <FormHelperText>{helperText}</FormHelperText>
      </FormControl>
    )
  },
)
InlineFormControl.displayName = 'InlineFormControl'

export default InlineFormControl
