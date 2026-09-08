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
  CRM_EMAIL_TEMPLATE_NAME_MAX,
  CRM_MERGE_FIELDS,
  type CrmEmailTemplateRow,
  type CrmEmailTemplateVisibility,
  type CrmMergeFieldDefinition,
  type CrmMergeFieldGroup,
  crmMergeFieldToken,
} from '@aglyn/aglyn'
import {
  Autocomplete,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  FormHelperText,
  ListSubheader,
  Menu,
  MenuItem,
  Radio,
  RadioGroup,
  TextField,
} from '@mui/material'
import { type MouseEvent, useEffect, useMemo, useState } from 'react'

/**
 * The pieces the send dialog grows for templates (AGL-2658), each on its
 * own so the dialog's file — which several hands edit — takes three
 * elements and a handful of lines rather than a second component's worth.
 */

export interface CrmTemplatePickerProps {
  /** Every listed template of kind `template`, shared and personal alike. */
  templates: readonly CrmEmailTemplateRow[]
  /** The one applied to the draft, or `null`. */
  value: CrmEmailTemplateRow | null
  onChange: (template: CrmEmailTemplateRow | null) => void
  disabled?: boolean
}

/** How the picker heads each group; shared first, because it is the team's. */
const visibilityGroup = (template: CrmEmailTemplateRow): string =>
  template.visibility === 'personal' ? 'Mine' : 'Shared'

/**
 * "Template" — the letter to start from, grouped into the team's and the
 * reader's own. An Autocomplete rather than a select because a workspace
 * that keeps forty letters finds one by typing its name. Options are
 * ordered shared-then-personal so the groups render contiguous, which is
 * what the control's grouping needs.
 */
export function CrmTemplatePicker(props: CrmTemplatePickerProps) {
  const { templates, value, onChange, disabled } = props
  const options = useMemo(
    () =>
      [...templates].sort((a, b) =>
        a.visibility === b.visibility
          ? a.name.localeCompare(b.name)
          : a.visibility === 'personal'
            ? 1
            : -1,
      ),
    [templates],
  )
  return (
    <Autocomplete
      size="small"
      options={options}
      groupBy={visibilityGroup}
      getOptionLabel={(option) => option.name}
      isOptionEqualToValue={(option, selected) => option.$id === selected.$id}
      value={value}
      onChange={(_event, next) => onChange(next)}
      disabled={disabled}
      noOptionsText="No templates match"
      renderInput={(params) => (
        <TextField
          {...params}
          label="Template"
          helperText="Fills in the subject and the message. Merge fields such as {{contact.firstName}} are filled from this record when the email is sent."
        />
      )}
    />
  )
}
CrmTemplatePicker.displayName = 'CrmTemplatePicker'

export interface CrmInsertMenuProps {
  /** Every listed template of kind `snippet`. */
  snippets: readonly CrmEmailTemplateRow[]
  /** Which merge-field groups apply to the record being written to. */
  groups: readonly CrmMergeFieldGroup[]
  disabled?: boolean
  /** Receives the text to put at the caret. */
  onInsert: (text: string) => void
}

/**
 * "Insert" — a snippet, or a merge field, at the caret.
 *
 * One menu for both because they are one gesture: put something into the
 * message where I am. The snippets come first, under their own heading,
 * and the fields follow grouped by what they read — only the groups that
 * apply, so a letter to a contact is not offered `{{lead.name}}`. With no
 * snippets the menu is the fields alone, which is what keeps the dialog
 * useful before anyone has saved a snippet.
 */
