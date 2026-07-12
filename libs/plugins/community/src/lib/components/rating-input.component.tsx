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

import type { CustomFieldInputProps } from '@aglyn/aglyn'
import { MenuItem, TextField } from '@mui/material'

/** Record-editor input for the `rating` custom field type (AGL-434). */
export default function RatingInput({
  value,
  onChange,
  disabled,
  label,
}: CustomFieldInputProps) {
  return (
    <TextField
      select
      size="small"
      label={label ?? 'Rating'}
      value={String(value ?? '')}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value)}
    >
      <MenuItem value="">{'—'}</MenuItem>
      {[0, 1, 2, 3, 4, 5].map((rating) => (
        <MenuItem key={rating} value={String(rating)}>
          {'★'.repeat(rating) || '☆ (0)'}
        </MenuItem>
      ))}
    </TextField>
  )
}
