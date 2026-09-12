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

import ClearIcon from '@mui/icons-material/Clear'
import SearchIcon from '@mui/icons-material/Search'
import { IconButton, InputAdornment, TextField, Tooltip } from '@mui/material'

import {
  type MediaSearchMode,
  mediaSearchScopeMessage,
} from './media-search'

export interface MediaSearchFieldProps {
  value: string
  onChange: (value: string) => void
  /** Documents in the loaded window. */
  loaded: number
  /** Documents in the library, from the counter doc; 0 when unknown. */
  total: number
  /** The window holds every document of the current query. */
  complete: boolean
  /** A completion pass is in flight. */
  completing: boolean
  /** The completion pass stopped at the read cap. */
  truncated: boolean
  mode: MediaSearchMode
  /** How many items the current query returned. */
  matches: number
}

/**
 * The magnifier, built once.
 *
 * It depends on nothing this component renders, and its IDENTITY is load
 * bearing (AGL-2854). MUI `InputBase` reports the adornment up to the
 * enclosing `FormControl` from a passive effect keyed on the element:
 *
 * ```js
 * useEffect(() => {
 *   if (muiFormControl) muiFormControl.setAdornedStart(Boolean(startAdornment))
 * }, [muiFormControl, startAdornment])
 * ```
 *
 * Inline, that element was new on every render, so the effect re-ran on
 * every render and called `setAdornedStart` with the value the state
 * already held. React cannot take the eager-bailout path for that call —
 * the fiber's alternate still carries the lanes of the render being
 * committed — so each one enqueued a real update during the commit's
 * passive flush. React counts those, never resetting the count while they
 * keep arriving, and throws at 50.
 *
 * The library re-renders this field on every keystroke ANYWHERE on the
 * page, so the 51st keystroke in the details drawer's Alt text field threw
 * React error #185 and unmounted the media page.
 */
const SEARCH_ADORNMENT = (
  <InputAdornment position="start">
    <SearchIcon fontSize="small" color="disabled" />
  </InputAdornment>
)

/**
 * The DAM search box (AGL-1460).
 *
 * Extracted from the 3,400-line library for one reason: the two complaints
 * against it are behaviours — "changing the text does not update the
 * results" and "there is no clear button" — and neither can be driven inside
 * a component that mounts a Firestore listener stack and a dnd-kit surface.
 * Here they are rendered and clicked for real; the library's own wiring is
 * asserted over its declaration in `media-search-wiring.spec.ts`.
 *
 * The caption is the honest half. It comes from `mediaSearchScopeMessage`,
 * which is where the account of WHAT WAS ACTUALLY SEARCHED lives, so the
 * label and the read window cannot drift apart.
 */
export function MediaSearchField(props: MediaSearchFieldProps) {
  const { value, onChange, ...scope } = props
  const active = Boolean(value.trim())
  return (
    <TextField
      size="small"
      label="Search"
      value={value}
      onChange={(event) => onChange(event.target.value)}
      // Escape is what a person reaches for before they look for an ✕.
      onKeyDown={(event) => {
        if (event.key === 'Escape' && value) {
          event.stopPropagation()
          onChange('')
        }
      }}
      sx={{ minWidth: 260 }}
      helperText={mediaSearchScopeMessage({ ...scope, active })}
      slotProps={{
        input: {
          startAdornment: SEARCH_ADORNMENT,
          endAdornment: value ? (
            <InputAdornment position="end">
              <Tooltip title="Clear search">
                <IconButton
                  size="small"
                  edge="end"
                  aria-label="Clear search"
                  onClick={() => onChange('')}
                >
                  <ClearIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            </InputAdornment>
          ) : null,
        },
      }}
    />
  )
}

export default MediaSearchField
