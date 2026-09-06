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
  type FormFieldDecl,
  pluginDocsHelp,
  withContactFieldMapping,
} from '@aglyn/aglyn'
import { useContactFieldDefinitions } from '@aglyn/plugins-crm/hooks/use-contact-field-definitions'
import { CardDisplay } from '@aglyn/shared-ui-jsx'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import { Timestamp } from '@aglyn/shared-util-timestamp'
import { useFirestore, useOrgDataScope } from '@aglyn/tenant-feature-instance'
import { Button, MenuItem, Stack, TextField, Typography } from '@mui/material'
import { doc, updateDoc } from 'firebase/firestore'
import { useCallback, useMemo, useState } from 'react'

export interface FormContactFieldsCardProps {
  hostId: string
  formId: string
  /** The PUBLISHED declaration, as stored on the form document. */
  fields: readonly FormFieldDecl[]
  /** True while the form document is still being read. */
  loading?: boolean
}

/** The choice that saves nowhere — a `MenuItem` value has to be a string. */
const NONE = ''

/**
 * Where each of a form's fields saves on the contact (AGL-2601).
 *
 * The declaration a submission is judged against comes off the DESIGN at
 * publish — names, types, options — and knows nothing about where a field
 * saves to, because that is a fact about the contact, not the canvas. So it
 * is edited here, on the form's own page beside routing and the consent
 * field, and written onto the stored declaration as `contactFieldKey`;
 * `carryContactFieldMappings` keeps it across the next publish by field
 * name. The destinations are the org's custom field definitions, read
 * through the same hook every other surface uses, so a field retired under
 * CRM → Fields leaves this list at the same moment it leaves the columns.
 *
 * Only the org's OWN fields are offered. The sender's name and email are
 * recognized from the field name at submission (`name`, `email`) and need no
 * mapping; a control that offered them here would promise a second way to
 * say the same thing, and the built-in `role` on a declaration is read by
 * nothing at the door today — a choice that writes it would be a choice
 * that does nothing.
 *
 * Save writes the whole `fields` array back — it is one array on the form
 * document, and Firestore has no per-element update — with the picked keys
 * applied through `withContactFieldMapping`, which deletes an unmapped key
 * rather than leaving an `undefined` the array write would refuse.
 */