export function CrmInsertMenu(props: CrmInsertMenuProps) {
  const { snippets, groups, disabled, onInsert } = props
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  const fields = useMemo(() => {
    const byGroup = new Map<CrmMergeFieldGroup, CrmMergeFieldDefinition[]>()
    for (const field of CRM_MERGE_FIELDS) {
      if (!groups.includes(field.group)) continue
      byGroup.set(field.group, [...(byGroup.get(field.group) ?? []), field])
    }
    return [...byGroup.entries()]
  }, [groups])
  const pick = (text: string) => {
    setAnchor(null)
    onInsert(text)
  }
  return (
    <>
      <Button
        size="small"
        disabled={disabled}
        onClick={(event: MouseEvent<HTMLElement>) => setAnchor(event.currentTarget)}
        aria-haspopup="menu"
      >
        {'Insert'}
      </Button>
      <Menu open={Boolean(anchor)} anchorEl={anchor} onClose={() => setAnchor(null)}>
        {snippets.length ? <ListSubheader disableSticky>{'Snippets'}</ListSubheader> : null}
        {snippets.map((snippet) => (
          <MenuItem key={snippet.$id} onClick={() => pick(snippet.body)}>
            {snippet.name}
          </MenuItem>
        ))}
        {fields.flatMap(([group, entries]) => [
          <ListSubheader key={`group-${group}`} disableSticky>
            {`${group} fields`}
          </ListSubheader>,
          ...entries.map((field) => (
            <MenuItem key={field.key} onClick={() => pick(crmMergeFieldToken(field.key))}>
              {field.label}
            </MenuItem>
          )),
        ])}
      </Menu>
    </>
  )
}
CrmInsertMenu.displayName = 'CrmInsertMenu'

export interface CrmSaveAsTemplateDialogProps {
  open: boolean
  onClose: () => void
  /** Writes the template; closing on success is the caller's job. */
  onSave: (draft: {
    name: string
    visibility: CrmEmailTemplateVisibility
  }) => Promise<void>
}

/**
 * "Save as template" — a name and whose it is, over the draft as written.
 *
 * The subject and the body are the dialog's own and are not shown again
 * here; this asks only what the draft does not carry. Personal is the
 * default, because a letter one rep wrote is theirs until they hand it to
 * the team, and handing it over is one click.
 */
export function CrmSaveAsTemplateDialog(props: CrmSaveAsTemplateDialogProps) {
  const { open, onClose, onSave } = props
  const [name, setName] = useState('')
  const [visibility, setVisibility] = useState<CrmEmailTemplateVisibility>('personal')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    if (!open) return
    setName('')
    setVisibility('personal')
    setBusy(false)
    setError(null)
  }, [open])
  const canSave = name.trim().length > 0 && !busy
  const handleSave = async () => {
    if (!canSave) return
    setBusy(true)
    setError(null)
    try {
      await onSave({ name: name.trim().slice(0, CRM_EMAIL_TEMPLATE_NAME_MAX), visibility })
    } catch (cause) {
      console.error(cause)
      setError('The template could not be saved. Try again.')
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog open={open} onClose={busy ? undefined : onClose} maxWidth="xs" fullWidth>
      <DialogTitle>{'Save as template'}</DialogTitle>
      <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <TextField
          size="small"
          label="Template name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          autoFocus
          sx={{ mt: 1 }}
          slotProps={{ htmlInput: { maxLength: CRM_EMAIL_TEMPLATE_NAME_MAX } }}
        />
        <RadioGroup
          value={visibility}
          onChange={(event) => setVisibility(event.target.value as CrmEmailTemplateVisibility)}
        >
          <FormControlLabel
            value="personal"
            control={<Radio size="small" />}
            label="Personal — listed for you alone"
          />
          <FormControlLabel
            value="shared"
            control={<Radio size="small" />}
            label="Shared — every CRM editor can use and edit it"
          />
        </RadioGroup>
        {error ? <FormHelperText error>{error}</FormHelperText> : null}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>
          {'Cancel'}
        </Button>
        <Button variant="contained" color="primary" disabled={!canSave} onClick={handleSave}>
          {busy ? 'Saving…' : 'Save template'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
CrmSaveAsTemplateDialog.displayName = 'CrmSaveAsTemplateDialog'
