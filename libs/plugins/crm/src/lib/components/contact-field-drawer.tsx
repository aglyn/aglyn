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
  CONTACT_FIELD_TYPE_LABELS,
  CONTACT_FIELD_TYPES,
  type ContactFieldType,
  isContactFieldType,
  normalizeContactFieldKey,
} from '@aglyn/aglyn'
import {
  Button,
  Drawer,
  FormControlLabel,
  MenuItem,
  Stack,
  Switch,
  TextField,
  Typography,
} from '@mui/material'
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ContactFieldDefinitionDoc } from '../hooks/use-contact-field-definitions'

/** What the drawer hands back — the definition's editable half. */
export interface ContactFieldDraft {
  label: string
  key: string
  type: ContactFieldType
  /** The choices, for `select`; empty for every other type. */
  options: string[]
  required: boolean
}

export interface ContactFieldDrawerProps {
  open: boolean
  onClose: () => void
  /** The definition being edited, or `null` to create one. */
  definition: ContactFieldDefinitionDoc | null
  /**
   * Every key the org has already used, retired ones included. A key is
   * the map key values are stored under, so a retired field's key is still
   * taken: a new field reusing it would read the old values back as its own.
   */
  takenKeys: readonly string[]
  /** Receives the draft; closing on success is the caller's job. */
  onSubmit: (draft: ContactFieldDraft) => Promise<void> | void
}

/** How many choices a select may declare, and how long each may be. */
const OPTIONS_MAX = 50
const OPTION_MAX_LENGTH = 120
const LABEL_MAX_LENGTH = 80

/** One choice per line, trimmed, blanks dropped, duplicates collapsed. */
function parseOptions(text: string): string[] {
  const seen = new Set<string>()
  const options: string[] = []
  for (const line of text.split('\n')) {
    const option = line.trim().slice(0, OPTION_MAX_LENGTH)
    if (!option || seen.has(option)) continue
    seen.add(option)
    options.push(option)
    if (options.length >= OPTIONS_MAX) break
  }
  return options
}

/**
 * The one form a custom contact field is created and edited through
 * (AGL-2601).
 *
 * ## The key follows the label until the author takes it over
 *
 * A merchant types "Annual revenue" and should not have to know that the
 * value is stored under `annual_revenue`. So the key is derived from the
 * label as they type — `normalizeContactFieldKey` — and shown beside it, and
 * only becomes the author's own the moment they edit it. That is the whole
 * of the grammar they are asked to learn, and the field is still there for
 * the author who wants `arr` instead.
 *
 * ## Two things do not change after creation
 *
 * The KEY is the map key every value is stored under, so changing it would
 * orphan every value already written; the TYPE is what every reader coerces
 * those values by, so changing it would make them unreadable. Both are
 * disabled on an existing field and say why. A rename is a new field and a
 * retire, which the section's list offers.
 */
