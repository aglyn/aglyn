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
  customFieldCurrency,
  type ContactFieldType,
  type CrmFieldObject,
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
import { useSeedEdits } from '@aglyn/tenant-feature-instance/hooks/use-seed-edits'
import type { ContactFieldDefinitionDoc } from '../hooks/use-contact-field-definitions'
import { CRM_FIELD_LABEL_MAX_LENGTH, crmFieldOptions } from '../model/crm-setup-content'
import { DEAL_CURRENCIES } from '../model/deal-board-model'

/** What the drawer hands back — the definition's editable half. */
export interface ContactFieldDraft {
  label: string
  key: string
  type: ContactFieldType
  /** The choices, for `select`; empty for every other type. */
  options: string[]
  /** For `currency` (AGL-3756): the lowercase ISO 4217 code; `null` for every other type. */
  currency: string | null
  required: boolean
}

export interface ContactFieldDrawerProps {
  open: boolean
  onClose: () => void
  /**
   * The definition being edited, as the list has it NOW, or `null` to create
   * one. What is typed is kept as edits over it (AGL-4047), so the server's
   * copy arriving after the drawer opened replaces the cache's under every
   * field nobody touched.
   */
  definition: ContactFieldDefinitionDoc | null
  /**
   * The definition is not confirmed by the server yet: Save is held, with
   * this sentence beside it, until it is (AGL-4047).
   */
  checkingText?: string
  /**
   * Every key the org has already used, retired ones included. A key is
   * the map key values are stored under, so a retired field's key is still
   * taken: a new field reusing it would read the old values back as its own.
   */
  takenKeys: readonly string[]
  /** Receives the draft; closing on success is the caller's job. */
  onSubmit: (draft: ContactFieldDraft) => Promise<void> | void
  /**
   * The record the field describes (AGL-2661) — the Fields section's
   * current tab. Contacts when unsaid. The drawer's copy follows it, and it
   * is the one thing here a form-field mapping cares about: a website form
   * saves into a CONTACT field only, because a submission is a fact about
   * a person, so the other objects' drawers say so instead of offering it.
   */
  object?: CrmFieldObject
}

/** How the object reads in the drawer's own sentences — singular, lowercase. */
const OBJECT_NOUN: Record<CrmFieldObject, string> = {
  contact: 'contact',
  company: 'company',
  deal: 'deal',
  lead: 'lead',
}

/**
 * Which objects a CSV import can fill a custom field on — see
 * `CUSTOM_FIELD_OBJECT` in `record-facts.ts`, which decides what the
 * mapping menu offers. The deal and lead files carry the standard columns
 * only, so their drawers must not promise an import that would silently
 * drop the column.
 */
const IMPORTABLE: Record<CrmFieldObject, boolean> = {
  contact: true,
  company: true,
  deal: false,
  lead: false,
}

/**
 * What the drawer says about website forms, per object — see
 * {@link ContactFieldDrawerProps.object}.
 */
export function fieldDrawerMappingNote(object: CrmFieldObject): string {
  if (object === 'contact') {
    return 'A website form field can save its answer into this field.'
  }
  const filled = IMPORTABLE[object]
    ? 'is filled on the record, by CSV import or over the API.'
    : 'is filled on the record or over the API.'
  return (
    `A website form field saves into contact fields only; a ${OBJECT_NOUN[object]} ` +
    `field ${filled}`
  )
}

/** How long a label may be: the one bound an AI build's field is held to too (AGL-3746). */
const LABEL_MAX_LENGTH = CRM_FIELD_LABEL_MAX_LENGTH

/** One choice per line, trimmed, blanks dropped, duplicates collapsed, under the shared bounds. */
function parseOptions(text: string): string[] {
  return crmFieldOptions(text.split('\n'))
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
  const { open, onClose, definition, takenKeys, onSubmit, object = 'contact', checkingText } = props
  const editing = Boolean(definition)
  const noun = OBJECT_NOUN[object]

  const seed = useMemo(
    () => ({
      label: definition?.label ?? '',
      key: definition?.key ?? '',
      type: (definition?.type ?? 'text') as ContactFieldType,
      optionsText: (definition?.options ?? []).join('\n'),
      currency: customFieldCurrency(definition),
      required: definition?.required === true,
    }),
    [definition],
  )
  const form = useSeedEdits(seed)
  const { label, key, type, optionsText, currency, required } = form.values
  const { edit, discard } = form
  const setLabel = (value: string) => edit({ label: value })
  const setKey = (value: string) => edit({ key: value })
  const setType = (value: ContactFieldType) => edit({ type: value })
  const setOptionsText = (value: string) => edit({ optionsText: value })
  const setCurrency = (value: string) => edit({ currency: value })
  const setRequired = (value: boolean) => edit({ required: value })
  const [keyTouched, setKeyTouched] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Fresh on every open, from the definition when there is one: a drawer
  // that kept the previous field's edits would offer them as the next one.
  // Keyed on WHICH definition, not its copy, so the server's answer for the
  // same field keeps what was typed (AGL-4047).
  const definitionId = definition?.$id ?? null
  useEffect(() => {
    if (!open) return
    discard()
    setKeyTouched(definitionId !== null)
    setBusy(false)
    setError(null)
  }, [open, definitionId, discard])

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
        currency: type === 'currency' ? currency : null,
        required,
      })
    } catch (caught) {
      console.error(caught)
      setError('Could not save the field. Try again.')
    } finally {
      setBusy(false)
    }
  }, [canSubmit, derivedKey, onSubmit, label, type, options, currency, required])

  return (
    <Drawer anchor="right" open={open} onClose={onClose}>
      <Stack spacing={2} sx={{ width: 360, maxWidth: '100vw', p: 3 }}>
        <Typography variant="h6">
          {editing ? `Edit ${noun} field` : `New ${noun} field`}
        </Typography>
        <Typography variant="body2" color="text.secondary">
          {fieldDrawerMappingNote(object)}
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
        {type === 'currency' ? (
          <TextField
            select
            size="small"
            label="Currency"
            value={currency}
            onChange={(event) => setCurrency(event.target.value)}
            disabled={editing}
            helperText={
              editing
                ? 'Amounts are stored in this currency, so it is fixed once the field exists.'
                : 'Every amount in this field is in this currency.'
            }
            fullWidth
          >
            {[...new Set<string>([...DEAL_CURRENCIES, currency])].map((code) => (
              <MenuItem key={code} value={code}>
                {code.toUpperCase()}
              </MenuItem>
            ))}
          </TextField>
        ) : null}
        <FormControlLabel
          control={
            <Switch
              checked={required}
              onChange={(event) => setRequired(event.target.checked)}
            />
          }
          label={`Required on the ${noun} form`}
        />
        {error ? (
          <Typography variant="body2" color="error">
            {error}
          </Typography>
        ) : null}
        {checkingText ? (
          <Typography variant="body2" color="text.secondary" role="status">
            {checkingText}
          </Typography>
        ) : null}
        <Stack direction="row" spacing={1}>
          <Button
            variant="contained"
            color="primary"
            disabled={!canSubmit || Boolean(checkingText)}
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
