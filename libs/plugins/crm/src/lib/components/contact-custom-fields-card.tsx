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

import * as Aglyn from '@aglyn/aglyn'
import type { ConsolePluginPageProps, ContactCustomValue } from '@aglyn/aglyn'
import { CardDisplay } from '@aglyn/shared-ui-jsx'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import {
  useFirestore,
  useFirestoreDoc,
  useOrgDataScope,
  writeGuardedBySeed,
} from '@aglyn/tenant-feature-instance'
import {
  Button,
  Checkbox,
  FormControlLabel,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { doc, updateDoc } from 'firebase/firestore'
import { useCallback, useMemo, useState } from 'react'
import {
  type ContactFieldDefinitionDoc,
  useContactFieldDefinitions,
} from '../hooks/use-contact-field-definitions'

export interface ContactCustomFieldsCardProps
  extends Pick<ConsolePluginPageProps, 'hostId' | 'org'> {
  contactId: string
  /**
   * The contact document, facets and all, when the page already holds it.
   *
   * Omit it and the card reads the document once itself — the shape the
   * record stub mounts it in. A page that passes it pays no second read,
   * and owns the seed discipline for it: the card's own guard covers only
   * the read the card made.
   */
  contact?: Record<string, unknown> | null
}

/** An ISO stamp as the `<input type="date">` value it corresponds to. */
const isoToDateInput = (value: ContactCustomValue | undefined): string => {
  if (typeof value !== 'string' || !value) return ''
  const ms = Date.parse(value)
  return Number.isFinite(ms) ? new Date(ms).toISOString().slice(0, 10) : ''
}

/**
 * The custom fields on one contact, as THIS holder's values (AGL-2601).
 *
 * Every active definition draws the control its type calls for, seeded
 * from the viewing group's facet — `facets.{group}.custom.{key}` — and
 * never from another holder's, because a value is one business's knowledge
 * of a person. Save writes ONLY the keys that changed, each at its own
 * dotted path with `updateDoc`: a nested `custom` object would replace the
 * map and take every key this card did not touch out with it, and a save of
 * every key would turn a one-field edit into a write of ten.
 *
 * A cleared control writes `null`, the explicit "cleared" the model keeps
 * the key present with, rather than deleting the field: a `where` on the
 * key can still find the contact, and an export still shows the column.
 */
export function ContactCustomFieldsCard(props: ContactCustomFieldsCardProps) {
  const { hostId, org, contactId, contact } = props
  const firestore = useFirestore()
  const { enqueueSnackbar } = useSnackbar()
  const { scope } = useOrgDataScope({ hostId })
  const orgId = scope?.[1] ?? null
  const { active, ready } = useContactFieldDefinitions(orgId)
  const consentGroup = useMemo(
    () => Aglyn.consentGroupForHost(org as Record<string, unknown>, hostId),
    [org, hostId],
  )

  // The record, read here only when the page did not hand one over.
  const ownRead = useFirestoreDoc<Record<string, unknown>>(
    () =>
      contact === undefined && scope
        ? doc(firestore, scope[0], scope[1], 'contacts', contactId)
        : null,
    [firestore, scope, contactId, contact === undefined],
  )
  const record = contact === undefined ? (ownRead.data ?? null) : contact
  const stored = useMemo(
    () => Aglyn.readContactFacet(record, consentGroup.groupId).custom ?? {},
    [record, consentGroup.groupId],
  )

  /** Only the keys the reader touched; everything else reads from `stored`. */
  const [draft, setDraft] = useState<Record<string, ContactCustomValue>>({})
  const [saving, setSaving] = useState(false)
  const valueOf = useCallback(
    (key: string): ContactCustomValue | undefined =>
      key in draft ? draft[key] : stored[key],
    [draft, stored],
  )
  const setValue = useCallback((key: string, value: ContactCustomValue) => {
    setDraft((current) => ({ ...current, [key]: value }))
  }, [])

  /** The keys whose draft differs from what is stored — what Save writes. */
  const changed = useMemo(
    () =>
      Object.entries(draft).filter(([key, value]) => {
        const before = stored[key] ?? null
        return (value ?? null) !== before
      }),
    [draft, stored],
  )
  const clearingRequired = active.some(
    (definition) =>
      definition.required && definition.key in draft && draft[definition.key] == null,
  )

  const handleSave = useCallback(async () => {
    if (!scope || !changed.length || clearingRequired) return
    setSaving(true)
    try {
      const verdict = await writeGuardedBySeed(
        {
          subject: 'contact',
          unreadable: contact === undefined && ownRead.status === 'error',
          fromCache: contact === undefined && ownRead.fromCache,
        },
        async () => {
          await updateDoc(doc(firestore, scope[0], scope[1], 'contacts', contactId), {
            ...Object.fromEntries(
              changed.map(([key, value]) => [
                Aglyn.contactFacetPath(consentGroup.groupId, `custom.${key}`),
                value ?? null,
              ]),
            ),
            updatedAt: new Date(),
          })
        },
      )
      if (!verdict.ok) {
        return void enqueueSnackbar(verdict.message, { variant: 'warning', persist: false })
      }
      setDraft({})
      enqueueSnackbar('Contact saved', { variant: 'success', persist: false })
    } catch (error) {
      console.error(error)
      enqueueSnackbar('An error has occurred', { variant: 'error', allowDuplicate: true })
    } finally {
      setSaving(false)
    }
  }, [
    scope,
    changed,
    clearingRequired,
    contact,
    ownRead.status,
    ownRead.fromCache,
    firestore,
    contactId,
    consentGroup.groupId,
    enqueueSnackbar,
  ])

  const control = (definition: ContactFieldDefinitionDoc) => {
    const value = valueOf(definition.key)
    const label = definition.label
    switch (definition.type) {
      case 'checkbox':
        return (
          <FormControlLabel
            key={definition.$id}
            control={
              <Checkbox
                checked={value === true}
                onChange={(event) => setValue(definition.key, event.target.checked)}
                slotProps={{ input: { 'aria-label': label } }}
              />
            }
            label={definition.required ? `${label} *` : label}
          />
        )
      case 'select':
        return (
          <TextField
            key={definition.$id}
            select
            size="small"
            label={label}
            required={definition.required === true}
            value={typeof value === 'string' && (definition.options ?? []).includes(value) ? value : ''}
            onChange={(event) => setValue(definition.key, event.target.value || null)}
            fullWidth
          >
            <MenuItem value="">{'—'}</MenuItem>
            {(definition.options ?? []).map((option) => (
              <MenuItem key={option} value={option}>
                {option}
              </MenuItem>
            ))}
          </TextField>
        )
      case 'number':
        return (
          <TextField
            key={definition.$id}
            size="small"
            type="number"
            label={label}
            required={definition.required === true}
            value={typeof value === 'number' ? value : ''}
            onChange={(event) => {
              const text = event.target.value
              if (text === '') return setValue(definition.key, null)
              const parsed = Number(text)
              if (Number.isFinite(parsed)) setValue(definition.key, parsed)
            }}
            fullWidth
          />
        )
      case 'date':
        return (
          <TextField
            key={definition.$id}
            size="small"
            type="date"
            label={label}
            required={definition.required === true}
            value={isoToDateInput(value)}
            onChange={(event) => {
              const text = event.target.value
              const ms = text ? Date.parse(text) : Number.NaN
              setValue(definition.key, Number.isFinite(ms) ? new Date(ms).toISOString() : null)
            }}
            slotProps={{ inputLabel: { shrink: true } }}
            fullWidth
          />
        )
      default:
        return (
          <TextField
            key={definition.$id}
            size="small"
            type={definition.type === 'url' ? 'url' : 'text'}
            label={label}
            required={definition.required === true}
            value={typeof value === 'string' ? value : value == null ? '' : String(value)}
            onChange={(event) => setValue(definition.key, event.target.value || null)}
            slotProps={{ htmlInput: { maxLength: 2000 } }}
            fullWidth
          />
        )
    }
  }

  return (
    <CardDisplay header={'Custom fields'} contentGutterX contentGutterY>
      <Stack spacing={2}>
        {!ready ? null : active.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            {'No custom fields yet. Define them under Fields and they appear on every contact.'}
          </Typography>
        ) : (
          <>
            {active.map(control)}
            {clearingRequired ? (
              <Typography variant="caption" color="error">
                {'A required field cannot be left empty.'}
              </Typography>
            ) : null}
            <Stack direction="row" spacing={1}>
              <Button
                variant="contained"
                color="primary"
                disabled={!changed.length || clearingRequired || saving || !scope}
                onClick={handleSave}
              >
                {'Save'}
              </Button>
              {changed.length ? (
                <Button onClick={() => setDraft({})} disabled={saving}>
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
ContactCustomFieldsCard.displayName = 'ContactCustomFieldsCard'

export default ContactCustomFieldsCard