export function FormContactFieldsCard(props: FormContactFieldsCardProps) {
  const { hostId, formId, fields, loading } = props
  const firestore = useFirestore()
  const { enqueueSnackbar } = useSnackbar()
  const { scope, ready: scopeReady } = useOrgDataScope({ hostId })
  const { active, definitions, ready } = useContactFieldDefinitions(scope?.[1] ?? null)

  /**
   * The destinations picked on screen, by field name — only the fields the
   * reader touched. Everything else reads from the stored declaration, so a
   * write from elsewhere (a publish, another tab) shows through untouched.
   */
  const [draft, setDraft] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)

  const storedKey = useCallback((decl: FormFieldDecl) => decl.contactFieldKey ?? NONE, [])
  const shownKey = useCallback(
    (decl: FormFieldDecl) => (decl.fieldName in draft ? draft[decl.fieldName] : storedKey(decl)),
    [draft, storedKey],
  )
  const changed = useMemo(
    () =>
      fields.filter(
        (decl) => decl.fieldName in draft && draft[decl.fieldName] !== storedKey(decl),
      ),
    [fields, draft, storedKey],
  )

  /** Active definitions by key, for the hint under a mapped field. */
  const activeByKey = useMemo(
    () => new Map(active.map((definition) => [definition.key, definition])),
    [active],
  )

  const handleSave = useCallback(async () => {
    if (!changed.length || saving) return
    setSaving(true)
    try {
      const next = changed.reduce<FormFieldDecl[]>(
        (decls, decl) =>
          withContactFieldMapping(decls, decl.fieldName, draft[decl.fieldName] || null),
        [...fields],
      )
      await updateDoc(doc(firestore, 'hosts', hostId, 'forms', formId), {
        fields: next,
        updatedAt: Timestamp.now(),
      })
      setDraft({})
      enqueueSnackbar('Form saved', { variant: 'success', persist: false })
    } catch (error) {
      console.error(error)
      enqueueSnackbar('An error has occurred', { variant: 'error', allowDuplicate: true })
    } finally {
      setSaving(false)
    }
  }, [changed, saving, fields, draft, firestore, hostId, formId, enqueueSnackbar])

  /**
   * What the picked destination does with an answer — the type's rule, in a
   * sentence, so the author learns it here rather than from a value that
   * never arrived.
   */
  const hint = (key: string): string | undefined => {
    if (key === NONE) return undefined
    const definition = activeByKey.get(key)
    if (!definition) {
      return definitions.some((entry) => entry.key === key)
        ? 'This field is retired, so the answer is no longer saved. Pick another or clear it.'
        : 'This field no longer exists, so the answer is not saved. Pick another or clear it.'
    }
    switch (definition.type) {
      case 'number':
        return 'Stored as a number; an answer that is not one number is dropped.'
      case 'date':
        return 'Stored as a date, whichever way the visitor types it.'
      case 'checkbox':
        return 'Stored as yes or no, from a ticked or unticked box.'
      case 'select':
        return `Stored only when the answer is one of: ${(definition.options ?? []).join(', ')}.`
      case 'url':
        return 'Stored when the answer is an http(s) link.'
      default:
        return 'Stored as text.'
    }
  }

  /**
   * A stored key no active definition answers to — retired, or deleted —
   * still has to be an option, or the control could not show what the
   * declaration says and the author could not clear it.
   */
  const orphanOption = (key: string) => {
    if (key === NONE || activeByKey.has(key)) return null
    const retired = definitions.some((entry) => entry.key === key)
    return (
      <MenuItem key={key} value={key}>
        {`${key} — ${retired ? 'retired field' : 'no such field'}`}
      </MenuItem>
    )
  }

  const settled = scopeReady && !loading && (!scope || ready)
  const anyMapped = fields.some((decl) => decl.contactFieldKey)

  return (
    <CardDisplay
      header="Saves to contact fields"
      help={pluginDocsHelp('contactFields', { anchor: '#save-a-form-field' })}
      contentGutterX
      contentGutterY
    >
      <Stack spacing={2}>
        {!settled ? null : !scope ? (
          <Typography variant="body2" color="text.secondary">
            {'This site has no organization, so it has no contact fields to save into.'}
          </Typography>
        ) : fields.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            {'Publish a version to declare this form’s fields; then choose where each one saves.'}
          </Typography>
        ) : active.length === 0 && !anyMapped ? (
          <Typography variant="body2" color="text.secondary">
            {'No custom contact fields are defined yet. Define them under CRM → Fields and ' +
              'each form field can save into one.'}
          </Typography>
        ) : (
          <>
            <Typography variant="body2" color="text.secondary">
              {'Each answer is stored on the contact the submission creates or updates, ' +
                'converted by the field’s type. A blank answer writes nothing.'}
            </Typography>
            {fields.map((decl) => {
              const key = shownKey(decl)
              return (
                <TextField
                  key={decl.fieldName}
                  select
                  size="small"
                  label={decl.label ? `${decl.label} (${decl.fieldName})` : decl.fieldName}
                  value={key}
                  onChange={(event) =>
                    setDraft((current) => ({ ...current, [decl.fieldName]: event.target.value }))
                  }
                  helperText={hint(key)}
                  // `displayEmpty`, or the "saves nowhere" choice renders as
                  // a blank control and reads as a field left unset; the label
                  // shrinks with it so the two do not overlap.
                  slotProps={{
                    select: { displayEmpty: true },
                    inputLabel: { shrink: true },
                  }}
                  fullWidth
                >
                  <MenuItem value={NONE}>{'Not saved to a contact field'}</MenuItem>
                  {orphanOption(key)}
                  {active.map((definition) => (
                    <MenuItem key={definition.key} value={definition.key}>
                      {`${definition.label} · ${CONTACT_FIELD_TYPE_LABELS[definition.type]}`}
                    </MenuItem>
                  ))}
                </TextField>
              )
            })}
            <Typography variant="caption" color="text.secondary">
              {'The sender’s name and email are read from fields named name and email, ' +
                'so they never need mapping.'}
            </Typography>
            <Stack direction="row" spacing={1}>
              <Button
                variant="contained"
                color="primary"
                size="small"
                disabled={!changed.length || saving}
                onClick={handleSave}
              >
                {'Save'}
              </Button>
              {changed.length ? (
                <Button size="small" onClick={() => setDraft({})} disabled={saving}>
                  {'Discard'}
                </Button>
              ) : null}
            </Stack>
          </>
        )}
      </Stack>
    </CardDisplay>
  )
}
FormContactFieldsCard.displayName = 'FormContactFieldsCard'

export default FormContactFieldsCard
