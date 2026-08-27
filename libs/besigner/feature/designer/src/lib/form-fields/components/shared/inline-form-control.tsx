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
  type FieldMuteAction,
  FIELD_MUTED_STYLES,
  FieldMuteButton,
} from '@aglyn/shared-ui-jsx-forms'
import {
  Box,
  FormControl,
  type FormControlProps,
  FormHelperText,
  FormLabel,
  type ToggleButtonGroupProps,
} from '@mui/material'
import { forwardRef } from 'react'

export interface InlineFormControlProps extends Omit<
  FormControlProps,
  'onChange'
> {
  onChange?: ToggleButtonGroupProps['onChange']
  value?: ToggleButtonGroupProps['value']
  label?: JSX.Children
  helperText?: JSX.Children
  /**
   * Switch this declaration off without losing it (AGL-2486). These rows are
   * not grid-wrapped fields, so they carry the eye themselves — beside the
   * label, where the row has room, rather than in a corner it does not have.
   */
  mute?: FieldMuteAction
}

export const InlineFormControl = forwardRef<any, InlineFormControlProps>(
  (props, forwardRef) => {
    const { helperText, label, mute, onChange, children, ...rest } = props

    return (
      <FormControl
        ref={forwardRef}
        margin="normal"
        fullWidth
        {...rest}
        sx={[
          mute?.muted ? FIELD_MUTED_STYLES : null,
          ...(Array.isArray(rest.sx) ? rest.sx : [rest.sx]),
        ]}
      >
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
          <FieldMuteButton mute={mute} sx={{ ml: -0.5 }} />
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
