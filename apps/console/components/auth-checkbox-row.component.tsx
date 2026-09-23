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
'use client'

import {
  Checkbox,
  FormControlLabel,
  FormHelperText,
  Typography,
} from '@mui/material'
import { useId, type ReactNode } from 'react'

export interface AuthCheckboxRowProps {
  checked: boolean
  onChange: (checked: boolean) => void
  /** The input's accessible name — shorter than the sentence beside it. */
  inputLabel: string
  /** The sentence beside the box. */
  children: ReactNode
  /**
   * Why the row is stopping the form, when it is. The unticked box turns the
   * error color with it, since unticked is the state the message is about.
   */
  error?: ReactNode
}

/**
 * One checkbox row on an auth page (AGL-3291).
 *
 * The rows used to be `inline-flex` inside a paper whose stack centers its
 * text, so each one was centered on its own width: two rows, two left edges,
 * neither on the fields' edge, and a wrapped second line centered under the
 * first. A row here is a full-width block with left-aligned text, so every
 * box sits on the same edge as the fields above it.
 *
 * The box keeps `FormControlLabel`'s own negative left margin, which is what
 * lines the visible square up with the edge; its 9px padding is pulled back
 * out of the flow top and bottom so the row is exactly as tall as its text and
 * the square is centered on the FIRST line, however many lines follow.
 *
 * Span elements throughout: all of this renders inside a `<label>`, which
 * admits phrasing content only.
 */
export function AuthCheckboxRow({
  checked,
  onChange,
  inputLabel,
  children,
  error,
}: AuthCheckboxRowProps) {
  const errorId = useId()
  return (
    <FormControlLabel
      disableTypography
      sx={{ display: 'flex', alignItems: 'flex-start', mr: 0, textAlign: 'left' }}
      control={
        <Checkbox
          checked={checked}
          onChange={(event) => onChange(event.target.checked)}
          size="small"
          color="primary"
          sx={[{ my: '-9px' }, Boolean(error) && !checked && { color: 'error.main' }]}
          slotProps={{
            input: {
              'aria-label': inputLabel,
              ...(error
                ? { 'aria-invalid': true, 'aria-describedby': errorId }
                : {}),
            },
          }}
        />
      }
      label={
        <span>
          <Typography component="span" variant="body2" sx={{ display: 'block' }}>
            {children}
          </Typography>
          {error ? (
            <FormHelperText
              component="span"
              id={errorId}
              error
              sx={{ display: 'block', m: 0, mt: 0.5 }}
            >
              {error}
            </FormHelperText>
          ) : null}
        </span>
      }
    />
  )
}
AuthCheckboxRow.displayName = 'AuthCheckboxRow'

export default AuthCheckboxRow
