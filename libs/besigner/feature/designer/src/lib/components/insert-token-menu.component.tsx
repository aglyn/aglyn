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

import { mdiCodeBraces } from '@aglyn/shared-data-mdi'
import { MdiIcon } from '@aglyn/shared-ui-jsx'
import {
  Box,
  IconButton,
  InputAdornment,
  ListSubheader,
  Menu,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { type MouseEvent, useCallback, useMemo, useRef, useState } from 'react'

import type { BindingOption } from '../contexts/binding-picker-context'

/**
 * Insert-token building blocks (AGL-583): the {x} input adornment that
 * opens the data-placeholder picker on token-capable attribute fields, the
 * grouped/searchable picker menu itself, and the pure caret-splice helper.
 * The element props form wires them to the form state so an insert behaves
 * exactly like typing the token by hand (raw `{{...}}` stays supported).
 */

/**
 * Splices `token` into `text` at the captured selection, replacing any
 * selected range — the concat/builder behavior: existing text before and
 * after the caret is preserved. A null/undefined start means the field was
 * never focused, so the token appends at the end. Returns the new value
 * and the caret position just after the inserted token.
 */
export function insertTokenIntoText(
  text: string,
  token: string,
  start?: number | null,
  end?: number | null,
): { value: string; caret: number } {
  const length = text.length
  const clamp = (value: number) => Math.min(Math.max(value, 0), length)
  const at = start == null ? length : clamp(start)
  const to = end == null ? at : Math.max(clamp(end), at)
  return {
    value: `${text.slice(0, at)}${token}${text.slice(to)}`,
    caret: at + token.length,
  }
}

/** The input element + selection captured when the adornment is pressed. */
export interface TokenFieldCapture {
  input: HTMLInputElement | HTMLTextAreaElement | null
  start: number | null
  end: number | null
}

/**
 * Reads the adornment's sibling input and, when it holds focus, its
 * selection. Selection is only trusted while the input is focused — an
 * unfocused input reports a stale 0/0 selection, and inserting there
 * would silently prepend; appending at the end is the safer default.
 */
export function captureAdornmentTarget(button: HTMLElement): TokenFieldCapture {
  const root = button.closest('.MuiInputBase-root')
  const input = root?.querySelector('input, textarea') as
    | HTMLInputElement
    | HTMLTextAreaElement
    | null
  const focused = Boolean(input) && document.activeElement === input
  return {
    input,
    start: focused ? input?.selectionStart ?? null : null,
    end: focused ? input?.selectionEnd ?? null : null,
  }
}

export interface InsertTokenAdornmentProps {
  onOpen: (anchor: HTMLElement, capture: TokenFieldCapture) => void
}

/**
 * The small {x} button rendered as an end adornment on token-capable
 * attribute inputs. The caret is captured on MOUSEDOWN — before the click
 * would move focus — and the default is prevented so the input keeps both
 * focus and its visible selection while the picker opens.
 */
export function InsertTokenAdornment(props: InsertTokenAdornmentProps) {
  const { onOpen } = props
  const captureRef = useRef<TokenFieldCapture | null>(null)

  const handleMouseDown = useCallback((event: MouseEvent<HTMLElement>) => {
    captureRef.current = captureAdornmentTarget(event.currentTarget)
    event.preventDefault()
  }, [])

  const handleClick = useCallback(
    (event: MouseEvent<HTMLElement>) => {
      // Keyboard activation never fires mousedown — capture on demand
      // (the input isn't focused then, so the token appends at the end).
      const capture =
        captureRef.current ?? captureAdornmentTarget(event.currentTarget)
      captureRef.current = null
      onOpen(event.currentTarget, capture)
    },
    [onOpen],
  )

  return (
    <InputAdornment position="end">
      <IconButton
        aria-label="Insert data token"
        title="Insert data"
        size="small"
        edge="end"
        onMouseDown={handleMouseDown}
        onClick={handleClick}
      >
        <MdiIcon path={mdiCodeBraces.path} fontSize="small" />
      </IconButton>
    </InputAdornment>
  )
}
InsertTokenAdornment.displayName = 'InsertTokenAdornment'

export interface InsertTokenMenuProps {
  anchorEl: HTMLElement | null
  open: boolean
  onClose: () => void
  options: BindingOption[]
  onInsert: (token: string) => void
}

/**
 * The grouped, searchable data-placeholder picker (AGL-583) — one menu
 * serving both the per-field {x} adornment and the legacy element-level
 * "Insert binding" button (AGL-100). Groups render in option order with
 * subheaders; context-dependent groups carry a hint line saying where
 * their tokens resolve. Search filters across label, group, and preview.
 */
export function InsertTokenMenu(props: InsertTokenMenuProps) {
  const { anchorEl, open, onClose, options, onInsert } = props
  // Hosts can have hundreds of variables (AGL-186) — filter as you type.
  const [search, setSearch] = useState('')

  const handleClose = useCallback(() => {
    setSearch('')
    onClose()
  }, [onClose])

  const visibleOptions = useMemo(() => {
    const term = search.trim().toLowerCase()
    if (!term) return options
    return options.filter((option) =>
      [option.label, option.group, option.preview]
        .filter(Boolean)
        .some((text) => String(text).toLowerCase().includes(term)),
    )
  }, [options, search])

  return (
    <Menu
      anchorEl={anchorEl}
      open={open}
      onClose={handleClose}
      // Focus goes back to the edited input (with the caret placed after
      // the inserted token), never to the adornment button.
      disableRestoreFocus
    >
      <Box sx={{ px: 1.5, pb: 1 }}>
        <TextField
          size="small"
          placeholder="Search data…"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          onKeyDown={(event) => event.stopPropagation()}
          autoFocus
          fullWidth
        />
      </Box>
      {visibleOptions.length === 0 ? (
        <MenuItem disabled>{'No data matches'}</MenuItem>
      ) : null}
      {visibleOptions.map((option, index) => {
        const previous = visibleOptions[index - 1]
        const newGroup = option.group && option.group !== previous?.group
        return [
          newGroup ? (
            <ListSubheader
              key={`${option.group}-header`}
              sx={{ lineHeight: option.groupHint ? 1.6 : undefined, py: option.groupHint ? 0.75 : undefined }}
            >
              {option.group}
              {/* Context hint (AGL-583): where these tokens resolve. */}
              {option.groupHint ? (
                <Typography
                  variant="caption"
                  color="text.secondary"
                  component="div"
                >
                  {option.groupHint}
                </Typography>
              ) : null}
            </ListSubheader>
          ) : null,
          <MenuItem
            key={`${option.group ?? ''}-${option.token}-${index}`}
            onClick={() => {
              setSearch('')
              onInsert(option.token)
            }}
          >
            <Stack sx={{ minWidth: 0 }}>
              <Typography variant="body2" noWrap>
                {option.label}
              </Typography>
              {/* Live value preview (AGL-262) / token description. */}
              {option.preview ? (
                <Typography variant="caption" color="text.secondary" noWrap>
                  {option.preview}
                </Typography>
              ) : null}
            </Stack>
          </MenuItem>,
        ]
      })}
    </Menu>
  )
}
InsertTokenMenu.displayName = 'InsertTokenMenu'

export default InsertTokenMenu
