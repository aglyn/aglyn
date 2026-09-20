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

import { mdiPlus } from '@aglyn/shared-data-mdi'
import {
  IconButton,
  InputAdornment,
  ListItemText,
  Menu,
  MenuItem,
  TextField,
  type TextFieldProps,
  Tooltip,
  Typography,
} from '@mui/material'
import { useCallback, useMemo, useRef, useState } from 'react'
import { MdiIcon } from './mdi-icon/mdi-icon'

/**
 * A text field whose value may name VARIABLES, with the two ways of reaching
 * them that the besigner's attribute fields already taught (AGL-3197).
 *
 * ## What it is, and what it deliberately is not
 *
 * It is a plain MUI `TextField`. The value in it is the value that is stored —
 * `{{site.name}}` reads as `{{site.name}}`, and what makes that legible is the
 * PREVIEW under the field, not a pill drawn over the text.
 *
 * The besigner's `TokenTextField` does draw pills, and this is not that on
 * purpose. That field is a contentEditable surface with its own selection
 * model, DOM/model sync contract, paste handling and undo trade-offs, wired to
 * react-final-form and to the canvas's binding and media pickers. It earns all
 * of that because a node attribute can hold a token referring to any record on
 * the page. Here there are three variables, the field is 60 characters long,
 * and the honest cost of a pill surface — an editor that fights the IME, an
 * undo stack that truncates, a value the author cannot select and retype — is
 * not worth paying for a title. A plain input, a menu and a live preview are.
 *
 * ## Two ways in, because people reach for different ones
 *
 * The `+` opens the list with a description under each name; typing `{{`
 * offers the same list inline, filtered by whatever follows. Either way the
 * insert lands at the caret, and the caret is left after it — not at the end
 * of the value, which is where an insert that rebuilt the string would leave
 * it, and which is wrong whenever somebody is editing the middle of a title.
 */

export interface VariableOption {
  /** Written between the braces. */
  name: string
  /** What the menu calls it. */
  label: string
  /** One line under the label. */
  description?: string
}

export interface VariableTextFieldProps
  extends Omit<TextFieldProps, 'onChange' | 'value'> {
  value: string
  onChange: (value: string) => void
  /** Every variable this field offers. */
  variables: readonly VariableOption[]
  /** The tooltip on the insert control. */
  insertLabel?: string
}

/** `{{` plus the partial name after it, at the very end of what was typed. */
const OPEN_TOKEN = /\{\{([a-zA-Z][\w.]*)?$/

export function VariableTextField(props: VariableTextFieldProps) {
  const {
    value,
    onChange,
    variables,
    insertLabel = 'Insert a variable',
    slotProps,
    ...rest
  } = props

  const inputRef = useRef<HTMLInputElement | null>(null)
  /**
   * The two ways the list opens, held APART.
   *
   * They insert differently — the `+` adds a variable at the caret, while
   * autocomplete REPLACES the `{{` and the partial name under it — and one
   * state for both got that wrong in the direction that is easy to miss: a
   * `+` insert also ate the two characters after the caret, which on a title
   * being edited in the middle silently deleted whatever was there.
   *
   * Both carry the caret as it was when the list opened, because opening a
   * menu moves focus off the input and a caret read afterwards is 0.
   */
  const [picker, setPicker] = useState<{ anchor: HTMLElement; at: number } | null>(null)
  const [typing, setTyping] = useState<{ at: number; partial: string } | null>(null)

  const matches = useMemo(() => {
    const partial = typing?.partial?.toLowerCase() ?? ''
    if (!partial) return variables
    return variables.filter(
      (variable) =>
        variable.name.toLowerCase().includes(partial) ||
        variable.label.toLowerCase().includes(partial),
    )
  }, [typing, variables])

  /** Where the caret is, or the end of the value when there is no input yet. */
  const caret = useCallback(
    () => inputRef.current?.selectionStart ?? value.length,
    [value.length],
  )

  const insertAt = useCallback(
    (name: string, from: number, to: number) => {
      const token = `{{${name}}}`
      onChange(`${value.slice(0, from)}${token}${value.slice(to)}`)
      // After the paint that renders the new value, or the browser puts the
      // caret back where the old value ended.
      requestAnimationFrame(() => {
        const input = inputRef.current
        if (!input) return
        input.focus()
        input.setSelectionRange(from + token.length, from + token.length)
      })
    },
    [onChange, value],
  )

  const handleChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const next = event.target.value
      onChange(next)
      // `{{` at the caret opens the list; anything else closes it. Read from
      // the text BEFORE the caret only, so typing `{{` in the middle of a
      // title offers the list for that position rather than for the end.
      const before = next.slice(0, event.target.selectionStart ?? next.length)
      const open = OPEN_TOKEN.exec(before)
      setTyping(
        open
          ? { at: before.length - open[0].length, partial: open[1] ?? '' }
          : null,
      )
    },
    [onChange],
  )

  return (
    <>
      <TextField
        {...rest}
        value={value}
        onChange={handleChange}
        onBlur={(event) => {
          setTyping(null)
          rest.onBlur?.(event)
        }}
        /*
         * `inputRef`, not `slotProps.htmlInput.ref`. The slot's `ref` reaches
         * the native input only on some of MUI's input variants, and a null
         * ref here does not fail loudly — it silently makes `caret()` return
         * the END of the value, so every insert lands after the title instead
         * of where the author was typing. This is the prop `InputBase` forks
         * into the input on every variant.
         */
        inputRef={inputRef}
        slotProps={{
          ...slotProps,
          input: {
            ...(slotProps?.input as object),
            endAdornment: (
              <InputAdornment position="end">
                <Tooltip title={insertLabel}>
                  <IconButton
                    size="small"
                    aria-label={insertLabel}
                    onClick={(event) => {
                      // The caret is read HERE, while the input still has it.
                      setTyping(null)
                      setPicker({ anchor: event.currentTarget, at: caret() })
                    }}
                  >
                    <MdiIcon fontSize="small" path={mdiPlus.path} />
                  </IconButton>
                </Tooltip>
              </InputAdornment>
            ),
          },
        }}
      />
      <Menu
        open={Boolean(picker) || (Boolean(typing) && matches.length > 0)}
        anchorEl={picker?.anchor ?? inputRef.current}
        onClose={() => {
          setPicker(null)
          setTyping(null)
        }}
        // The menu must not steal the caret while somebody is mid-word: an
        // autocomplete that focused itself would end the typing run it exists
        // to complete.
        disableAutoFocus={!picker}
        disableEnforceFocus={!picker}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
      >
        {matches.map((variable) => (
          <MenuItem
            key={variable.name}
            onClick={() => {
              if (typing) {
                // Autocomplete REPLACES the `{{` and the partial under it.
                const to = Math.min(typing.at + 2 + typing.partial.length, value.length)
                insertAt(variable.name, typing.at, to)
              } else {
                // The `+` INSERTS, replacing nothing.
                const at = picker?.at ?? caret()
                insertAt(variable.name, at, at)
              }
              setPicker(null)
              setTyping(null)
            }}
          >
            <ListItemText
              primary={variable.label}
              secondary={
                <Typography variant="caption" color="text.secondary" component="span">
                  {`{{${variable.name}}}${
                    variable.description ? ` — ${variable.description}` : ''
                  }`}
                </Typography>
              }
            />
          </MenuItem>
        ))}
      </Menu>
    </>
  )
}
VariableTextField.displayName = 'VariableTextField'

export default VariableTextField