export function ContactFieldDrawer(props: ContactFieldDrawerProps) {
  const { open, onClose, definition, takenKeys, onSubmit } = props
  const editing = Boolean(definition)

  const [label, setLabel] = useState('')
  const [key, setKey] = useState('')
  const [keyTouched, setKeyTouched] = useState(false)
  const [type, setType] = useState<ContactFieldType>('text')
  const [optionsText, setOptionsText] = useState('')
  const [required, setRequired] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Seeded on every open, from the definition when there is one: a drawer
  // that kept the previous field's draft would offer it as the next one.
  useEffect(() => {
    if (!open) return
    setLabel(definition?.label ?? '')
    setKey(definition?.key ?? '')
    setKeyTouched(Boolean(definition))
    setType(definition?.type ?? 'text')
    setOptionsText((definition?.options ?? []).join('\n'))
    setRequired(definition?.required === true)
    setBusy(false)
    setError(null)
  }, [open, definition])

  const derivedKey = useMemo(
    () => (keyTouched ? normalizeContactFieldKey(key) : normalizeContactFieldKey(label)),
    [keyTouched, key, label],
  )
  const shownKey = keyTouched ? key : (derivedKey ?? '')
  const keyTaken =
    !editing && derivedKey != null && takenKeys.includes(derivedKey)
  const options = useMemo(() => parseOptions(optionsText), [optionsText])

  const keyHelp = editing
    ? 'Values are stored under this key, so it cannot change once the field exists.'
    : keyTaken
      ? 'That key is already in use — a retired field keeps its key.'
      : shownKey && !derivedKey
        ? 'A key starts with a letter and uses letters, digits and underscores.'
        : 'Derived from the label; edit it to choose your own.'

  const canSubmit =
    !busy &&
    label.trim().length > 0 &&
    derivedKey != null &&
    !keyTaken &&
    (type !== 'select' || options.length > 0)

  const handleSubmit = useCallback(async () => {
    if (!canSubmit || derivedKey == null) return
    setBusy(true)
    setError(null)
    try {
      await onSubmit({
        label: label.trim().slice(0, LABEL_MAX_LENGTH),
        key: derivedKey,
        type,
        options: type === 'select' ? options : [],
        required,
      })
    } catch (caught) {
      console.error(caught)
      setError('Could not save the field. Try again.')
    } finally {
      setBusy(false)
    }
  }, [canSubmit, derivedKey, onSubmit, label, type, options, required])

  return (
    <Drawer anchor="right" open={open} onClose={onClose}>
      <Stack spacing={2} sx={{ width: 360, p: 3 }}>
        <Typography variant="h6">
          {editing ? 'Edit field' : 'New field'}
        </Typography>
        <TextField
          size="small"
          label="Label"
          value={label}
          onChange={(event) => setLabel(event.target.value)}
          slotProps={{ htmlInput: { maxLength: LABEL_MAX_LENGTH } }}
          autoFocus={!editing}
          fullWidth
        />
        <TextField
          size="small"
          label="Key"
          value={shownKey}
          onChange={(event) => {
            setKeyTouched(true)
            setKey(event.target.value)
          }}
          disabled={editing}
          error={!editing && (keyTaken || (shownKey.length > 0 && !derivedKey))}
          helperText={keyHelp}
          slotProps={{ htmlInput: { maxLength: 40, spellCheck: false } }}
          fullWidth
        />
        <TextField
          select
          size="small"
          label="Type"
          value={type}
          onChange={(event) => {
            const next = event.target.value
            if (isContactFieldType(next)) setType(next)
          }}
          disabled={editing}
          helperText={
            editing
              ? 'Values are read by type, so it is fixed once the field exists.'
              : undefined
          }
          fullWidth
        >
          {CONTACT_FIELD_TYPES.map((option) => (
            <MenuItem key={option} value={option}>
              {CONTACT_FIELD_TYPE_LABELS[option]}
            </MenuItem>
          ))}
        </TextField>
        {type === 'select' ? (
          <TextField
            size="small"
            label="Choices"
            value={optionsText}
            onChange={(event) => setOptionsText(event.target.value)}
            helperText="One per line. A stored value has to be one of these."
            multiline
            minRows={3}
            fullWidth
          />
        ) : null}
        <FormControlLabel
          control={
            <Switch
              checked={required}
              onChange={(event) => setRequired(event.target.checked)}
            />
          }
          label="Required on the contact form"
        />
        {error ? (
          <Typography variant="body2" color="error">
            {error}
          </Typography>
        ) : null}
        <Stack direction="row" spacing={1}>
          <Button
            variant="contained"
            color="primary"
            disabled={!canSubmit}
            onClick={handleSubmit}
          >
            {editing ? 'Save' : 'Create field'}
          </Button>
          <Button onClick={onClose} disabled={busy}>
            {'Cancel'}
          </Button>
        </Stack>
      </Stack>
    </Drawer>
  )
}
ContactFieldDrawer.displayName = 'ContactFieldDrawer'

export default ContactFieldDrawer
